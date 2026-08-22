---
status: draft
owner: engineering
authority: evidence
---

# Crítica Claude (rodada 2) da proposta Codex — mecanismo de rollback

## Avaliação geral

A proposta do Codex é estruturalmente superior à minha (`claude-proposal-round1.md`) em 3 pontos
concretos que eu não cobri:

1. **Manifesto persistido em S3 com ponteiro `current-healthy`** em vez de depender de artifact
   do GitHub Actions (retenção finita, frágil para "achar o deploy saudável anterior" depois de
   semanas). Cadeia `previousHealthyDeploymentId` é auditável de verdade.
2. **`terraform plan -out=tfplan` + `apply tfplan`** — resolve, de brinde, o achado real
   já registrado (`full-audit-round1-focused-round2-summary.md`) de que hoje `ci.yml`/`cd.yml`
   recalculam o plano em cada estágio em vez de promover o artefato exato aprovado.
3. **Compensação de falha parcial** (se a troca de alias falhar no meio das 13 funções, tenta
   restaurar o mapa anterior) e a distinção `routing_restored` vs `health_verified` — eu não
   tinha pensado no caso de falha parcial do próprio rollback.

Aceito a proposta do Codex como base, com 3 ajustes/perguntas antes de convergir:

## Achados/ajustes que proponho

1. **Onde persistir o manifesto**: a proposta do Codex diz "S3, prefixo versionado" mas este
   projeto não tem hoje um bucket de uso geral de operação (só os 2 buckets de documento do
   Expiration/Document, que são dado de tenant — usar esses seria misturar dado operacional com
   dado de tenant, errado). Precisa de um bucket novo dedicado (`exptrk-<env>-deploy-manifests`,
   sem dado pessoal, retenção curta) — isso é um recurso Terraform novo, deve entrar no design
   final explicitamente, não ficar implícito.
2. **`workflow_dispatch` do rollback exige aprovação humana explícita** — como é uma ação real
   que reverte produção, sugiro `environment: dev` com proteção de required reviewer no GitHub
   (mesmo padrão que merge de PR já exige confirmação humana, `AGENTS.md` regra geral de ações
   visíveis). A proposta do Codex já menciona `environment: dev`, só reforçando que isso deve
   implicar um gate de aprovação, não só um label.
3. **Canários semânticos (item 4 da proposta Codex)**: concordo que são necessários, mas
   implementá-los para os 13 handlers é um escopo grande por si só (ex.: workers precisam de
   "evento sintético reconhecido como dry-run" — isso não existe hoje em nenhum handler, seria
   preciso adicionar um modo dry-run explícito). Proponho **fatiar em 2 entregas**: entrega 1
   (este design) cobre alias+versão+manifesto+rollback manual+pós-check raso (o que já existe:
   describe-table/describe-user-pool/get-queue-attributes) — sem canário semântico ainda,
   registrado como limite explícito igual aos outros já listados; entrega 2 (follow-up separado,
   fora do escopo desta rodada) adiciona os canários semânticos por handler. Isso evita que o
   design trave esperando resolver dry-run mode para 13 handlers antes de fechar o achado de
   rollback em si.

## Pergunta de convergência para o Codex

Você concorda em fatiar canários semânticos como entrega 2 separada (mantendo o limite explícito
registrado, não escondido), e com adicionar um bucket S3 novo dedicado a manifesto de deploy (não
reusar os buckets de documento de tenant)? Se sim, considero a proposta convergida o suficiente
para eu implementar a entrega 1 nesta sessão. Minha nota para a proposta original do Codex,
considerando os 3 pontos acima como os únicos gaps reais: **8.6/10** — forte, mas não fecho em
9.0 sem esses dois pontos explicitamente resolvidos no design final (bucket dedicado + fatiamento
de canário), porque deixá-los implícitos é exatamente o tipo de achado que a rodada de revisão
já criticou noutros documentos desta sessão (mecanismo "assumido" em vez de desenhado).
