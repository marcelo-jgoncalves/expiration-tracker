# RequirementTemplate — Rodada 3 (Claude, resposta à Rodada 2 do Codex)

Notas cegas acumuladas: R1 Claude 8,2 · Codex régua 6,4 / design 6,6 → R2 Claude régua 9,2 /
design 9,1 · Codex régua 8,3 / design 8,1.

Esta rodada fecha as 5 objeções restantes à régua e os 8 achados novos do design. **Três delas
foram fechadas por leitura direta do código, não por argumento** — e uma delas (a aritmética da
reserva) era um erro real meu.

## Parte A — Régua v3

| Objeção do Codex à v2 | Resposta |
| --- | --- |
| C3 "as três janelas reais" prescreve a implementação | **Aceito.** C3 v3 passa a ser genérico: *"todo objeto do qual a mutação depende participa da transação com a condição que expressa a pré-condição real daquele objeto, segundo o modelo de estados dele"* — sem enumerar quais nem qual expressão. |
| C2 não diz o que medir em bytes | **Aceito.** C2 v3 exige medição em **bytes UTF-8 do tamanho contabilizado pelo DynamoDB** (soma de nomes de atributo + valores, incluindo atributos de índice), com quatro grandezas separadas: item do template, cada `Requirement`, soma da transação, overhead de chaves/índices. |
| C5 premia um parâmetro específico (`expectedTemplateVersion`) | **Aceito.** C5 v3: *"o contrato do preview declara qual garantia dá e qual não dá, e oferece ALGUM mecanismo que torne determinística a parte controlável"* — o mecanismo é livre. |
| C7 é estreito | **Aceito.** C7 v3: *"classificação de cancelamento é estrutural, cobre TODA ação da transação (incluindo as acrescentadas por wrapper), tem precedência justificada, e não afirma causa que o DynamoDB não revelou"*. Peso 5% → 10%. |
| Falta completude da leitura de planejamento | **Aceito como critério, fechado como fato.** Vira parte de C5 v3: *"a leitura que alimenta o plano é comprovadamente completa (paginação esgotada) e sua consistência é declarada"*. |

**Régua v3**: C1 unicidade decidida+enforced 20% · C2 orçamento em ações e bytes 20% ·
C3 consistência transacional dos objetos participantes 20% · C4 snapshot/proveniência 15% ·
C5 honestidade e completude do plano 15% · C6 reuso interno 10% · C7 classificação de
cancelamento 10%. (Soma 110 — ajuste: C6 cai para 5% e C4 para 10%. Soma **100%**: 20/20/20/10/15/5/10.)

## Parte B — Achados novos da Rodada 2

### N1 — a reserva do cap 30 estava justificada por aritmética impossível. **Erro meu, corrigido.**

O Codex está certo sem ressalva: com `C + S ≤ 30`, proteger os skips custa `2C + S + 3`, cujo
máximo é 63 em `C = 30, S = 0` — o mesmo número. Os "93" da Rodada 2 pressupunham 60 itens
lógicos num template de 30. A justificativa era falsa.

Justificativa correta da reserva (e ela existe de verdade, só era outra): o alargamento
realmente previsível desta transação é **um evento de auditoria por `Requirement` criado** —
padrão já estabelecido neste repo (`appendSubjectAuditToTransaction`, usado por todo o
`RequirementService` legado; `document-archive-service.ts` ainda não audita, e passar a auditar é
uma lacuna conhecida, não uma hipótese). Isso é `+N`:

```text
apply hoje:                2N + 3            → N=30: 63 ações
apply + auditoria por item: 3N + 3           → N=30: 93 ações  (reserva de 7)
```

**É esse número que justifica o cap 30**, e ele fecha: 40 itens não caberiam (123 > 100), 30
cabem com folga real. O cap passa a ser derivado do pior caso *previsto*, não do caso atual.

### N2 — o teste de bytes podia contradizer o schema. Fechado mudando a unidade do limite.

Aceito integralmente, inclusive o reparo técnico: `JSON.stringify(x).length` não mede bytes, e o
tamanho contabilizado pelo DynamoDB não é o tamanho do JSON. Correções:

1. Os limites passam a ser em **bytes UTF-8**, não caracteres: `name` ≤ 200 bytes, `notes` ≤ 2000
   bytes, `displayName` ≤ 200 bytes, `description` ≤ 2000 bytes, validados no serviço via
   `Buffer.byteLength(value, "utf8")`. O `maxLength` do JSON Schema (que conta *code points*)
   permanece como primeira barreira barata, com o mesmo número — é sempre ≥ restritivo em
   caracteres e ≤ restritivo em bytes, então nunca aceita o que o serviço recusa por engano; a
   barreira que decide é a de bytes.
