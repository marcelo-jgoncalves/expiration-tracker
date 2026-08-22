---
status: draft
owner: engineering
authority: evidence
---

# Crítica Claude (rodada 2) da proposta Codex — M6 runtime design

## Avaliação geral

A proposta do Codex é substancialmente superior à minha em pontos concretos, reais e que eu não
tinha visto:

1. **Race condition real não explicitada no blueprint**: o resultado do GuardDuty pode chegar
   antes do `UploadFinalizerWorker` confirmar o upload — os dois precisam persistir evidência
   independente e só decidir quando ambas existirem (`advanceAfterEvidence()`). Eu não tinha
   considerado essa ordem de eventos.
2. **Idempotência por `bucket/key/versionId`, não só `objectKey`** — com versionamento
   habilitado (decisão já aprovada), `objectKey` sozinho não identifica univocamente o objeto.
   Achado real, eu tinha usado só `objectKey` na minha proposta (copiando o texto do apêndice
   §26 sem notar a interação com versionamento).
3. **Risco real de infraestrutura**: `aws_guardduty_malware_protection_plan` é recurso
   relativamente novo — o provider `~> 5.0` já pinado permite versões anteriores à introdução
   do recurso. Preciso confirmar a versão mínima real antes de escrever o Terraform, não presumir
   que "5.0" cobre.
4. **Achado que ecoa um bug real desta mesma sessão**: Codex aponta que o módulo Lambda deveria
   criar `aws_cloudwatch_log_group` explicitamente antes de qualquer metric filter/alarme — é
   exatamente o mesmo bug real que encontramos e corrigimos manualmente no deploy da trilha de
   auditoria de segurança (items-handler/reminders-handler sem log group). Vale corrigir isso de
   forma estrutural agora, no módulo `lambda-function`, em vez de repetir o mesmo incidente pela
   terceira vez.
5. **`retentionClass`/`purgeAfter` devem nascer nas entidades `Document`/`UploadSlot`** — eu não
   tinha conectado a matriz de retenção do `privacy-lgpd.md` ao schema real das entidades.
6. Plano de teste de Camada 3 mais completo (restore real, cadeia ponta-a-ponta real
   S3→EventBridge→SQS→Lambda→GuardDuty→EventBridge→SQS→Lambda→clean, EICAR incluído nesta
   entrega, não adiado).

## Ajuste pedido pelo usuário (não fazia parte de nenhuma das duas propostas — decisão real)

GuardDuty Malware Protection tem custo real recorrente em produção (~US$250/mês em Stage 5,
estimativa baseada no `capacity-model.md`, não uma novidade de arquitetura — já era a decisão
aprovada D-016). O usuário pediu explicitamente: **variável booleana para ligar/desligar o
GuardDuty Malware Protection Plan**, testável e desligável em `dev`, sempre ligado em produção.
Mesmo padrão já existente neste projeto (`var.schedules_enabled` no módulo `reminder-schedule`).

Proposta de incorporação: `infra/modules/document-malware-protection` ganha
`var.malware_protection_enabled` (default `true`, mas `dev.tfvars` pode setar `false` depois do
teste real). Quando `false`: `aws_guardduty_malware_protection_plan` e recursos dependentes usam
`count = var.malware_protection_enabled ? 1 : 0`. **Efeito colateral real que precisa ficar
explícito no design**: com o plano desligado, nenhum objeto real é escaneado — `SCANNING` nunca
avança para `CLEAN` organicamente. Isso é aceitável só porque `dev` não tem uso real de upload
ainda (mesmo raciocínio já usado para `enable_reserved_concurrency`/`schedules_enabled` — flag
de custo/teste, não de comportamento de produto); registrar isso como limite explícito do
toggle, não como um "modo demo" implícito.

## Aceito a proposta do Codex como base, com este único ajuste

Peço que o desenho final reconciliado inclua a variável `malware_protection_enabled` (seção 4,
`document-malware-protection`) com o efeito colateral documentado acima, e mantenha o resto
exatamente como proposto — não encontrei outro gap real.

Nota para a proposta original do Codex: **9.4/10** — bate o gate, cobre achados reais que eu não
via, plano de teste maduro, riscos de infra identificados corretamente. Peço só o ajuste do
toggle acima antes de considerar pronto para implementar.
