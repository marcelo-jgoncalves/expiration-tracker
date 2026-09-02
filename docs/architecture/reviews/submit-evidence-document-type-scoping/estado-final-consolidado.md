# submitEvidence()/guest flow — DocumentType validation (D-184, resolve D-175)

**Status: APPROVED e IMPLEMENTADO.** Protocolo Claude↔Codex completo, 3 rodadas reais (`codex exec`), notas finais Codex: E-014 9,3/10, design 9,5/10 (ambas ≥9,0 sem arredondar). Claude concorda com ambas as notas na leitura retrospectiva do parecer (nenhuma rodada adicional necessária — Codex já declarou `APROVADO` na Rodada 3).

## Contexto (achado real de D-175)

D-173 aprovou um catálogo `DocumentType` com `status ACTIVE/DEPRECATED` e um `ConditionCheck` transacional (`DocumentType.status=ACTIVE`) descrito em §4 como incondicional para toda criação de `Document`. D-175 migrou `createDocument()` (caminho autenticado) mas deliberadamente NÃO tocou `submitEvidence()` (guest upload, sem RBAC): `SubmitEvidenceInput.documentType` é opcional no schema HTTP real e cai para `requirementId` quando ausente — aplicar o `ConditionCheck` incondicionalmente quebraria a maioria dos submits guest hoje (`requirementId` nunca é um `DocumentTypeId` real). D-175 nomeou 3 opções sem escolher: (a) tornar `documentTypeId` obrigatório no schema guest agora; (b) aplicar o `ConditionCheck` só quando `documentType` vier explícito; (c) deixar como está até o item 6 (migração formal do schema guest).

Achado adicional confirmado por leitura de código nesta sessão: nem `DocumentRequest` nem `Requirement` referenciam hoje um `DocumentType` esperado — não existe mecanismo de descoberta para um guest saber qual `documentTypeId` é correto para o link que recebeu.

## Declaração E-014 (pesquisa externa)

**SIM PARCIAL.** Checklist pesado, pesos somando 100%, todos satisfeitos:

