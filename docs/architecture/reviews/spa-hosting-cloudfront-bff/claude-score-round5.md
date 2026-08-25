# Nota cega do Claude — Rodada 5 (sobre proposal-claude-v5.md, antes de ver a crítica do Codex)

Nota: 9,0/10.

Os 5 pontos da Rodada 4 foram fechados corretamente (denylist versionada, matriz com casos nomeados, valores literais de header, forwarding de Idempotency-Key, remoção do VPC origin inválido). Sabia que a matriz V1-V6 ainda tinha dois pontos frágeis ao escrever: (1) não incluí nenhum caso 403 apesar da Rodada 4 ter pedido "pelo menos um 403 real e um 404 real" explicitamente — reli o pedido e escrevi só 401/404/200, um descuido real; (2) V6 ficou com path condicional ("/manifest se existir ou qualquer path"), que não é determinístico — deveria ter escolhido uma rota real do React Router (`/items`, que existe em `App.tsx`) em vez de um placeholder hipotético. Também não verifiquei se `origin-request` é um evento válido para CloudFront Functions antes de propor injetar o header secreto ali (é Lambda@Edge-only).

Registrando antes de ler a crítica para manter nota cega.
