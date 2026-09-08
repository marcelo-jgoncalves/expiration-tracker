---
status: draft-round2
owner: claude
authority: audit-evidence
---

# Full-audit round2 — Eixo Arquitetura — Réplica Claude, Rodada 2

Nota cega da Rodada 1 já revelada dos dois lados (Claude 8.42 ponderado, Codex 9.085 ponderado —
ver `full-audit-round2-arquitetura-claude-round1.md` e `-codex-output-round1.txt`). Codex achou um
bug real que a proposta Claude R1 não tinha achado por leitura direta: `src/workers/
guest-credential-delivery/deliver.ts` reivindica o marcador idempotente (`markerStore.claim`,
linha 66) ANTES de chamar `emailProvider.send()` (linha 71). Verificação adicional feita nesta
rodada (não só aceitar o achado): o handler (`guest-credential-delivery-handler.ts:54`) marca
`SEND_FAILED` como falha de item de batch (retry via redrive nativo do DynamoDB Streams Event
Source Mapping) — mas o retry chama `deliverGuestCredential` de novo, que chama `claim()` de novo,
que retorna `false` (já reivindicado), produzindo `ALREADY_DELIVERED` em vez de tentar reenviar.
**Resultado real: uma falha de SES entre o claim e o send suprime a entrega para sempre, sem alarme
dedicado e sem possibilidade de correção via redrive nativo** — o próprio comentário do código
(linha 24) documenta a troca consciente ("claiming happens BEFORE the SES call") mas descreve o
efeito de forma equivocada ("unclaimed-but-unsent" — o estado real é "claimed-but-unsent", exatamente
como o Codex identificou). Concordo com a classificação de achado real, não é falso positivo.

## Onde discordo do Codex (pontos de reconciliação necessários)

1. **Severidade do achado de entrega guest**: Codex marcou "bloqueante" dentro do critério Reliability
   mas manteve a nota em 8.8 (só 0.? abaixo do que daria sem o achado) — pontuação inconsistente com
   a própria classificação de severidade. Um caminho de perda de dado SILENCIOSA (sem alarme, sem
   redrive eficaz) em um fluxo de negócio real (comprador não recebe o link porque um provider de
   e-mail teve soneca temporária) é uma classe de bug que a Rodada 1 já tinha identificado como a mais
   cara do projeto (mesma classe do achado original de GSI3 órfão que motivou o peso alto de
   Reliability). Proponho nota mais conservadora para Reliability: **7.8**, não 8.8 — o padrão
   "claim-then-send" já é aceito em outro lugar do código (`document-request-service.ts`'s initial
   invite, citado no próprio comentário) mas isso means a mesma classe de risco existe em pelo menos
   2 lugares, sem um princípio de design ou fitness function que prove que outros workers futuros não
   repetirão o padrão.

2. **Event & Integration Correctness também deveria refletir o mesmo achado**: a garantia de entrega
   efetivamente-uma-vez (ou ao menos "at-least-once com correção automática") que o resto do pipeline
   assíncrono do projeto entrega (outbox, DLQ, redrive) não se aplica aqui — o "redrive" do DynamoDB
   Streams Event Source Mapping é estruturalmente inútil para esta falha porque o estado interno do
   worker (o claim) já é definitivo antes da tentativa de entrega. Reduzo minha proposta de 8.2 (R1)
   para **7.9** neste critério.

3. **Onde concordo integralmente com o Codex**: AppConfig corrigido (confirmo, já tinha achado o
   mesmo na R1 própria); EMF/dashboard ainda ausente (confirmo); fan-out sem cap em
   `resolveActiveMembership`/`OnboardingStateResolver` é um achado novo real que eu não tinha
   verificado — aceito a evidência (arquivo:linha citados, hidratação `Promise.all` sem cap
   observável); GSI9/LeadingKeys — não verifiquei linha exata mas não contesto.

4. **Onde sou mais otimista que o Codex**: Testability & Delivery Safety — concordo com 9.4 (ADR-0009
   fechou o gap estrutural, suíte 2625/2625 real, `terraform test` 23/23 contra AWS real confirmado
   nesta sessão). Architecture Governance — concordo com 9.4, é o critério mais consistentemente forte
   do projeto desde a Rodada 1.

## Notas revisadas Claude, Rodada 2

| # | Critério | Peso | Nota Claude R2 | Mudança vs R1 |
|---:|---|---:|---:|---|
| 1 | Domain Fit & Simplicity | 8% | 9.0 | +0.2, aceito racional do Codex |
| 2 | Reliability & Fault Recovery | 16% | 7.8 | -0.5, achado real de perda silenciosa de entrega pesa mais que o Codex propôs |
| 3 | Event & Integration Correctness | 11% | 7.9 | -0.3, mesmo achado acima |
| 4 | Data Model & Consistency | 13% | 8.9 | +0.3, aceito GSI8 LeadingKeys como evidência adicional de disciplina |
| 5 | Security & Privacy | 13% | 9.0 | +0.6, AppConfig confirmado corrigido, IAM negativo real confirmado |
| 6 | Modifiability & Evolvability | 7% | 8.9 | +0.1, aceito achado de duplicação GSI4 como pequeno mas real |
| 7 | Observability & Operability | 8% | 7.8 | +0.2, alarmes cresceram mais do que eu tinha reconhecido, EMF continua ausente |
| 8 | Testability & Delivery Safety | 8% | 9.2 | +0.5, terraform test 23/23 real confirmado nesta sessão |
| 9 | Cost & Resource Governance | 5% | 8.5 | +0.5, aceito budget como suficientemente resolvido |
| 10 | Performance & Scalability Fitness | 4% | 8.0 | +0.2, aceito evidência de teste de ~977 invocações citada pelo Codex |
| 11 | Architecture Governance & Traceability | 7% | 9.2 | +0.2 |

Nota ponderada Claude R2: **8.55/10** — ainda abaixo do gate de 9.0 (achado real de Reliability
puxa a média, peso 16% é o maior do eixo).

## Achados consolidados para a Rodada 3 (pedir reconciliação ao Codex)

1. Perda silenciosa de entrega de credencial guest (`deliver.ts`) — pedir ao Codex se concorda que
   isto rebaixa Reliability abaixo de 8.0, não apenas para 8.8.
2. EMF/dashboard ainda ausente — ambos concordam, não-bloqueante, pendência nomeada.
3. Fan-out sem cap em onboarding B2B — ambos concordam, não-bloqueante.
4. Lifecycle de `DossierExportRun`/`ReportSubscriptionRun` sem TTL — aceito o achado do Codex, novo,
   não verificado por mim na R1 — não-bloqueante mas real (nova classe de dado que ainda não tem
   classificação de retenção LGPD explícita, risco de escopo similar ao já resolvido para outras
   entidades em D-151 a D-156).
5. D-231 (WhatsApp) nunca aplicado contra `dev` real — achado próprio da R1 Claude, Codex não
   mencionou; perguntar se concorda que é pendência nomeada válida (não achado de nota, já está
   documentado como pendente no próprio `NEXT_SESSION_PROMPT.md`).
