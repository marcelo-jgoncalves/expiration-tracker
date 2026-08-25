# Nota cega do Claude — Rodada 3 (sobre proposal-claude-v3.md, antes de ver a crítica do Codex)

Nota: 9,0/10.

A v3 fecha o achado bloqueante real da Rodada 2 (custom_error_response global) com um mecanismo (CloudFront Function só no default behavior) que resolve por construção, não por convenção. Ponto que eu sabia estar sob-especificado ao escrever: a heurística "URI sem ponto = rota SPA" no pseudocódigo é uma simplificação de exemplo, não testei explicitamente o caso do path exato `/bff` (sem barra/sufixo) nem paralelizei contra possíveis assets futuros sem extensão (`/manifest`, `/.well-known/...`) — deixei isso implícito em "esboço" em vez de tratar como parte do contrato a fechar nesta decisão. Também não amarrei a Response Headers Policy do BFF a um teste que force uma resposta que nunca passa pelo Lambda (só descrevi a semântica `override=false`).

Registrando antes de ler a crítica para manter nota cega.
