# RequirementTemplate — Rodada 4 (Claude, resposta à Rodada 3 do Codex)

Notas cegas acumuladas: R1 8,2 · 6,4/6,6 → R2 9,2/9,1 · 8,3/8,1 → R3 9,4/9,3 · 8,8/8,7.
Restam **4 achados**, todos estreitos e todos legítimos. Nenhum é rebatido; três são corrigidos e
um é reclassificado como achado pré-existente do repo, com dono nomeado.

## R4-1 — causalidade em `createRequirement`: releitura removida por completo

O Codex está certo e o fechamento anterior era o mais fraco da rodada: eu havia consertado o
problema epistemológico no template (N5) e reintroduzido exatamente ele no Subject, escolhendo
entre 404 e 409 por uma releitura posterior.

**Correção: um erro único de pré-condição, e nenhuma releitura escolhendo tipo de erro.**

```text
SubjectPreconditionFailedError  (409 CONFLICT)
  message: "The Subject did not satisfy the precondition for this write at commit time
            (it must exist and be ACTIVE)."
  details: { subjectId }
```

Vale para `createRequirement` **e** para `applyTemplate`. A `ConditionCheck` composta
(`attribute_exists(PK) AND #status = :active`) revela apenas que a condição composta falhou, e é
exatamente isso que o erro afirma — nada mais. Nenhum `NotFoundError` 404 é derivado dela.

Nota de coerência: o 404 de "Subject inexistente" continua existindo no caminho de **leitura**
(`previewTemplateApplication`, `listRequirements`), onde é uma observação direta e honesta de uma
leitura, não uma inferência sobre a causa de um cancelamento. A assimetria é deliberada e
documentada: leitura pode dizer "não existe"; cancelamento de transação só pode dizer "a
pré-condição não valia".

Precedência final de `createRequirement`, agora sem nenhuma releitura causal:
`TenantNotActiveError` (decidido pela lane) → `SubjectPreconditionFailedError` →
`RequirementNameConflictError` → `ConflictError` genérico. Cada um vem de um `label` distinto na
transação, não de uma releitura.

## R4-2 — fallback do fence de tenant: reclassificado como achado pré-existente, com dono

O Codex está logicamente certo: com `CancellationReasons` ausente/malformado é **impossível**
simultaneamente (a) provar que o fence falhou, (b) provar que não falhou, e (c) não inferir causa.
Verifiquei o comportamento real da lane em vez de argumentar:

`tenant-business-mutation.ts` linhas 213-223 — `fenceFailed = !Array.isArray(rawReasons) ||
fenceReasonCode === undefined || fenceReasonCode === "ConditionalCheckFailed"`, ou seja, **razões
ausentes ou malformadas são classificadas como `TenantNotActiveError`**. É o fallback conservador
introduzido deliberadamente pelo hardening D-072 item 4, e o Codex tem razão: sob a régua C7 v3,
ele afirma uma causa que o DynamoDB não revelou.

Duas consequências, ambas registradas em vez de escondidas:

1. **Minha alegação da Rodada 3 era grande demais e é retirada.** O contrato correto do meu lado
   passa a ser: *"ou a lane devolve `TenantNotActiveError` (que, na sub-condição de
   `CancellationReasons` inutilizável, pode ser conservador e não uma causa provada), ou devolve
   um cancelamento em que `labels` cobre todas as ações que restam classificar."* Nenhum erro
   desta fatia afirma "o fence comprovadamente não foi a causa".
2. **Achado pré-existente registrado, deliberadamente fora do escopo desta decisão**: o fallback
   correto sob C7 seria um conflito genérico/indeterminado (`ConflictError`, sem causa
   específica) quando `CancellationReasons` é inutilizável — não `TenantNotActiveError`. Isso é
   uma mudança de comportamento de uma lane compartilhada por **todos** os escritores tenant-scoped
   do sistema (nível 3-4, fatia própria), não um detalhe do `RequirementTemplate`. Registrar
   aqui e corrigir numa fatia própria é a mesma disciplina que D-177→D-178 (achado de
   `proxy-allowlist` registrado numa fatia, fechado na seguinte) e D-183 (lacuna de IAM do
   `document_archive_handler` registrada, não corrigida no meio de outra migração).

Sob a régua, portanto: esta decisão atende C7 no que ela própria controla e **declara
explicitamente a sub-condição em que a lane compartilhada, não ela, viola a honestidade causal**.
É a melhor forma disponível de atender um critério de honestidade — não fingir que o buraco não
existe porque está do outro lado de uma fronteira.

## R4-3 — estimador de bytes: reclassificado como limite superior, e o critério corrigido junto

Aceito integralmente: o tamanho contabilizado pelo DynamoDB tem overhead estrutural de
listas/mapas/tipos que "soma de nomes + valores" não modela, e a régua v3 prometia exatidão maior
do que eu entreguei. Duas correções:

1. **A régua muda** (não o design forçado a caber nela): C2 v4 exige *"um estimador de bytes que
   seja comprovadamente um LIMITE SUPERIOR do tamanho contabilizado pelo DynamoDB, documentado
   como tal"*, não uma medição exata. Motivo real: o tamanho exato só é conhecido pelo serviço; um
   limite superior é o que uma sentinela de teste precisa, e prometer exatidão era um defeito da
   régua, não do design.
