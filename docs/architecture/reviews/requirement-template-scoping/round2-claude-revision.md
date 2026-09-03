# RequirementTemplate — Rodada 2 (revisão Claude, resposta à crítica Codex Rodada 1)

Notas cegas registradas da Rodada 1: **Claude 8,2/10** · **Codex — régua 6,4/10, design 6,6/10**.
A régua foi contestada (`research-protocol.md`, fluxo de reconciliação) — esta rodada traz a
régua **v2 reconciliada** e depois o design revisado contra ela.

## Parte A — Régua v2 (reconciliação ponto a ponto da contestação)

| # | Contestação do Codex | Resposta |
| --- | --- | --- |
| C1 25% é excessivo | **Aceito.** Snapshot é uma decisão de uma linha depois de tomada; o peso estava premiando a conclusão da pesquisa, não a engenharia. Cai para 15%. |
| C2 pressupõe unicidade por nome global | **Aceito como achado, rejeitado como omissão.** O critério não pode pressupor a regra; a regra tem de ser **decidida explicitamente** (Parte B, D-3'). O critério v2 passa a ser "a regra de unicidade é decidida explicitamente E enforced em TODO caminho de escrita, não só no apply". |
| C3 "sem versionamento" é escopo, não qualidade | **Aceito integralmente.** Critério removido da régua. A decisão de não versionar continua no design (D-5), justificada por proporcionalidade, mas não vale pontos. Também aceito o reparo factual: as fontes sustentam *snapshot no apply*; elas **não** provam que ninguém versiona template — a Rodada 1 extrapolou e o texto foi corrigido. |
| C4 planejador compartilhado ≠ equivalência sob concorrência | **Aceito.** Critério v2 deixa de premiar "um call site" e passa a premiar **honestidade semântica do preview** (documentar que é aconselhamento sobre um snapshot + oferecer `expectedTemplateVersion`). |
| C5 reuso não vale 15% quando o precedente alarga 3 operações | **Aceito.** Cai para 10%. |
| C6 atomicidade deveria pesar mais, "folga" indefinida | **Aceito.** Sobe para 20% e passa a exigir orçamento numérico explícito com reserva nomeada, mais limites de BYTES (400 KB/item, 4 MB/transação), que a régua v1 omitia. |
| Régua omitia: unicidade interna dos itens, estado do Subject, fence de versão do template, mapeamento de `CancellationReasons` | **Aceito.** Viram o critério novo C4' (fechamento de TOCTOU) e C7'. |

**Régua v2** (soma 100%):

1. **(20%) Regra de unicidade decidida e enforced em todo caminho de escrita.** Atende: existe
   uma resposta explícita de domínio para "o nome de um `Requirement` é único por Subject?", com
   as consequências respondidas (homônimos com notas diferentes, requisito NOT_APPLICABLE,
   rename bloqueando outro, outros escritores), e o mecanismo é transacional em *todos* os
   caminhos que criam/renomeiam/apagam `Requirement` — nunca só no apply. Não atende: regra
   inferida por precedente, ou enforced só num caminho.
2. **(20%) Atomicidade e orçamento da transação corretos, em ações E em bytes.** Atende: a
   aritmética de ações está certa (incluindo fence, checks e itens), o cap tem reserva nomeada,
   e existem limites de comprimento que tornam o pior caso serializado verificável contra os
   400 KB do item e o payload da transação, com teste de pior caso. Não atende: fórmula errada,
   cap sem reserva, ou limite só em quantidade.
3. **(20%) TOCTOU fechado nas três janelas reais.** Atende: (a) o template é condicionado por
   `status = ACTIVE AND version = <versão lida>` na própria transação; (b) o Subject é
   condicionado a existir/estar ativo na própria transação; (c) colisão de nome normalizado
   **entre itens do mesmo template** é impossível por validação de domínio, antes de virar duas
   ações sobre a mesma chave. Não atende: qualquer uma das três deixada para uma leitura prévia.
4. **(15%) Snapshot no apply, proveniência não-autoritativa.** Igual à v1, peso reduzido.
5. **(10%) Preview honesto.** Atende: a API declara que o preview é aconselhamento sobre um
   snapshot, oferece `expectedTemplateVersion` para tornar *a parte controlável* determinística,
   e o design documenta explicitamente qual janela permanece aberta e por que fechá-la não vale
   o custo. Não atende: prometer que o apply reproduz o preview.
6. **(10%) Reuso de padrão interno já convergido, sem mecanismo/GSI novo.**
7. **(5%) Mapeamento estrutural de `CancellationReasons`.** Atende: a posição de cada ação é
   derivada de metadados construídos junto com a transação. Não atende: índice literal fixo.

## Parte B — Design v2

Correções ponto a ponto dos 12 achados do Codex.

### D-3' (achado 6, o central) — SIM: `Requirement.name` é único por Subject

Decisão de domínio tomada explicitamente, não inferida do precedente de `DocumentType`
(autoridade: `ai-governance.md` §1, resíduo de produto decidível via protocolo completo).
**Um `Requirement` é "algo que este Subject precisa possuir/manter válido"** (doc do próprio
`requirement.ts`) — dois requisitos homônimos no mesmo Subject não são dois deveres distintos,
são o mesmo dever cadastrado duas vezes. Respostas às quatro perguntas do Codex:

- *Homônimos com `notes`/`applicability` diferentes são inválidos?* Sim. `notes` é anotação
  sobre o dever, não sua identidade; `applicability` é um estado DO dever ("este Subject está
  dispensado da CND Estadual"), e ter simultaneamente "CND Estadual APPLICABLE" e "CND Estadual
  NOT_APPLICABLE" é contradição, não expressividade.
- *Um requisito arquivado/inaplicável continua reservando o nome?* NOT_APPLICABLE reserva (é a
  mesma linha, só marcada). **Não existe estado "arquivado" para `Requirement`** — confirmado
  por leitura: `deleteRequirement()` faz `Delete` físico (`buildVersionedDelete`), não soft
  delete. Logo não há risco de "nome reservado para sempre por um arquivado": apagar libera.
- *Renomear pode bloquear a edição de outro?* Sim, com 409 `RequirementNameConflictError` —
  exatamente o que `renameDocumentType()` já faz, comportamento conhecido do produto.
- *Imports/lote também mantêm o ponteiro?* **Verificado por grep, não presumido**: os únicos
  escritores de `Requirement` hoje são `createRequirement`/`updateRequirement`/`linkEvidence`/
  `unlinkEvidence`/`deleteRequirement` (todos em `document-archive-service.ts`) e o worker
  `requirement-reindex` (só flip de `status`, nunca `name`). `src/modules/import/` importa
  `TrackedSubject`/`ExpirationItem` e, na prosa do próprio `import-job.ts`, `RequirementAssignment`
  — nunca esta entidade `Requirement`. `linkEvidence`/`unlinkEvidence` não tocam `name` e ficam
  intocados. O alargamento é, de fato, exatamente 3 métodos + 1 método novo.

Mecanismo: `RequirementNamePointer` (PK `TENANT#<t>#SUBJECT#<s>#REQNAME#<normalizedName>`, SK
`POINTER`), forma idêntica a `DocumentTypeNamePointer`. Ramos de rename idênticos aos de
`renameDocumentType()` (mesmo nome normalizado = só `Update`; nome mudado = `Update` +
`Delete(antigo, requirementId=:self)` + `Put(novo, attribute_not_exists)`).

Backfill: **retirado como "risco"** (achado do Codex, e `AGENTS.md` §1 já diz que dado `dev` é
resetável). Vira uma etapa de implantação: `scripts/backfill-requirement-name-pointers.ts`,
idempotente, com o guard `fileURLToPath(import.meta.url) === process.argv[1]` (bug real de
D-186), rodado uma vez contra `dev` para estabelecer a baseline.

### D-7' (achados 1, 2, 8, 9) — orçamento da transação corrigido e cap reduzido para 30

Aritmética correta do `applyTemplate` com N itens criáveis:

```text
N   × Put(Requirement, attribute_not_exists)
N   × Put(RequirementNamePointer, attribute_not_exists)
1   × ConditionCheck(RequirementTemplate: status = ACTIVE AND version = :readVersion)
1   × ConditionCheck(TrackedSubject: attribute_exists(PK) AND #status <> "DELETED")
1   × fence de tenant ACTIVE (adicionado por executeTenantBusinessMutation)
= 2N + 3
```

Com o cap **30** (não 40): `2×30 + 3 = 63` ações, **reserva nomeada de 37 ações** — dimensionada
para o único alargamento previsível desta transação (proteger transacionalmente também os itens
*pulados*, que custaria até +N `ConditionCheck`, e ainda caberia: 63 + 30 = 93). O cap de 40 da
Rodada 1 não tinha reserva com propósito declarado; 30 tem. Um template do exemplo do roadmap
tem 5 itens.

Orçamento em **bytes** (omissão real da régua v1): `name` ≤ 200 caracteres, `notes` ≤ 2000,
`displayName` do template ≤ 200, `description` ≤ 2000 — enforced no schema JSON **e** no serviço.
Pior caso serializado do item embutido: `30 × (200 + 2000 + ~120 de overhead) ≈ 70 KB`, mais o
envelope do template ≈ 73 KB, contra os 400 KB do limite de item — folga de 5×. Teste de pior
caso obrigatório (G-V3): constrói um template no cap com todos os campos no comprimento máximo,
serializa, e falha se passar de 200 KB (metade do limite duro, para que uma evolução da forma do
item quebre o teste antes de quebrar em produção).

### D-8' (achado 2) — fence de versão do template

O `ConditionCheck` do template é `#status = :active AND #version = :readVersion`, não só o
status. Custo zero em número de ações e fecha o TOCTOU principal: se o template foi editado
entre a leitura e o commit, a transação inteira é cancelada e o caller recebe 409 com o
`templateVersion` atual, para reler/replanejar. `sourceTemplateAppliedVersion` passa a ser
verdade protegida transacionalmente, não "a versão que eu tinha lido antes da corrida" — que era
exatamente a objeção do achado 11.

Complemento: `applyTemplate` aceita `expectedTemplateVersion` **opcional** vindo do preview. Se
informado, é ele que entra no `ConditionCheck` (o caller aprova um plano específico); se ausente,
usa a versão lida no próprio apply (conveniência para o caso sem preview). Mesma disciplina de
`expectedVersion` que todo o resto do serviço já usa.

### D-9' (achado 8) — Subject condicionado na transação

`ConditionCheck(subjectKey(tenantId, subjectId): attribute_exists(PK) AND #status <> :deleted)`.
**Achado real registrado**: `createRequirement()` hoje **não verifica de forma alguma** que o
Subject existe — cria a linha sob `TENANT#t#SUBJECT#s` mesmo que `s` não exista ou esteja
DELETED (leitura direta do método; não há `readActiveSubject` como no `RequirementService`
legado). Como `createRequirement` já vira transacional por D-3', o mesmo `ConditionCheck` entra
lá também. É correção de uma lacuna pré-existente encontrada por esta rodada, não escopo novo
inventado — e é barata exatamente porque a transação já está sendo aberta.

### D-10' (achado 5) — unicidade normalizada DENTRO do template

Achado correto e o mais perigoso dos 12: dois itens que normalizam para o mesmo nome produziriam
dois `Put` sobre a MESMA chave de ponteiro numa única `TransactWriteItems`, o que o DynamoDB
rejeita com `ValidationException` — erro 500 opaco, não o 409 de domínio prometido. Fechamento em
três camadas:

1. Domínio: `assertTemplateItemNamesUnique(items)` (puro) lança `ValidationError` quando dois
   itens colidem por `normalizeDisplayName()`.
2. Chamado por `createRequirementTemplate`, `updateRequirementTemplate` e
   `duplicateRequirementTemplate` (defensivamente, mesmo a origem já sendo válida) — o dado
   inválido nunca é persistido.
3. Chamado também por `planTemplateApplication`, como proteção de domínio contra um template
   persistido antes desta validação existir.

Teste G-V3 alvo: um template com `"CND Federal"` e `"  cnd   federal "` — sem a validação o teste
observa a `ValidationException` do DynamoDB (via fake que reproduz a regra de chave duplicada),
com a validação observa um `ValidationError` 400 nomeando os dois itens.

### D-11' (achados 3, 4) — semântica do preview e dos `skip`, declarada

Semântica escolhida, explícita no contrato e no doc comment (o Codex exigiu escolher uma das
duas; escolho a primeira, com a justificativa que faltava):

> `skip` é uma decisão tomada sobre o snapshot de leitura e **não é protegida
> transacionalmente**. `create` é.

Por que esta e não a versão forte: um `skip` obsoleto significa que o requisito homônimo deixou
de existir entre o plano e o commit, e a consequência é *um requisito a menos criado* — o usuário
o cria manualmente ou reaplica o template (a reaplicação é idempotente por construção, D-12').
Nunca é dado corrompido, nunca é duplicata. Proteger os skips custaria até +N `ConditionCheck`
(`attribute_not_exists` no ponteiro pulado) para transformar uma perda benigna num 409 — trade
ruim. A reserva de 37 ações de D-7' existe precisamente para que essa escolha seja reversível se
a prática mostrar o contrário.

Correções textuais aceitas: "preview e apply concordam por construção" → **"preview e apply não
podem divergir algoritmicamente; podem divergir temporalmente"**; e "existe exatamente um call
site da regra" → **"existe exatamente uma implementação da regra, com dois call sites"**.

### D-12' (achado 10) — semântica operacional de cada operação, fechada

| Pergunta do Codex | Resposta |
| --- | --- |
| apply com zero itens criáveis | **200**, `created: []`, `skipped` completo. Reaplicar um template é idempotente e é sucesso, não conflito — é o caso de uso "o cliente adicionou um item ao template, quero aplicar só o novo". |
| aplicar template ARCHIVED | **409 CONFLICT** (`ConditionCheck` do status falha; a mensagem distingue "arquivado" de "editado concorrentemente" pela releitura no handler de erro). |
| duplicar template ARCHIVED | **Permitido** — é leitura + criação de um template novo ACTIVE; é justamente como se "revive" um template arquivado sem desarquivar o original. |
| editar itens de template ARCHIVED | **409** — arquivado é estado terminal editorialmente; desarquive primeiro. Fence FROM-status no `Update`, mesma forma de `flipDocumentTypeStatus`. |
| apply retorna correspondência item → Requirement | **Sim**: `created: [{ templateItemId, requirementId, name }]`. Sem isso o caller não consegue navegar para o que acabou de criar. |
| nomes duplicados dentro do template | **400 ValidationError** na escrita do template (D-10'), nunca no apply. |

### D-13' (achado 7) — mapeamento estrutural de `CancellationReasons`

Nada de `codes?.[1]`. O montador da transação devolve `{ entries, labels }`, onde `labels[i]`
descreve a ação `i` (`{ kind: "REQUIREMENT" | "POINTER" | "TEMPLATE_FENCE" | "SUBJECT_FENCE",
templateItemId?, name? }`). O handler de erro percorre `getCancellationReasonCodes(err)` em
paralelo a `labels`, coleta **todas** as posições `ConditionalCheckFailed` (o Codex está certo
que pode haver mais de uma) e escolhe o erro de domínio por precedência declarada:
`TEMPLATE_FENCE` → `SUBJECT_FENCE` → `POINTER` (409 nomeando todos os nomes colidentes) →
fallback `ConflictError`. Como `executeTenantBusinessMutation` **acrescenta** o fence de tenant,
os índices das nossas ações permanecem estáveis no prefixo; ainda assim a leitura é por `labels`,
nunca por literal.

### D-14' (achado 11) — `documentTypeId` removido desta fatia

Aceito sem ressalva. Persistir um campo que não é validado, não é propagado e não é lido é dado
morto e enganoso. `RequirementTemplateItem` fica `{ templateItemId, name, notes?, applicability,
position }`. O vínculo `Requirement → DocumentType` continua sendo o item 6 em aberto do arco
D-173, a ser decidido com semântica própria — e então o item de template ganha o campo.

### D-15' (achado 12) — riscos que aceito e não fecho nesta fatia

- `skip` obsoleto por rename/delete concorrente — aceito e documentado (D-11'), com a razão.
- Autorização sobre o Subject além da action RBAC: `authorize()` recebe
  `resource: { tenantId }`, e o `ConditionCheck` do Subject garante que ele é do tenant (a PK
  embute `tenantId`). Não existe hoje ACL por Subject neste produto — se existir um dia, é uma
  decisão própria, não um buraco desta.
- Colisão normalizada entre template e requisito manual: é exatamente o que o ponteiro resolve.

## Autoavaliação Rodada 2 (contra a régua v2)

C1 atendido (D-3', regra decidida + 4 consequências respondidas + escritores verificados por
grep). C2 atendido (D-7', `2N+3`, cap 30, reserva 37, limites de bytes + teste de pior caso).
C3 atendido (D-8'/D-9'/D-10', as três janelas). C4 atendido (D-2 inalterado + D-8' torna a
proveniência protegida). C5 atendido (D-11', semântica escolhida e justificada, texto corrigido).
C6 atendido (zero GSI novo, todo mecanismo é cópia de D-173). C7 atendido (D-13').

**Nota Claude (cega), Rodada 2 — régua v2: 9,2/10 · design v2: 9,1/10.**
