# Rodada 3 — Convergência (Claude, tréplica à crítica do Codex)

## Aceite integral dos 17 pontos da crítica do Codex

Claude aceita integralmente os 17 problemas levantados na crítica do Codex à proposta Claude Rodada 1 (`round2-codex-critique-of-claude.md`) — nenhum é contestado. Em particular:

- **#1 (GSI3 não consultável)**: confirmado como erro técnico real, presente em ambas as propostas independentes (Claude e Codex cometeram o mesmo erro). Fix aceito: `GSI3PK=DUE#yyyyMMddHHmm#NN` (chave global, exceção documentada à regra "toda chave começa com TENANT#tenantId", com as salvaguardas listadas pelo Codex: IAM restrito ao worker do scheduler, projeção mínima, tenantId no item/SK, teste de isolamento provando que nenhuma API tenant-facing consulta o índice).
- **#2-#5 (durabilidade do dispatch, transação de cancelamento, fronteiras modulares)**: aceitos. O desenho do Codex (producer só envia comandos; dispatch worker faz a transação; invalidação por versão em vez de cancelamento em lote transacional ilimitado) resolve os quatro pontos e é adotado no merge.
- **#6-#12 (erros técnicos AWS, envelope EventBridge, audit sem DLQ, semântica de corrective, webhook inbox subespecificado)**: todos aceitos como correções factuais. O desenho do Codex (§4, §6, §10, §11, §13, §14 da proposta Codex Rodada 1) já resolve a maioria — adotado.
- **#13-#17 (milestones inconsistentes, autenticação duplicada, autorização binária insuficiente, deleção ambígua, matriz de access patterns ausente)**: aceitos. A estrutura de milestones do Codex (M0 Guardrails → M1 Foundation/Identity → M2 Expiration/Audit → M3 Reminder → M4 Notification → M5 Document → M6 Extraction → M7 Hardening) não tem as contradições apontadas na minha proposta e é adotada como espinha dorsal do documento final.

## Pontos que Claude adiciona/mantém no merge (da crítica de Claude ao Codex, `round2-claude-critique-of-codex.md`)

1. Arquitetura de sessão, ausência deliberada de componentes e seção de ADRs pendentes do Codex são superiores — adotados integralmente (já reconhecido na rodada 2).
2. Tabela resumida de Lambdas/workers com trigger e concorrência/DLQ (útil como referência rápida) — adicionada como apêndice ao documento final, complementando (não substituindo) o detalhamento por seção do Codex.
3. Mapeamento explícito para requisitos/capacity-model (`FR/NFR/COST/SCALE-xxx → decisão → métrica`) — adicionado como seção final, ausente nas duas propostas Rodada 1.
4. Canal de e-mail como "essencial"/não sujeito a kill switch — decisão explícita tomada no merge (não deixada em aberto): e-mail é o canal padrão sem kill switch dedicado (differente de AI/OCR/WhatsApp), consistente com `architecture-fase3-consolidada.md` §14 que só lista `AI`, `OCR`, `WHATSAPP` como toggles — registrado explicitamente para eliminar a ambiguidade apontada na crítica cruzada.
5. Critério de aceite de carga do reminder amarrado quantitativamente aos três cenários de drenagem do `capacity-model.md` (16.667/3.333/278 agendamentos/s) — adicionado como critério mensurável em vez de "teste de carga" genérico.

## Resultado

Convergência forte. Nenhum ponto de discordância remanescente entre Claude e Codex sobre o conteúdo técnico do blueprint. O documento final (`docs/architecture/implementation-blueprint.md`) usa a estrutura e o texto da proposta Codex Rodada 1 como base, com: (a) a correção do GSI3/scheduler aplicada explicitamente nas seções de Reminder e de dados; (b) os pontos 2-5 acima adicionados; (c) as poucas afirmações tecnicamente incorretas identificadas (egress de Lambda, CSP nonce, EMF por-shard) já corrigidas no próprio texto do Codex Rodada 1 (essas afirmações incorretas apareciam na proposta **Claude**, não na do Codex — a crítica do Codex às vezes se refere a ambas as propostas terem o mesmo problema, mas nesses três pontos específicos [#6, #7, #8] apenas a proposta Claude continha o erro; a proposta Codex já estava correta, conforme conferência linha a linha abaixo).

Conferência dos pontos #6-#8 contra a proposta Codex Rodada 1: `§4.2` já não afirma que "Lambda sem VPC" implica ausência de egress — trata a arquitetura de sessão, não egress de Lambda; `§15` (Egress) já não propõe bloqueio via ausência de VPC como controle suficiente, e sim adapters nomeados + pré-requisitos completos (allowlist, proteção DNS rebinding, bloqueio de metadata/ranges privados) para egress futuro; `§4.2` CSP já usa nonce/hash sem prometer geração dinâmica a partir de uma response-headers-policy estática isoladamente — mas o merge torna isso ainda mais explícito, optando por **hashes CSP estáticos** (não nonce dinâmico) como mecanismo MVP, já que o frontend é SPA estática servida por CloudFront sem compute de borda no Day 0 — decisão explícita registrada no documento final para eliminar a ambiguidade que a crítica do Codex apontou como existente na formulação genérica ("CSP com nonce" nas duas propostas Rodada 1 não especificava o mecanismo de geração).

Próximo passo: publicar `docs/architecture/implementation-blueprint.md` consolidado e proceder à rodada de nota cega (mínimo 3 rodadas já cumprido: Rodada 1 proposta, Rodada 2 crítica cruzada, Rodada 3 convergência).