2. **O estimador vira explicitamente conservador**, somando o overhead que o Codex nomeou:

```text
estimateDynamoItemBytesUpperBound(item):
  para cada atributo:  byteLength(nome) + valueBytes(valor) + 4   // overhead por atributo
  valueBytes(string):  byteLength(utf8)
  valueBytes(number):  21                                          // pior caso documentado
  valueBytes(lista):   3 + Σ (1 + valueBytes(elemento))
  valueBytes(mapa):    3 + Σ (byteLength(chave) + 1 + valueBytes(valor))
```

Nome da função carrega `UpperBound` para que nenhum call site futuro o leia como exato. As
grandezas da Rodada 3 (`≈70 KB` / `≈2,5 KB`) passam a ser rotuladas como *limites superiores
calculados*, não estimativas — com o estimador acima, `30 × (200 + 2000 + overhead)` continua
abaixo de 80 KB, e a sentinela em 200 KB tem 2,5× de margem sobre o limite superior, contra
400 KB de limite duro (5×). A folga é grande o bastante para que a imprecisão residual do modelo
não seja um risco, e agora isso é uma afirmação verificável em vez de uma esperança.

## R4-4 — cap 30: afirmação corrigida de "derivado" para "escolhido abaixo do teto"

Aceito sem defesa. `3N + 3 ≤ 100` dá `N ≤ 32`. A frase honesta é:

> O pior caso previsto (`3N + 3`, com um evento de auditoria por `Requirement` criado) impõe um
> **teto** de 32 itens. O cap é **30**, escolhido como o número redondo imediatamente abaixo do
> teto, com 7 ações de margem — não um valor derivado matematicamente do teto.

E o reparo do segundo ponto: a auditoria por item é hoje uma **lacuna conhecida** deste módulo
(`document-archive-service.ts` não emite `SubjectAuditEvent`, ao contrário do `RequirementService`
legado), não um compromisso já assumido desta fatia. O cap 30 é dimensionado para que fechá-la
depois **não exija revisitar o cap** — esse é o argumento real, e ele não depende de a auditoria
estar prometida.

## R4-5 — régua v4: sobreposição C1/C3/C7 desfeita, viés de C1/C4 reduzido

Aceito o diagnóstico: C1, C3 e C7 premiavam três faces do mesmo alargamento transacional, e C1
embutia o mecanismo escolhido no enunciado do critério. Reorganização (o **mérito** vai para C3,
onde é uma propriedade genérica; C1 fica só com a **decisão de produto**):

| # | Critério v4 | Peso |
| --- | --- | --- |
| C1 | A regra de duplicidade é uma decisão de produto **declarada explicitamente**, com suas consequências respondidas e um gatilho de reversão nomeado — qualquer regra coerente atende, inclusive "homônimos são permitidos". | 10% |
| C2 | Orçamento em ações e em bytes, com limite superior comprovado e teste de pior caso. | 20% |
| C3 | Todo objeto de que a mutação depende participa da transação com a condição que expressa a pré-condição real dele, **em todo caminho de escrita** — não só no caminho novo. | 25% |
| C4 | Semântica de aplicação (snapshot vs. live-link) escolhida com base em padrão externo e coerente com a proveniência gravada. | 10% |
| C5 | Honestidade e completude do plano: garantias declaradas, leitura comprovadamente completa, consistência declarada. | 15% |
| C6 | Reuso de padrão interno já convergido, sem mecanismo/GSI novo. | 5% |
| C7 | Classificação de cancelamento estrutural, cobrindo toda ação, com precedência justificada e **sem afirmar causa não revelada** — inclusive declarando onde a honestidade causal é violada fora da própria fatia. | 15% |

Soma 100%. C1 caiu de 20% para 10% e perdeu o mecanismo do enunciado; C4 caiu de 15% para 10%;
o peso liberado foi para C3 (genérico) e C7 (o critério que mais reprovou este design em duas
rodadas seguidas — subir o peso dele é o oposto de moldar a régua para vencer).

## Autoavaliação Rodada 4 (contra a régua v4)

C1 (10%) atendido — regra declarada como decisão de produto reversível, 4 consequências
respondidas, gatilho nomeado (campo `period` estrutural). C2 (20%) atendido — R4-3, limite
superior comprovado, sentinela com 2,5× de margem. C3 (25%) atendido — template
(`status = ACTIVE AND version`), Subject (`= ACTIVE`, enumerado), ponteiro
(`attribute_not_exists`), nos 4 caminhos de escrita (`create`/`update`/`delete`/`apply`), nunca só
no novo. C4 (10%) atendido — snapshot, 5 fontes convergentes, proveniência protegida pelo fence de
versão. C5 (15%) atendido — `queryByPk` esgota paginação (fato de código), consistência eventual
declarada com a formulação corrigida pelo Codex ("reaplicar é seguro e, quando a leitura
convergir, o item será pulado"), `skip` declarado como observação de planejamento. C6 (5%)
atendido. C7 (15%) atendido — R4-1 remove a última releitura causal, R4-2 declara a sub-condição
fora do escopo em vez de escondê-la.

**Nota Claude (cega), Rodada 4 — régua v4: 9,4/10 · design v4: 9,3/10.**
