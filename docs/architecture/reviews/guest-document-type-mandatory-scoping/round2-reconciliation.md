# Round 2 — reconciliation (both proposals revealed)

Claude revealed both Round 1 proposals to Codex (`round1-claude-proposal.md` and `round1-codex-blind-proposal.md`, produced fully independently/blind of each other) and asked for critique + a joint final design + updated scores. Codex's full Round 2 response follows verbatim.

---

## Rodada 2 — reconciliação

A premissa está confirmada com força suficiente para esta decisão.

`AGENTS.md` §1 declara canonicamente que o projeto não possui usuários reais nem ambiente de produção; existe somente `dev`, com dados sintéticos e resetáveis. `NEXT_SESSION_PROMPT.md` reafirma o estágio pré-lançamento. Não há evidência no repositório de consumidor guest externo real.

Isso não prova metafisicamente que ninguém jamais chamou a rota em `dev`, mas prova o ponto relevante: não existe contrato de produção ou consumidor real que justifique uma transição expand-contract. Portanto, o precedente de corte limpo aplica-se.

Uma correção ao framing de Claude: D-176 é o precedente direto — renomeou o contrato autenticado sem coexistência ou shim. D-093 não estabeleceu por si só uma política de corte; ele corrigiu o uso indevido de "risco a usuários legados" como justificativa. Juntos, sustentam a conclusão, mas desempenham papéis diferentes.

### Crítica e síntese das propostas

As duas propostas convergem corretamente em: tornar `documentTypeId` obrigatório agora; remover `documentType`; eliminar o fallback para `requirementId`; não criar shim, header de depreciação ou período de coexistência; exigir que o tipo referenciado esteja `ACTIVE`; reconhecer honestamente a ausência de precedente específico em APIs de guest upload.

Pontos fortes distintos: a proposta de Claude fundamentou melhor a aplicabilidade interna do corte limpo e foi prudentemente conservadora quanto à premissa de ausência de consumidores; a proposta Codex usou fontes primárias mais fortes para classificar optional→required como breaking change e identificou uma decisão que Claude deixou implícita — replay com a mesma `idempotencyKey` e outro `documentTypeId`.

A telemetria sugerida na proposta Codex deve ser tratada apenas como verificação operacional, não como condição de aprovação. Mesmo que existam chamadas sintéticas em `dev`, isso não cria obrigação de compatibilidade.

## Design final conjunto

### 1. Contrato HTTP

Alterar `schemas/api/docarchive-guest-submit-evidence-request.v1.json` em corte único:

```json
{
  "required": ["fileName", "documentTypeId", "idempotencyKey"],
  "properties": {
    "fileName": { "type": "string", "minLength": 1, "maxLength": 255 },
    "documentTypeId": { "type": "string", "minLength": 1, "maxLength": 100 },
    "idempotencyKey": { "type": "string", "minLength": 1, "maxLength": 128 }
  }
}
```

Remover completamente `documentType`. Como `additionalProperties` permanece `false`, clientes que enviarem o nome antigo serão rejeitados (400, não 500 — confirmar via teste de contrato).

Não criar versão paralela, alias, header de depreciação ou aceitação dos dois campos. O arquivo continua `v1` — não existe API versionada externamente nem consumidor de produção a preservar; esse sufixo identifica hoje o schema interno, não uma linha pública mantida simultaneamente. A rota de descoberta implementada em D-224 (`GET .../document-types`) permanece o caminho oficial para o guest obter IDs válidos e ativos antes da submissão.

### 2. Serviço (`guest-document-access-service.ts`)

`SubmitEvidenceInput`:
```ts
export interface SubmitEvidenceInput {
  fileName: string;
  documentTypeId: string;
  idempotencyKey: string;
}
```

Em `submitEvidence()`: remover `input.documentType ?? requirementId`; remover `documentTypeSupplied`; usar exclusivamente `input.documentTypeId`; preencher `Document.documentTypeId` e `documentGsi2Keys()` com esse valor; inserir sempre, na posição `[0]`, o `ConditionCheck(DocumentType.status=ACTIVE)` (mesmo `buildExistenceConditionCheck`/`documentTypeKey` de D-175/D-184, agora incondicional em vez de condicional); preservar o `catch` genérico e a postura anti-enumeração (tipo inexistente ou `DEPRECATED` resulta no mesmo `GuestAccessInvalidError`, sem erro distinguível); manter todas as demais escritas na ordem atual após o check; preservar o fence por último. Não adicionar leitura prévia do catálogo — o `ConditionCheck` transacional continua sendo a autoridade TOCTOU-safe.

