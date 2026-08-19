# Rodada 5 — correções pós nota-cega-1 e nova nota Claude

## Contexto
Nota cega Rodada 4: Claude 9.10, Codex 8.8 (discordância real, abaixo do limiar — reabre rodada por regra do protocolo, sem arredondar/tirar média).

Achados válidos do Codex, todos aceitos e corrigidos:
1. Cabeçalho declarava `APPROVED` e citava notas antes da rodada de nota cega ter concluído — procedimentalmente inconsistente com avaliação cega. **Corrigido**: cabeçalho agora declara "em avaliação", sem número anunciado previamente.
2. Contradição real entre §10.3 ("verifica kill switch do canal" para todo delivery worker) e §17.3 (e-mail não tem kill switch). **Corrigido**: §10.3 agora diz explicitamente "quando aplicável" e nomeia que `EmailDeliveryWorker` pula o passo; M4 (§19) também corrigido para não listar "kill switch" como entrega genérica quando na verdade só WhatsApp o tem.
3. §26 prometia tabela de concorrência/DLQ mas não tinha coluna de concorrência. **Corrigido**: coluna `Reserved concurrency (inicial)` adicionada com valores por função, marcada explicitamente como ponto de partida Stage 0-2 a recalibrar.
4. ADRs materialmente relevantes listados como abertos sem distinção do que é decidível agora vs. dependente de pesquisa externa. **Corrigido**: §23 reestruturada em 23.1 (fechados nesta rodada: BFF de sessão, lookup cognitoSub→userId, limites do sandbox PDF, política DST, Lambdas de extração separadas desde o dia 1), 23.2 (já cobertos por outro documento normativo — retenção) e 23.3 (genuinamente dependentes de pesquisa externa/decisão de produto já registrada como tal em outros documentos do projeto — provider de e-mail, ferramenta de backup S3, ferramenta de assinatura de pipeline, e o registro mecânico da ratificação do GSI3 em `data-model.md`).

## Nova nota Claude (Rodada 5)

Os quatro pontos do Codex eram procedurais/de completude, não erros de fundo na arquitetura proposta — nenhum deles reabriu os 17 pontos da Rodada 2 (que Codex confirmou, na própria nota 8.8, como genuinamente corrigidos: "I did not find a reappearance of the central GSI3, outbox, cancellation-limit, or AWS-factual defects"). Com os 4 pontos corrigidos:

**Claude: 9.15** — mantenho a mesma avaliação de fundo da Rodada 4 (o conteúdo técnico já estava correto), com pequeno incremento porque a lacuna de "ADRs materialmente relevantes abertos" — meu próprio critério de risco na nota anterior — agora está fechada para os itens decidíveis sem pesquisa externa, e a contradição de kill switch (defeito real que eu não tinha notado) está corrigida.
