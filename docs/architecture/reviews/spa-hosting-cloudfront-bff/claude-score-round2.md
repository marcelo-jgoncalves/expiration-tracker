# Nota cega do Claude — Rodada 2 (sobre proposal-claude-v2.md, antes de ver a crítica do Codex)

Nota: 8,7/10.

A v2 fecha os três erros técnicos reais da Rodada 1 (origin request policy, ordem de behaviors, allowed_methods) e formaliza ownership de headers/CORS. O ponto que eu sabia estar mais frágil ao escrever a v2 e não tinha verificado contra a documentação: a frase "sem fallback de erro do S3 aplicado ao path /bff/*" presume que dá para escopar `custom_error_response` por behavior — eu não tinha confirmado isso é uma propriedade de nível de distribution no Terraform (`aws_cloudfront_distribution.custom_error_response` não tem `path_pattern`), então a mitigação real (CloudFront Function de viewer-request que só reescreve para `index.html` fora de `/bff*`, nunca `custom_error_response` global) ainda não estava no documento. Registrando antes de ler a crítica para manter nota cega.
