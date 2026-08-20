---
status: historical
owner: claude+codex
authority: evidence-round (not normative — red team findings, informed G8 scoping)
---

# Checkpoint 12 — Engineering Red Team (Formal)

2026-08-19. Passada formal e ampla (não só "o que mudou", como as passadas leves anteriores), cobrindo as 20 categorias do Prompt Mestre §28 sobre o sistema como um todo. Íntegra em `_codex-output-round1.txt`.

## Achados prioritários (Codex)

1. **P1 — Pipeline assíncrono não operacional e sem recuperação**: handlers Lambda são placeholder (`501`), sem SQS/DLQ/EventBridge wired. Núcleo de G8.
2. **P1 — Idempotência não provada no limite do efeito externo**: claim determinístico protege contra parte das duplicatas, mas não o cenário "efeito externo realizado, confirmação perdida" (clássico de sistemas at-least-once).
3. **P1 — False-green entre lógica pura e comportamento implantado**: CI genuinamente verde, mas não testa o sistema assíncrono real — risco de má-interpretação de "130 testes + CI verde" como prontidão do Reminder Engine quando não é.
4. **P1 — Concorrência/estado obsoleto entre renew/cancel, materialização, dispatch, reconciliation**: OCC protege o agregado, não há evidência de fencing antes do efeito externo (reminder antigo pode ser enviado após mudança legítima de estado).
5. **P1 — Blast radius cross-tenant do GSI3**: IAM limita quem acessa o índice, mas um erro no consumidor autorizado (ReminderProducer) pode, em tese, afetar múltiplos tenants — falta teste negativo no adapter real, não só na lógica de domínio (que ainda não existe).

**Maior risco real segundo o Codex**: ausência de uma garantia ponta a ponta de entrega assíncrona correta e recuperável — combina perda silenciosa de notificação, duplicação, envio de estado obsoleto, ausência de recuperação, e falsa percepção de prontidão. **Nenhum P0 identificado no estado pré-produção atual**, mas os P1 listados impedem aprovação — confirma que `NOT APPROVED` e G8 aberto são tecnicamente corretos, não excesso de rigor.

## Achados sem informação suficiente (não avaliados, não presumidos)

Permissões efetivas do workflow por job (contents/actions/security-events/id-token/packages/pull-requests), presença de credenciais AWS/OIDC/secrets acessíveis a jobs de PR, política de redaction exata do `SecureLogger` (quais campos são de fato registrados), secret leakage em histórico Git — o Codex explicitamente recusou-se a supor essas categorias sem evidência, seguindo a regra de "ausência de evidência ≠ nota neutra" do próprio Prompt Mestre.

## Achado resolvido diretamente (item 9 — workflow permissions)

Verificado por leitura direta de `.github/workflows/ci.yml`: `permissions: contents: read` no nível do workflow, redeclarado igual no único job (`guardrails`) — já mínimo (sem `packages`, `id-token`, `security-events`, `pull-requests`). Nenhuma credencial AWS/OIDC é injetada ainda (comentário no próprio arquivo confirma isso é esperado só a partir de quando houver deploy real). Sem achado real aqui — o Codex pediu evidência específica antes de supor risco, a evidência mostra que o controle já é mínimo.

## Ação tomada nesta sessão

- **Bypass de boundary via import transitivo (achado do red team leve, não do formal) — fechado de verdade** (E-008, `decisions-log.md`): adicionado `dependency-cruiser` como enforcement autoritativo (resolve o grafo real, não texto literal). Ao testar contra o código real, achou **2 violações genuínas já existentes** (`domain/expiration-item.ts` e `audit-event.ts` importando de `ports/` em vez de `shared/`) e uma dependência acidental ports→ports entre os módulos `reminder` e `expiration` — ambos corrigidos na origem, não suprimidos.
- Tentativa de fechar `EX-001` (vulnerabilidade de devDependency) via upgrade do Vitest — **revertida** depois de quebrar o CI real duas vezes (bug conhecido do npm com optional dependencies cross-platform). `EX-001` permanece como exceção formal, prazo de revisão mantido.
- **G8 (achados 1, 2, 4, 5 acima) não foi atacado com uma implementação rápida** — deliberado. Construir adapters DynamoDB/SQS reais, handlers Lambda reais, e wiring de DLQ/EventBridge é trabalho do porte de um milestone completo (mesma disciplina de M0-M3: pesquisa/design → implementação → teste real → revisão Claude+Codex dedicada), não uma remediação de sessão. Fazer isso às pressas seria exatamente o "false-green" que o próprio red team identificou como o risco central — construir infraestrutura rasa só para marcar o gate como PASS seria pior do que deixá-lo honestamente aberto. Decisão levada ao usuário.