- **C1 (30%)** — a mudança nunca introduz novo modo de falha em tráfego que hoje funciona sem o campo. Satisfeito: fallback sem `documentType` continua byte-idêntico.
- **C2 (25%)** — só valida um valor que o próprio chamador escolheu fornecer, na primeira execução real de cada `idempotencyKey` (redefinido explicitamente na Rodada 3 para excluir replay — ver `## Semântica de replay` abaixo). Satisfeito.
- **C3 (30%)** — nenhuma resposta de erro distingue causa interna para um chamador não autenticado. Satisfeito: aplicação local do princípio de cautela na exposição de detalhes de erro de [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457) (acesso 2026-09-02) — o colapso concreto em `GuestAccessInvalidError` é decisão local pré-existente (Decision 4), não exigência textual da RFC.
- **C4 (15%)** — obrigatoriedade plena (opção a/item 6) só avança depois que existir mecanismo de descoberta do valor correto. Satisfeito, ancorado em [Martin Fowler — Parallel Change](https://martinfowler.com/bliki/ParallelChange.html) (acesso 2026-09-02): fase *expand* (campo opcional, validado quando presente) antes de fase *contract* (campo obrigatório).

Representatividade: RFC ativa do IETF + padrão de indústria citado há mais de uma década em migração de schema — não fontes isoladas. (Rodada 1 citou Stripe/RFC 7807 incorretamente; Rodada 2 do Codex rejeitou por falta de peso/URLs/RFC desatualizada; corrigido na Rodada 3.)

## Decisão

**Opção (b) modificada**, nem (a) nem (c) puro: aplicar `ConditionCheck(DocumentType.status=ACTIVE)` em `submitEvidence()` **somente quando `input.documentType !== undefined`** (presença explícita do campo cru, não truthy — string vazia já é rejeitada pelo schema HTTP, mas o guard do serviço trata presença corretamente mesmo assim). Quando ausente, comportamento é byte-idêntico ao anterior (fallback para `requirementId`, nunca validado). Quando presente, o `ConditionCheck` roda na MESMA `TransactWriteItems` do `Document`/`DocumentVersion` (TOCTOU-safe, mesmo padrão de `createDocument()`), e qualquer cancelamento colapsa no `GuestAccessInvalidError` genérico já existente (nenhuma distinção nova de erro, anti-enumeração preservada).

Rejeitada (a): tornar o campo obrigatório agora forçaria o guest a adivinhar um `documentTypeId` sem nenhum mecanismo de descoberta (nem `DocumentRequest` nem `Requirement` referenciam um hoje) — pior que o estado atual, não "ainda não implementado". Rejeitada (c) pura: a rota aceita um `documentType` explícito hoje sem NUNCA validá-lo contra o catálogo — lacuna de integridade referencial real, corrigível sem quebrar nada (quem envia explicitamente já optou por um valor específico).

### Oráculo residual (reconhecido, não eliminado)

Para um guest com sessão válida que escolhe enviar `documentType` explícito, sucesso vs. erro genérico revela se aquele `DocumentType` existe/está ACTIVE. Superfície estritamente mais estreita que a enumeração pré-existente do próprio token/sessão (rate-limited, exige sessão já resolvida) e o MESMO padrão de oráculo já aceito no caminho autenticado equivalente (`createDocument()`, D-175). Trade-off deliberado, não lacuna descoberta tardiamente.

### Semântica de replay (achado real da Rodada 2, resolvido na Rodada 3)

`existingReplay` (lookup por `idempotencyKey`) roda ANTES de qualquer validação de payload — propriedade pré-existente do mecanismo (D-143 Decision 4), não introduzida por esta fatia (`fileName` também nunca foi revalidado num replay). Decisão: manter essa ordem. `idempotencyKey` identifica uma operação lógica, não um payload re-checado por tentativa — a PRIMEIRA execução real de um dado key fixa o resultado; uma repetição do mesmo key com `documentType` diferente (mesmo inválido) devolve o snapshot original. C2 do checklist E-014 foi redefinido para cobrir só a primeira execução real de cada key.

## Implementação (mesma sessão, D-184)

- `src/modules/document-archive/application/guest-document-access-service.ts`: guard `documentTypeSupplied = input.documentType !== undefined`; `ConditionCheck` (`buildExistenceConditionCheck`, `documentTypeKey`) adicionado condicionalmente ao array de `entries` de `submitEvidence()`, antes dos `Put`s.
- `test/unit/document-archive/guest-document-access-service.test.ts`: 5 testes novos (`t1` ausente/fallback intocado, `t2` explícito ACTIVE sucesso, `t3` explícito inexistente rejeita genérico, `t4` explícito DEPRECATED rejeita genérico — mesmo padrão TOCTOU-safe de D-175, `t_replay` prova replay payload-agnóstico ignorando um `documentType` divergente/inválido na repetição).
- Sem mudança de schema HTTP, infra, ou RBAC. Item 6 do arco D-173 (schema guest obrigatório + mecanismo `Requirement`→`DocumentType`) permanece próxima fatia independente, não decidida aqui.
- `typecheck`/`lint --max-warnings=0` limpos; suíte do arquivo (18/18) verde. Suíte completa do repositório não pôde ser confirmada 100% limpa nesta sessão porque outra sessão concorrente tinha WIP não commitado tocando arquivos não relacionados (`infra/`, workers de `requirement-reindex`) no mesmo working tree — a mudança desta decisão está isolada a 2 arquivos, sem overlap com esse WIP.

## Notas finais do protocolo

| Rodada | E-014 (Codex) | Design (Codex) | Resultado |
|---|---|---|---|
| 1 | 4,2/10 (régua contestada) | 8,7/10 | Não aprovado — corrigir régua, guard `!==undefined`, testes, oráculo residual |
| 2 | não aprovado (faltou peso/URLs/RFC 9457) | quase aprovado, achou interação com replay não especificada | Não aprovado |
| 3 | 9,3/10 | 9,5/10 | **APROVADO** |

Transcrições completas das 3 rodadas reais (`codex exec --skip-git-repo-check`) disponíveis no histórico de comandos desta sessão; não persistidas como arquivo separado neste diretório para manter o design doc como fonte única de verdade (mesma prática que os designs mais recentes deste repo já adotam).
