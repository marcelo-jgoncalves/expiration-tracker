# DocumentType — Rodada 2 (revisão Claude, resposta à crítica do Codex)

Nota da Rodada 1: Codex 6,4/10. 8 achados (5 bloqueantes, 3 não-bloqueantes), todos endereçados
abaixo com mecanismo concreto — nenhum ficando em prosa. Nenhum contestado (todos verificados por
leitura direta antes desta rodada).

## 1. [bloqueante] Segundo writer real — `guest-document-access-service.ts`

Achado aceito sem ressalva, confirmado por leitura: `guest-document-access-service.ts:313`
(`submitEvidence` do guest flow) também cria `Document`, com `documentType = input.documentType ??
requirementId` — um fallback semanticamente inválido (um `requirementId` nunca foi um tipo de
documento, é o identificador do `Requirement` sendo satisfeito). Este fallback **nunca deveria ter
existido** independente desta decisão — é o mesmo tipo de achado que D-161 encontrou no bug do
GSI2 (D-162): código com comportamento diferente do que o comentário/design pretendia.

Correção: o guest flow migra junto, na mesma decisão. `SubmitEvidenceInput` ganha
`documentTypeId: string` obrigatório (o guest, ao submeter evidência para um `Requirement`
específico, já sabe qual `DocumentType` está anexando — a UI de guest upload lista os tipos
`ACTIVE` do tenant, mesma leitura que o fluxo interno usa). O fallback `?? requirementId` é
removido. Se `Requirement` no futuro quiser sugerir um `documentTypeId` default (não decidido
nesta rodada, fora de escopo — ver "Fora de escopo"), isso é responsabilidade do caller montar
`input.documentTypeId`, nunca um fallback silencioso dentro do service.

## 2. [bloqueante] TOCTOU de `DEPRECATED` — `ConditionCheck` transacional, não leitura-antes

Achado aceito sem ressalva. A Rodada 1 tratou a janela leitura→escrita como "aceitável" citando
precedente de `Requirement`↔`Subject` — mas essa analogia era falsa: `Subject` nunca tem um
estado "não mais elegível para novas referências" (não existe deprecação de `Subject`), então
não havia corrida real ali para comparar. `DocumentType.status` tem exatamente esse estado, e o
próprio checklist da Rodada 1 (critério 2, peso 25%) já exige a garantia — a Rodada 1 se
contradisse ao aceitar um mecanismo mais fraco que o próprio critério que ela mesma pesou mais
alto.

