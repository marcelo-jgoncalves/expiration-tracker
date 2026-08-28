# Test Engineering Standard — Nota cega Claude, Rodada 1

Autoavaliação da proposta em `docs/engineering/test-engineering-standard.md` (versão da rodada 1), contra os próprios critérios de peso que o documento propõe (§4), mais uma avaliação livre de completude/rigor.

## Pontos fortes

- Distingue explicitamente gates binários de validade (§3) de critérios ponderados de qualidade (§4) — evita o erro comum de misturar "isto é um teste válido" com "isto é um bom teste", que são perguntas diferentes.
- G-V5 (evidência real quando o risco é real) é ancorado em 3 bugs reais já pagos por este projeto (SSE-KMS/CloudFront, `States.ALL`/ASL, WAFv2/HTTP API v2) — não é uma afirmação abstrata de "testes de integração são bons", é uma régua com custo real documentado por trás.
- Generaliza corretamente de "teste automatizado" para "drill operacional" sem forçar os dois a exatamente os mesmos critérios (G-V6/G-V7 são específicos de drill, marcados como tal).
- Seção 5 (aplicação retroativa) audita a própria Wave 2 contra o padrão recém-proposto — prova que o padrão é operacionalizável com um exemplo real, não só teórico.
- Não-escopo (§6) declara explicitamente o que o padrão NÃO exige (mutation testing automatizado em CI) com justificativa de proporcionalidade, em vez de silenciosamente omitir.

## Riscos/fraquezas que vejo na minha própria proposta

1. **G-V3 (asserção real) depende de julgamento humano/Claude↔Codex sem nenhum mecanismo determinístico de verificação** — diferente de todos os outros gates, que são checáveis por inspeção direta (existe timestamp? existe reversão confirmada?). Isso é proporcional (justificado em §6), mas é o gate mais fraco de aplicar de forma consistente entre sessões futuras sem um exemplo concreto de "asserção tautológica real neste repo" para calibrar contra.
2. A tabela de pesos em §4 não tem a mesma rodada de "duas propostas independentes convergindo" que `joint-review-criteria.md` documenta para seus eixos (linha 11 desse arquivo) — os pesos aqui são só a proposta do Claude nesta rodada 1, ainda sem o crivo do Codex. Isso é esperado nesta fase do protocolo (é para isso que a rodada existe), mas vale nomear como fraqueza da v1, não escondê-la.
3. Falta um exemplo negativo concreto (um teste real do repo que FALHARIA algum gate de §3, hipotético ou real) — a seção 5 só audita a Wave 2, que passa. Um padrão fica mais forte quando mostra o que rejeitaria, não só o que aprova.
4. O relacionamento com `02-engineering-fitness-functions.md` fica em uma frase (§6) — não ficou claro se/quando um gate de §3 deveria virar fitness function executável no CI no futuro, e sob que critério isso seria decidido.

## Nota

**9.2/10** — a estrutura e a ancoragem em evidência real do próprio projeto são fortes; a nota não é maior por causa das 4 fraquezas acima, nenhuma delas fatal mas todas reais o suficiente para eu esperar que uma revisão adversarial as encontre também.