2. O teste de pior caso mede `estimateDynamoItemBytes(item)` — soma de
   `Buffer.byteLength(nomeDoAtributo) + Buffer.byteLength(valor)` sobre todos os atributos,
   incluindo `GSI1PK`/`GSI1SK` — e não `JSON.stringify().length`.
3. Com limites em bytes, o pior caso é aritmético e não depende de Unicode:
   `30 × (200 + 2000 + ~120 de nomes/overhead) ≈ 70 KB`; envelope do template ≈ 73 KB contra
   400 KB. O teste falha acima de **200 KB**, e agora **não pode contradizer o schema**, porque
   nenhum valor válido pelo limite de bytes chega perto disso.
4. Grandezas separadas exigidas por C2 v3: item do template ≈ 73 KB; cada `Requirement` ≈ 2,5 KB
   (name+notes+chaves+GSI1); soma da transação com N=30 ≈ 75 KB + ponteiros ≈ 4 KB ≈ **79 KB**,
   contra o limite de 4 MB de payload — folga de 50×.

### N3 — leitura completa dos requisitos. **Fechado por leitura direta do código, não por promessa.**

`DynamoDbDocumentArchiveStore.queryByPk()` (`persistence/dynamodb-document-archive-store.ts`
linhas 80-100) **já esgota a paginação** num `do/while` sobre `LastEvaluatedKey`, acumulando
todas as páginas antes de retornar. `listRequirements()` usa exatamente esse método. O plano
portanto já lê todos os requisitos do Subject — não é uma correção a fazer, é um fato do código
atual que a Rodada 2 não tinha citado. Registro explícito: **`queryByPk` é o único método deste
store que acumula páginas por dentro; `queryIndexPage` deliberadamente não faz isso (lição D-142,
documentada no próprio arquivo)** — o plano usa o primeiro, não o segundo.

### N4 — consistência de leitura declarada.

