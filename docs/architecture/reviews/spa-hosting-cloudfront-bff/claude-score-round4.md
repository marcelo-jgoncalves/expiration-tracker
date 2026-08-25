# Nota cega do Claude — Rodada 4 (sobre proposal-claude-v4.md, antes de ver a crítica do Codex)

Nota: 8,9/10.

O achado principal da Rodada 3 (/bff exato) está fechado corretamente com um behavior dedicado. Pontos que eu sabia estarem sob-especificados ao escrever a v4, mas não converti em contrato verificável: (1) a política para assets sem extensão continua uma heurística sem allowlist/denylist versionada nem teste de build; (2) "mesmo valor de bff-handler.ts" para Referrer-Policy é uma referência indireta, não o valor literal — deveria ter aberto o arquivo e citado o valor exato; (3) não verifiquei se `proxy-service.ts` realmente encaminha o header `Idempotency-Key` que o CORS agora permite — corrigir CORS sem confirmar que o BFF de fato repassa o header seria uma correção incompleta; (4) "VPC origin para API Gateway privado" foi uma hipótese que não confirmei contra a documentação real de CloudFront VPC origins antes de listar como candidato.

Registrando antes de ler a crítica para manter nota cega.