Correção: `createDocument()` (interno e guest) vira uma `TransactWriteItems` de 2 itens —
`ConditionCheck` no `DocumentType` (`tenantId` implícito na PK, `status = "ACTIVE"`) + `Put
Document`. Sem `expectedVersion` do `DocumentType` (não é necessário: a condição é sobre o
**valor atual** de `status`, não sobre "nada mudou desde que eu li" — `buildVersionConditionCheck`
existe para o segundo caso; aqui o caso é o primeiro, mais simples, `ConditionExpression:
"status = :active"` direto). 2 itens por transação, muito abaixo de qualquer prática do projeto
(D-163's `acceptVersion()` já usa até 10) e do limite real do DynamoDB (100). Mesmo mecanismo
aplicado nos dois writers (interno + guest) — fecha o achado 1 e este achado com uma peça só.

Nota para a Rodada 3 do item 6 (Requirement Templates, futuro): esta mesma
`ConditionCheck`-no-catálogo é o padrão que aquela decisão deve reusar quando chegar sua vez —
registrado aqui como precedente, não implementado agora (fora do escopo desta rodada).

## 3. [bloqueante] Rename para nome semanticamente idêntico — colisão de item na transação

Achado aceito sem ressalva: `Delete`+`Put` no mesmo pointer (mesma PK/SK, quando
`newNormalizedName === oldNormalizedName`) é rejeitado pelo DynamoDB (`TransactWriteItems` não
permite duas operações sobre o mesmo item). Isto cobre tanto "renomear para o nome já tinha"
quanto "renomear só a capitalização/espaçamento, nome normalizado idêntico" (relevante porque a
normalização — achado 4 abaixo — colapsa exatamente esses casos).

Correção, `renameDocumentType()`:
```
if (newNormalizedName === oldNormalizedName) {
  // Só o Update da entidade (displayName exibido muda, identidade de dedupe não muda) —
  // nenhuma operação de pointer.
  TransactWriteItems([
    Update(DocumentType, expectedVersion, set: { displayName: newDisplayName, GSI1SK: ... }),
  ]);
} else {
  TransactWriteItems([
    Update(DocumentType, expectedVersion, set: { displayName: newDisplayName, GSI1SK: ... }),
    Delete(oldPointer, condition: documentTypeId = :self),
    Put(newPointer, condition: attribute_not_exists(PK)),
  ]);
}
```
Os dois ramos testados explicitamente (G-V3: um teste que renomeia só a capitalização prova que
o ramo de 1 item é tomado — mutar o código para sempre tomar o ramo de 3 itens quebra esse teste
com `ValidationException` do fake store simulando a regra real do DynamoDB).

## 4. [bloqueante] Normalização — função real extraída, não inventada

Achado aceito sem ressalva, verificado por leitura: não existe normalizador de nome reutilizável
em `request-context`/`organization` (afirmação da Rodada 1 era falsa, corrigida aqui). O
precedente real é `normalizeDisplayName()` (`subject/domain/tracked-subject.ts`) — NFD, remove
diacríticos, trim, lowercase, colapsa whitespace. Decisão explícita (a Rodada 1 pulou essa
pergunta em vez de decidir): **sim, dois nomes que diferem só por diacríticos/whitespace/caixa
devem colidir** — mesma UX de "não deixar dois tipos quase-idênticos coexistirem por acidente de
digitação", exatamente o motivo do dedupe existir. Mesma regra que `TrackedSubject` já aplica ao
próprio domínio (subjects "João" e "Joao" tratados como o mesmo nome para fins de dedupe).

Mecanismo: `normalizeDisplayName()` é promovido de `subject/domain/tracked-subject.ts` para
`src/shared/text/normalize-display-name.ts` (novo módulo, shared, sem dependência de domínio —
função pura, string→string, zero import de `subject/**`), reexportado de volta em
`tracked-subject.ts` para não quebrar nenhum call site existente (`export { normalizeDisplayName
} from "../../../shared/text/normalize-display-name.js"`). `document-archive` importa de
`shared/text/`, nunca de `subject/**` — respeita o boundary de módulo existente
(`dependency-cruiser`, `AGENTS.md` §7) sem introduzir uma aresta nova `document-archive →
subject`.

## 5. [bloqueante] Integridade do pointer em rename — chave antiga derivada da leitura, `CancellationReasons` mapeados

Achado aceito sem ressalva. Correção:
- `oldNormalizedName` nunca vem do input do chamador — é sempre `normalizeDisplayName(existing
  DocumentType.displayName)`, lido dentro da mesma operação que monta a transação (não confiado a
  um valor passado de fora).
- `Delete(oldPointer)` condicionado a `documentTypeId = :self AND tenantId = :tenantId` (a
  partição já é `TENANT#<t>#DOCTYPENAME#<name>`, então `tenantId` é redundante com a PK — mantido
  como defesa em profundidade explícita, mesmo padrão que D-163 usa em vários pontos do fence de
  `DocumentFile`).
- `Update(DocumentType)` condicionado a `expectedVersion` (OCC padrão).
- Mapeamento de `CancellationReasons` por índice (posição 0 = Update da entidade, posição 1 =
  Delete do pointer antigo, posição 2 = Put do pointer novo): um cancelamento na posição 0 é
  `ConflictError` (OCC — outra rename/deprecate concorrente venceu); posição 1 é
  `ConflictError` também (pointer antigo já não aponta mais para este tipo — outra rename já
  correu); posição 2 é um erro de domínio distinto, `DocumentTypeNameConflictError` (nome
  destino já em uso por outro tipo) — nunca um `ConflictError` genérico disfarçando os três casos
  como se fossem a mesma falha. Mesma disciplina que D-099/D-100 já aplicou para diferenciar
  causas de cancelamento numa transação de aceite de convite (`AcceptInvitationService`).

## 6. [não-bloqueante] `GSI1SK` ordena por nome normalizado, não bruto

Aceito. `GSI1SK: NAME#<normalizedName>#DOCTYPE#<documentTypeId>` (era `displayName` bruto na
Rodada 1) — ordenação determinística, insensível a caixa/diacríticos, consistente com a chave de
dedupe. `displayName` continua no corpo do item para apresentação; nunca no `GSI1SK`.

## 7. [não-bloqueante] Declaração E-014 corrigida para `SIM PARCIAL`

Aceito. A alegação "nenhuma fonte permite exclusão física de categoria em uso" não é sustentada
pelas 3 fontes como estava escrita (GitHub permite deletar uma label, inclusive uma em uso —
issues antigas simplesmente perdem a associação, não é um FK protegido no sentido que a proposta
alegava). Declaração revisada:

```
Pesquisa externa considerada: SIM PARCIAL (fontes: GitHub REST API Labels
  <https://docs.github.com/en/rest/issues/labels>, 2026-09-02; Notion API Database properties
  <https://developers.notion.com/reference/database-properties> e
  <https://developers.notion.com/reference/update-property-schema-object>, 2026-09-02; Zendesk
  About custom fields <https://support.zendesk.com/hc/en-us/articles/4408838961562>, 2026-09-02.
  Escopo: identidade estável separada de nome renomeável é confirmada pelas 3 fontes (GitHub
  id/node_id vs. name; Notion option id vs. texto da opção; Zendesk trata "tipo configurável"
  como campo customizado à parte do core, nunca editando o enum nativo). Proteção de referência
  contra exclusão de categoria em uso NÃO é confirmada por nenhuma das 3 fontes da mesma forma —
  GitHub permite deletar uma label referenciada por issues antigas (a referência simplesmente
  desaparece, sem FK protegido); Notion/Zendesk não documentam esse comportamento publicamente o
  bastante para citar como fonte. A decisão de soft-state (nunca excluir fisicamente um
  DocumentType referenciado) é portanto uma escolha de engenharia interna deste projeto — mesma
  disciplina já usada em toda a base (nenhuma entidade referenciada é excluída fisicamente fora
  da fila de purga LGPD nomeada, D-127), não um padrão externo confirmado. Layout de chave
  DynamoDB, tenant-scoping e mecanismo de concorrência (ConditionCheck/OCC) são decisão interna.)
```

## 8. [não-bloqueante] Checklist reponderado — integridade referencial/concorrência como critério próprio

Aceito. Checklist revisado (substitui o da Rodada 1, mudança registrada explicitamente por ser
achado real, não capricho — `research-protocol.md` exige isso quando o checklist muda):

```
1. (peso 25%) Identidade nunca muda, nome sempre pode mudar.
2. (peso 25%) Integridade referencial sob concorrência — nenhuma corrida (criação vs. deprecate,
   rename vs. rename, rename vs. create-com-nome-alvo) produz um estado inconsistente; mecanismo
   sempre transacional/condicional, nunca leitura-antes sem cerco.
3. (peso 20%) Nenhuma exclusão física de um tipo referenciado — só soft-state.
4. (peso 15%) GSI2 migra sem ambiguidade, todos os writers reais cobertos (achado 1 desta
   rodada torna este critério explicitamente sobre "todos", não só o writer óbvio).
5. (peso 10%) Dedupe determinístico e reusa normalização já convergida no projeto.
6. (peso 5%) Setup limpo para o item 1 (Requirement Templates).
```

Gate de régua estável (`research-protocol.md` §3): esta reponderação precisa de nota ≥9,0 dos
dois lados especificamente sobre a régua, separada da nota de design, antes de contar para o
fechamento — registrado como pendente explícito para a Rodada 3.

## Síntese

8 achados da Rodada 1 fecham com: migração do guest flow incluída (mesmo mecanismo do fluxo
interno), `ConditionCheck` transacional substituindo leitura-antes (fecha 2 achados com 1
mecanismo), ramo condicional no rename evitando colisão de item, normalização real extraída para
`shared/text/` sem violar boundary de módulo, `CancellationReasons` mapeados por posição com 2
classes de erro distintas, `GSI1SK` usando nome normalizado, declaração E-014 corrigida para
`SIM PARCIAL` com escopo preciso, checklist reponderado com integridade referencial como critério
próprio (25%, empatado com identidade estável).
