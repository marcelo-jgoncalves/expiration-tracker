# Crítica Codex — Rodada 6 (sobre proposal-claude-v6.md) — FECHAMENTO

Nota: 9,3/10 — APROVAÇÃO EXPLÍCITA E FINAL

1. Nota

9,3/10.

2. Verificação adversarial

As cinco correções da v6 estão confirmadas pelo código real:

- V5-403 é determinístico: `handleProxy` resolve a sessão e executa `checkCsrf` antes do encaminhamento. Em `POST /bff/api/items`, CSRF ausente ou divergente retorna 403 com `CSRF_CHECK_FAILED`. A rota também consta na allowlist.
- V6 usa `/items`, rota real declarada em `frontend/src/App.tsx`.
- V1/V2 estão corretamente atribuídos ao API Gateway HTTP API pré-Lambda: `local.bff_routes` contém somente seis rotas explícitas e nenhuma rota `$default`.
- A substituição de CloudFront Function em `origin-request` por `custom_header` está tecnicamente correta. CloudFront Functions permanecem restritas ao evento `viewer-request` do default behavior.
- A validação de `frontend/dist/` ficou operacionalmente inequívoca: um checker compartilhado será executado no CI de PR e novamente no deploy.

Também confirmei que:

- `POST /items` é allowlisted pelo BFF.
- Uma rota não allowlisted é rejeitada depois da resolução da sessão, sustentando V5-404.
- Os behaviors explícitos `/bff` e `/bff/*` impedem que caminhos reservados alcancem o fallback da SPA.
- `AllViewerExceptHostHeader`, cache desabilitado no BFF, OAC exclusivo do S3 e SPA routing somente no default behavior formam um desenho coerente.

3. Achados remanescentes

Nenhum achado bloqueante novo.

Os elementos ainda fora do escopo — CSP exata, domínio/certificado, estratégia final de invalidação e implementação do gate contra acesso direto ao `execute-api` — permanecem explicitamente registrados como etapas posteriores. Isso não invalida a decisão de coexistência nem reabre pontos das rodadas anteriores.

4. Veredito final

APROVAÇÃO EXPLÍCITA E FINAL.

Está aprovada a Alternativa (a): uma única distribution CloudFront, com behaviors `/bff` e `/bff/*` direcionados ao API Gateway do Full BFF usando `AllViewerExceptHostHeader`; default behavior direcionado ao S3 com OAC; e CloudFront Function de SPA routing associada exclusivamente ao default behavior.

A decisão alcança o gate mínimo de 9,0 do protocolo Claude↔Codex e pode ser considerada encerrada.
tokens used