### 3. Política de replay (decisão explícita nova, gap identificado pelo Codex)

**Payload-agnostic, first-write-wins**, preservando D-143 Decision 4 / D-184: a `idempotencyKey` identifica uma operação lógica, não uma combinação de payload. Depois de sessão e CSRF validados, um replay retorna o `resultSnapshot` da primeira submissão — mesmo que o replay traga outro `fileName` ou outro `documentTypeId`. O segundo `documentTypeId` não é consultado nem comparado com o primeiro; nenhum novo documento ou versão é criado. Não introduzir conflito por hash de payload nesta mudança; manter o `payloadHash` atual, sem alegar que ele representa o corpo completo. Clientes que desejem outra submissão devem usar uma nova `idempotencyKey`.

### 4. Testes obrigatórios (checklist para a sessão de implementação)

- ausência de `documentTypeId` falha na validação HTTP (400);
- `documentType` (nome antigo) é rejeitado por `additionalProperties:false`;
- `documentTypeId` `ACTIVE` cria o documento e compõe corretamente o GSI2;
- tipo inexistente e `DEPRECATED` falham com o mesmo erro guest genérico (TOCTOU-safe, mesmo padrão de flip real via `transactWrite` que D-175/D-184 já usam);
- remover ou inverter o `ConditionCheck` faz o teste falhar (G-V3);
- replay com mesma chave e mesmo payload retorna o snapshot original;
- replay com mesma chave e outro `documentTypeId` também retorna o snapshot original e não cria segunda versão;
- nova chave com outro `documentTypeId` executa uma nova submissão e valida esse tipo normalmente;
- não existe mais caminho que grave `requirementId` em `Document.documentTypeId` (atualizar/remover os testes existentes de fallback do arquivo, que ficam obsoletos por design).

### 5. Migração e rollout

- Não há migração de consumidor ou janela de depreciação — corte único.
- Registros antigos em `dev` que contenham `requirementId` no atributo `documentTypeId` (escritos antes deste corte) não devem ser reinterpretados nem backfilled automaticamente.
- Dados são sintéticos em `dev`; podem ser removidos por reset/reseed separado conforme procedimento já autorizado, mas o deploy desta mudança não deve disparar reset implicitamente.
- Verificação operacional recomendada antes do deploy (não bloqueante): checagem breve de logs/telemetria de `dev` por chamadas reais omitindo o campo — resultado não reabre a decisão automaticamente, é apenas rede de segurança.
- Atualizar `decisions-log.md` e remover a pendência do handoff (`NEXT_SESSION_PROMPT.md`) após a implementação real + gates passarem.
- Gates a rodar na sessão de implementação: schema/contract tests, `typecheck`, `lint --max-warnings=0`, `check-boundaries`, `check-docs`, `validate-schemas`, `build:lambdas`, suíte completa.

## Notas finais da Rodada 2

- Rigor E-014: **9,3/10**
- Solidez da decisão e desenho: **9,6/10**

Ambas acima de 9,0, sem arredondamento, desenho estável. **APROVADO — Rodada 3 não necessária.**

## Claude's concurrence (retrospective, after reading Codex's Round 2 in full)

Agree with both scores and the joint design as written — no further disagreement to litigate. Codex's correction to my D-093/D-176 framing is accepted: D-176 is the direct clean-cut precedent for this exact codebase; D-093 is the adjacent rule about not overusing "legacy user risk" as an excuse, a supporting point rather than the primary precedent. The one addition I'd flag for the implementation session (not a scoring objection, since it's already covered by "Testes obrigatórios" above): the existing D-184 tests in `guest-document-access-service.test.ts` that assert the *optional*/fallback path (`documentTypeSupplied === false` behavior) become obsolete by design and must be removed or rewritten, not left dangling — Codex's checklist item 4/9 covers this but it's worth naming explicitly since removing tests silently is easy to under-scope. Final retrospective score: 9.4/10 (same convention D-184 used — concurring with the Round-that-closed rather than forcing a redundant Round 3 restatement of agreement).
