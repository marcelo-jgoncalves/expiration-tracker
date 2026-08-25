# Nota cega do Claude — Rodada 1 (proposta original, antes de ver a crítica do Codex)

Nota: 8,0/10.

Acertos: alternativa (a) é a correta; S3+OAC, CachingDisabled para `/bff/*`, dois behaviors numa distribution, nenhuma mudança em `cookies.ts`/`csrf.ts` estão certos.

Riscos que eu já suspeitava antes de ver a crítica, mas não tinha verificado contra a documentação da AWS (por isso não polido na proposta original): (1) `AllViewer` encaminhando o header `Host` do viewer para uma origem `execute-api` — não tinha certeza se isso quebra a origem ou não, deveria ter verificado antes de propor em vez de assumir; (2) a frase "CloudFront resolve por especificidade" — eu sabia que `ordered_cache_behavior` usa uma lista ordenada no Terraform, mas escrevi a frase de um jeito que sugere resolução automática por especificidade, o que é impreciso mesmo se o resultado prático (com só 2 patterns) estivesse certo; deveria ter sido mais preciso. (3) não tratei ownership de security headers entre os dois behaviors como parte desta decisão.

Registrado antes de ler a crítica do Codex, para manter o protocolo de nota cega.
