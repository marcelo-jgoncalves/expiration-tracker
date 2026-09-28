---
status: final (rodada 2)
---

# Nota da Rodada 2 — Claude (autor da proposta)

Codex: 7,80/10. Concordo com todos os achados, e adiciono um achado próprio que encontrei ao
tentar corrigi-los.

- **Não conseguiu reproduzir (ambiente sem o profile)** — não é uma falha da proposta, registrado
  sem desconto, como o próprio Codex disse.
- **Ordenação/janela da consulta** — procede, minha consulta original não garantia "os últimos 10"
  de verdade.
- **Ausência de `Init Duration` não prova "quente"** — procede, retirado como afirmação categórica.
- **"8,4s" soma indevidamente** — procede, é o achado mais sério: a duração do BFF já INCLUI a
  espera pela resposta do backend (`proxy-service.ts:75` faz `await`), então somar os dois totais
  conta o mesmo tempo de espera duas vezes.
- **Campos originais preservados** — procede, eu tinha reescrito valores em vez de citar as linhas
  brutas.
- **3 candidatos, não 2** — procede, contagem errada.
- **`pdf-parser-task-handler` é uma task de Step Functions, não uma rota HTTP de tela** — procede,
  não é "tela carregando dados", precisa de justificativa própria ou sair da lista.
- **`sourcemap:"external"` não emite `sourceMappingURL`** — procede, verifiquei a documentação do
  esbuild: `"external"` grava o `.map` mas nunca referencia ele no arquivo `.js`; só `"linked"` faz
  isso. Minha correção anterior (`NODE_OPTIONS=--enable-source-maps` sozinho) não resolvia nada.
- **`build-lambdas.ts` compartilha as opções entre TODOS os handlers** — procede, não existe hoje
  um jeito de minificar só um subconjunto sem criar mecanismo novo.
- **O redactor (`redactor.ts:90`) só preserva a primeira linha do stack** — procede, meu teste de
  validação proposto (forçar um erro comum, ler o stack no CloudWatch) não provaria nada, porque
  a própria aplicação já trunca antes de logar.
- **`update-function-configuration` não afeta a versão publicada que o alias `live` serve** —
  procede, é um erro real sobre como este projeto versiona/publica (confirmei: o projeto usa alias
  `live` + versões publicadas, `AGENTS.md`/`cd.yml`).
- **Plano de validação insuficiente** (amostragem, identificação de versão, regra de reversão) —
  procede.

**Achado adicional, meu, encontrado ao tentar corrigir o #4 acima**: tentei correlacionar via X-Ray
(`batch-get-traces`) um request do BFF com o handler de backend que ele chama, pra medir o cold
duplo de verdade em vez de somar amostras independentes. **O trace do `items-handler` que puxei não
tem segmento pai de nenhum BFF** — é um segmento raiz isolado. Isso sugere que o `fetch()` do BFF
(`bff.ts:37`) **não propaga o cabeçalho de trace** (`X-Amzn-Trace-Id`) para a chamada ao backend —
os dois saltos não estão ligados no X-Ray hoje, então a correlação real que eu queria fazer não é
possível com a instrumentação atual. Registro isso como achado novo na Rodada 3.

Nota geral desta rodada (minha, como autor): **6,5/10** — os 12 achados do Codex são todos reais e
technicamente corretos; a proposta ainda não estava pronta pra qualquer implementação. Endereçado
na Rodada 3.
