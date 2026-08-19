# Princípios de Engenharia — Expiration Tracker

> Adaptado do padrão observado no projeto irmão `event-discovery-platform` (mesmo usuário), não copiado literalmente — o primeiro princípio abaixo já recomenda isso: adotar só o que a complexidade real deste projeto justifica.

1. **Sofisticação segue complexidade observada, não medo hipotético.** Não adicionar mecanismo (sharding extra, cache, retry exótico) antes de evidência real de que o caso simples não basta. Exemplo já aplicado: `TenantQuota` usa fixed-window, não sliding-window/leaky-bucket, porque fixed-window já satisfaz "decremento atômico sem race condition" — sliding-window só entraria com evidência de abuso real em produção.

2. **Decisões caras-de-mudar são fechadas cedo; decisões baratas-de-adicionar são adiadas.** Chaves de partição/GSI, contratos de schema, fronteiras de módulo e estratégia de idempotência são Type 1 (protocolo Claude↔Codex, `AGENTS.md` §4). Reserved concurrency, batch size, thresholds de alarme são ajustáveis depois sem migração — não precisam da mesma rigidez de decisão.

3. **Restrições de infraestrutura de terceiros são domínio, não detalhe.** DynamoDB `Query` exige PK exata (é por isso que GSI3/GSI6 têm chave global — não um detalhe de implementação, é a forma como o produto pode ou não escalonar). EventBridge Scheduler não envelopa payload em `detail` como Rules legadas (é por isso que os handlers leem o evento no nível raiz) — restrições assim vão em comentário no código-fonte, não só em doc.

4. **Nenhum caminho crítico do produto pode ficar bloqueado por um componente auxiliar.** Idempotência/outbox/reconciliação existem para que uma falha de fila/rede nunca perca um lembrete silenciosamente — mas o inverso também vale: a materialização de ocorrências não pode ficar bloqueada esperando o outbox confirmar publicação (por isso o outbox é assíncrono via relay, não síncrono no caminho de escrita do agregado).

5. **Honestidade sobre simplificação deliberada.** Toda simplificação consciente (ex.: `EX-001` em `exceptions.md`, judgment calls documentados em `NEXT_SESSION_PROMPT.md`/`session-log.md`) precisa de gatilho de reavaliação explícito — não "revisar depois" vago, mas uma condição concreta ("quando M4 existir", "quando o bug upstream for corrigido").

6. **Auditar contra a realidade, não contra a documentação.** `ARCHITECTURE STATUS`/`ENGINEERING FOUNDATION STATUS` só mudam com evidência operacional real (teste real, CI real, deploy real) — nunca porque um documento foi atualizado para dizer que algo está pronto. A Engineering Maturity Review e as 3 rodadas de revisão da implementação de M3.5 (não só do design) são a aplicação direta disso.

7. **A segunda IA de revisão só vale o que ela consegue provar.** No protocolo Claude↔Codex (`AGENTS.md` §4), uma nota alta sem evidência de arquivo:linha específica, ou sem rodar o comando que prova o achado, não fecha rodada — ver `docs/engineering/change-risk-scale.md` para quando o protocolo é obrigatório.
