# Rodada 1 — Crítica Codex (via MCP `mcp__codex__codex`, thread `01a05132-fde0-7732-aba8-9ee02e65fcad`)

**Régua contestada nesta rodada — nota da régua e nota do design registradas separadas, per `research-protocol.md` §"Reconciliação quando o Codex contesta o checklist" (nunca uma nota única enquanto a régua está em disputa):**

- Nota da régua (checklist da proposta Rodada 1 está certo?): **7.4/10**
- Nota do design (assumindo a régua atual como referência provisória, o design atende?): **8.2/10**

## Achados

1. **Representatividade da pesquisa incompleta** — NIST/ANSI INCITS 359 (RBAC formal, Hierarchical RBAC/RBAC1) não foi consultado antes de declarar `SIM` completo; `research-protocol.md` exige checar padrão estabelecido relevante não considerado antes de fechar a declaração.
2. **"3 de 4 convergem para ADMIN=OWNER nas actions atuais" é uma leitura forte demais das fontes** — GitHub decompõe (não sustenta parity), Linear diz textualmente que Owner tem "full administrative control e settings sensíveis" enquanto Admin tem "permissões mais limitadas" (não é parity total, mesmo hoje), Slack é a fonte mais favorável mas ainda tem itens Owner/Primary-Owner-only reais.
3. **Atribuição de "default-deny" ao Slack overclaimed** — a fonte mostra matriz explícita por papel, não a frase literal "unlisted actions implicitly restricted"; default-deny deve ficar ancorado em OWASP + no código local, não citado como achado direto do Slack.
4. **Checklist critério 1 predetermina a resposta em vez de medir o trade-off** — "atende" já era definido como paridade total, o próprio ponto controverso da decisão.
5. **Falta exigir explicitamente que ADMIN não enfraqueça tenant-mismatch/lifecycle-gate/resource-ownership** — a régua só cobria "role desconhecida ainda falha fechado", não as invariantes já existentes no código real (`authorization.ts:151`, `resolve-request-context.ts` gate de lifecycle).
6. **Branch de ownership-bypass (`authorize.ts:161-173`) tem teste real (`authorization.test.ts:60`) que a proposta não decidiu explicitamente para `ADMIN`** — caracterizei esse branch como "código morto" (verdade só para call sites reais); a proposta precisa decidir e testar o comportamento de `ADMIN` nesse branch, não deixar implícito.
7. **Contagem factual errada** — proposta dizia 29→"26 actions"; `authorization.ts` declara 29 (confirmado por leitura própria).

## Respostas às perguntas abertas da Rodada 1

1. Não aprova parity total como conclusão "derivada da pesquisa" sem mais análise — aceita ADMIN em READ_ONLY/WRITE; para o tier `ADMIN_ROLES`, aceita parity em `item:delete`/`document:delete`/`subject:delete`/`requirement:delete`, mas pede análise nomeada explícita para `notification:configure` e `tenant:configure-document-request-delivery` (mais perto do bucket "workspace settings" que Notion/Linear/Slack tratam à parte).
2. Ausência de diferenciação prática Owner-vs-Admin é aceitável só como estado temporário, documentado como tal (não como propriedade permanente do produto).
3. Sim — faltou NIST/ANSI INCITS 359 (RBAC formal) e a ressalva OWASP de que RBAC puro tem limitações para controle horizontal/multi-tenant (ABAC/ReBAC).

## Régua reconciliada que o Codex aceitaria como direção

- Critério 1: não exigir paridade total — exigir "hierarquia explícita + exceções Owner-only nomeadas e justificadas individualmente".
- Critério 2: incluir explicitamente que ADMIN não pode enfraquecer tenant/lifecycle/resource-ownership constraints já existentes.
- Critério 3: mantém-se, mas corrigir a contagem de actions.
- Critério 4: corrigir contagem + exigir teste explícito do branch `ownerUserId`/`assigneeUserId` decidindo a semântica de `ADMIN` ali.
