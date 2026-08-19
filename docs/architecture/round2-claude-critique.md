# Crítica do Claude à Proposta do Codex — Fase 3, Rodada 2

Esta é a análise crítica independente do Claude à proposta do Codex (`codex-architecture-proposal.md`), separada das perguntas de convergência já enviadas. Objetivo: aplicar o princípio anti-sycophancy da seção 57 — a proposta do Codex é tecnicamente forte, mas isso não isenta de escrutínio.

## Pontos fracos ou não endereçados

1. **Reminder shards por minuto — parâmetro `NN` não fundamentado.** A proposta usa `DUE#yyyyMMddHHmm#NN` mas não diz como o número de shards é escolhido, se é fixo ou dinâmico, nem como uma escolha errada (poucos shards → hot partition; muitos shards → overhead de fan-out) seria detectada em produção. Já registrado como item aberto na consolidação, mas vale destacar: sem um mecanismo de auto-ajuste ou pelo menos um alarme de "partition throttle", o risco fica invisível até incidente real.

2. **Quarentena de dois buckets S3 — custo e latência de UX não quantificados.** Copiar o objeto de `quarantine` para `clean` dobra temporariamente o custo de armazenamento do objeto (mesmo que por pouco tempo) e introduz uma janela de espera entre upload e disponibilidade para OCR/visualização pelo usuário — nenhum SLA de latência dessa etapa foi proposto. Além disso, GuardDuty Malware Protection tem cobertura limitada de tipos de arquivo e tamanho máximo (não é uma garantia universal); a proposta não define o que acontece com um arquivo fora da cobertura além de "fallback Fargate", nem o tempo esperado desse fallback.

3. **DynamoDB Streams tem retenção de 24h.** O outbox pattern proposto depende de Streams para publicar eventos críticos — se o consumidor ficar indisponível por mais de 24h (incidente prolongado), eventos são perdidos permanentemente, a menos que exista um mecanismo de replay/arquivamento adicional (ex.: Kinesis Data Streams com retenção maior, ou archive em S3). A proposta do Codex não menciona esse limite nem uma mitigação.

4. **Step Functions fixado como Type 1 desde o Day 0 pode ser overengineering nos estágios iniciais.** No Stage 1 (`capacity-model.md`), há ~5 chamadas de IA/OCR por dia. Orquestração via Step Functions tem custo por transição de estado e complexidade operacional que talvez não se justifique nesse volume — uma alternativa seria uma cadeia de Lambdas mais simples no MVP, evoluindo para Step Functions quando o volume ou a necessidade de auditoria/retry sofisticado justificar (seção 51, evolução por estágio). A proposta do Codex já concordou em não fixar Express antes de validar, mas não questionou se Step Functions (em qualquer variante) é necessário desde o Stage 1, ou se é uma otimização prematura.

5. **WhatsApp Business API tratado simetricamente a SES/Telegram, mas tem restrições assimétricas.** Templates pré-aprovados e janela de sessão de 24h (fora da qual só se pode enviar mensagem via template aprovado) são particularidades do WhatsApp Business API que afetam diretamente o desenho do Channel Adapter — a proposta do Codex modela os três canais com a mesma interface sem discutir se essa abstração vaza (ex.: `NotificationIntent` pode precisar de um campo "usa template aprovado?" específico de WhatsApp). Isso é Type 1 se descoberto tarde.

6. **Disaster Recovery não é abordado.** Nem a proposta do Codex nem, community, a minha própria, definem RTO/RPO ou testam restore de DynamoDB/S3 explicitamente (OPS-005 exige isso). PITR está habilitado, mas "habilitado" não é o mesmo que "testado". Fica registrado como lacuna de ambas as propostas, a fechar em `disaster-recovery.md` (Fase posterior).

7. **Proliferação de IAM roles por função — custo de manutenibilidade não discutido.** "IAM por função" (least privilege) é a escolha correta de segurança, mas com dezenas de handlers Lambda (um por módulo/worker), a superfície de gestão de policies cresce — sem um padrão de geração automatizada via CDK constructs compartilhados, isso pode virar dívida técnica silenciosa. Não é um problema de segurança, é um risco de Manutenibilidade não quantificado.

## Pontos onde a proposta do Codex é genuinamente mais forte (reconhecimento, não crítica)
- Correção do erro real sobre usage plans/HTTP API (ponto técnico que eu errei).
- Revalidação de versão do item antes de enviar notificação (evita entrega de dado obsoleto de forma mais robusta que minha proposta original).
- Desacoplamento explícito de IDs internos do `sub` do Cognito.

## Conclusão
Nenhum dos pontos acima é motivo para rejeitar a arquitetura consolidada — são refinamentos e lacunas a fechar via ADR na Fase 3 completa, não erros estruturais. Adiciono os itens 1–7 acima à lista de "Itens abertos" já registrada em `architecture-fase3-consolidada.md` (itens 8–14 abaixo).
