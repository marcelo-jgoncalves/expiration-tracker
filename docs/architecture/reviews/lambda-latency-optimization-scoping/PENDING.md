---
status: pending — Rodada 3 não escrita ainda (não é rate limit; pausa deliberada para reportar a Marcelo antes de continuar)
---

Estado: Rodada 1 (7,12/10) e Rodada 2 (7,80/10) completas, ambas com achados reais e válidos do
Codex, nenhuma aprovada ainda. C (não externalizar SDK) e D (não propor SnapStart/provisioned
concurrency) já aceitos pelo Codex nas duas rodadas, sem pendência. A (memória) e B (minify) têm
pendências técnicas reais listadas no fim de `claude-note-round1.md`/na resposta da Rodada 2 (ver
`docs/architecture/reviews/lambda-latency-optimization-scoping/` — notas de rodada + saídas do
Codex arquivadas nesta sessão).

**Achado real adicional, obtido ao coletar dados para a Rodada 3, ainda não escrito em nenhuma
proposta**: coletei uma janela de 48h de `REPORT` do `bff-handler` (362 eventos, timestamps/
RequestId/log stream/TraceId preservados) e, ao contrário da amostra pequena da Rodada 1/2, **nenhum
evento nessa janela tem `Init Duration`** — ou seja, no período mais recente o BFF não teve cold
start nenhum, provavelmente por tráfego frequente (padrão de ~300s entre invocações visível nos
dados) mantendo-o quente. Isso contradiz a alegação da Rodada 2 de "Init Duration ~1,9s consistente"
como se fosse constante — a frequência de cold start varia de verdade por padrão de tráfego real,
não é uma constante do sistema. `items-handler`/`memberships-handler` (chamados só quando um
usuário real navega, sem ping automático) continuam mostrando cold starts recorrentes na mesma
janela. A alegação de "pior caso ~8,4s empilhando os dois colds" precisa ser reformulada como
possível, não típico, e a correlação real exigiria stitching de X-Ray (TraceIds já capturados,
nunca usados pra correlacionar de verdade um request do BFF com o handler que ele chama).

Próximo passo, quando retomado: Rodada 3 corrigindo os 6 pontos que a Rodada 2 do Codex listou
("Para a Rodada 3, falta exatamente: 1-6") + esta nova nuance de frequência de cold start variável.