`queryByPk` não passa `ConsistentRead`, ou seja, a leitura do plano é **eventually consistent**.
Consequência real, exatamente como o Codex descreveu: um `Requirement` criado milissegundos antes
pode não aparecer no plano, o item não é pulado, e o `Put` do ponteiro colide → a transação
inteira é cancelada com 409 em vez de um `skip` silencioso. Decisão: **aceito e declarado no
contrato**, não corrigido. Razões: (a) a integridade nunca é violada — o pior caso é um 409 num
apply que o usuário repete e que então pula corretamente; (b) tornar essa leitura consistente
exigiria mudar a assinatura de `queryByPk` para todos os call sites do módulo, um contrato
genérico mais amplo — exatamente a classe de mudança que este projeto já isolou como decisão
própria em D-C do hot path, não um efeito colateral desta fatia. Fica documentado no doc comment
de `applyTemplate` e na resposta de erro ("um requisito criado concorrentemente pode causar este
conflito; reaplicar o template é seguro e idempotente").

### N5 — não afirmar causa histórica que o DynamoDB não revelou. Aceito.

A Rodada 2 dizia que o handler releria o template para distinguir "arquivado" de "editado
concorrentemente". O Codex está certo: isso é inferência sobre o estado *posterior*, que pode ter
mudado de novo. Correção: a falha do `ConditionCheck` composto do template produz **um único**
erro de domínio, `TemplatePreconditionFailedError` (409), cuja mensagem diz o que é verdade —
*"o template não estava ACTIVE na versão `<expectedVersion>` no momento do commit"* — e cujos
`details` carregam o estado relido **explicitamente rotulado como observação posterior**
(`currentStateAtRetry: { status, version }`), nunca como causa. Nenhuma releitura é feita para
*escolher* o erro; ela só enriquece o diagnóstico.

### N6/N7 — fence de tenant no modelo estrutural. **Fechado por leitura direta: o problema não existe.**

`executeTenantBusinessMutation` (`shared/tenant-lifecycle/tenant-business-mutation.ts` linhas
183-226) acrescenta o fence **sempre por último** (`[...input.entries, fence]`), inspeciona
`CancellationReasons[input.entries.length]` ele mesmo, e converte a falha do fence em
`TenantNotActiveError` **antes de a exceção chegar ao caller** (com fallback conservador para
`CancellationReasons` ausente/malformado). Consequências para o meu mapeamento:

- O caller **nunca** precisa classificar o fence de tenant: ou recebe `TenantNotActiveError`, ou
  recebe uma `TransactionCanceledException` em que o fence comprovadamente não é a causa.
- Portanto `labels[i]` cobrindo `0..entries.length-1` cobre **toda** ação que o caller pode
  precisar classificar — não é "prefixo estável por convenção", é a totalidade do espaço
  restante. C7 v3 ("cobre toda ação, incluindo as de wrapper") é atendido por construção da lane,
  e o design registra esse acoplamento explicitamente em vez de o presumir.
- Guarda defensiva mesmo assim: qualquer `ConditionalCheckFailed` num índice `>= labels.length`
  cai num `ConflictError` genérico, nunca num rótulo errado.

Precedência declarada (C7 v3 exige justificativa, não só ordem): `TEMPLATE_FENCE` →
`SUBJECT_FENCE` → `POINTER`. Justificativa: da pré-condição mais ampla para a mais específica —
se o template não é mais aplicável, dizer "o nome X colidiu" seria enganoso; se o Subject não
aceita requisitos, idem. Colisões de ponteiro são reportadas **todas juntas** (o Codex está certo
que pode haver várias), nomeando cada `templateItemId`/`name`.

### N8 — `status <> DELETED` aceitava estado indevido. **Erro real, corrigido.**

`TrackedSubjectStatus` é `"ACTIVE" | "ARCHIVED" | "DELETED"` (leitura direta de
`subject/domain/tracked-subject.ts` linha 15) — ou seja, `<> DELETED` deixava passar `ARCHIVED`,
exatamente o buraco que o Codex previu sem conhecer o enum. Correção: o `ConditionCheck` enumera
o estado permitido, `attribute_exists(PK) AND #status = :active`, para `applyTemplate` **e** para
`createRequirement`. Um Subject ARCHIVED não recebe requisitos novos — coerente com o que
"arquivado" significa em todo o resto deste produto (`DocumentType` ARCHIVED não pode ser usado
em `createDocument`, D-175).

### Achado 6 da Rodada 2 (unicidade por nome não é verdade inerente) — aceito o enquadramento

Concordo com a correção epistêmica: "dois requisitos homônimos são o mesmo dever" é uma **decisão
de produto deliberada**, não uma consequência lógica da definição da entidade. Reescrita nesses
termos. O contra-exemplo (período/jurisdição distinguindo deveres homônimos) tem uma resposta
concreta e não hipotética: essa distinção vive **no próprio nome** ("CND Federal 2026" vs "CND
Federal 2027"), que é exatamente o que `normalizeDisplayName()` compara — a regra só rejeita dois
requisitos que o usuário escreveu identicamente. Se um dia a distinção precisar ser estrutural
(um campo `period`), a chave do ponteiro ganha esse campo; é uma evolução da chave, não uma
reversão da regra. Registrado como decisão reversível de produto, com o gatilho explícito.

### N-createRequirement — precedência de erro declarada (achado 7 da Rodada 2)

`createRequirement` passa a poder falhar por 4 causas. Precedência declarada, mesma lógica de
"mais ampla primeiro": **tenant inativo** (`TenantNotActiveError` 409, decidido pela própria
lane) → **Subject inexistente/não-ACTIVE** (`SUBJECT_FENCE` → `NotFoundError` 404 se ausente,
`ConflictError` 409 se ARCHIVED — distinguidos por releitura rotulada como observação posterior,
mesma disciplina de N5) → **nome já em uso** (`RequirementNameConflictError` 409) →
**`requirementId` já existente** (`ConflictError` 409, praticamente inalcançável com ULID novo,
mapeado defensivamente). Não há caso de OCC aqui: é uma criação, `expectedVersion` não se aplica.

## Estado das notas

Todos os achados das duas rodadas do Codex estão fechados: 2 por correção de erro real meu (N1,
N8), 2 por leitura direta do código que provou o ponto inexistente ou já resolvido (N3, N6/N7),
3 por mudança de unidade/contrato (N2, N4, N5), 1 por aceitar o enquadramento e declarar o
gatilho de reversão (unicidade), 1 por declarar precedência (createRequirement). Nenhum foi
fechado por "aceito, mas mantenho".

**Nota Claude (cega), Rodada 3 — régua v3: 9,4/10 · design v3: 9,3/10.**
