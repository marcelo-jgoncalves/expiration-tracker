# Ciclo A — Análise profunda consolidada (PERF-00 a PERF-05)

Exigida pelo próprio plano (§28/§29) antes de iniciar o Ciclo B. Síntese dos 7 documentos de
resultado já produzidos — não repete dados, referencia e conecta.

## O que sabemos agora, com evidência real

1. **A conta dev tem uma restrição de conta nova (quota Lambda = 10), não uma quota normal.**
   Já bateu no teto 2x em 7 dias com tráfego trivial (`PERF-01`). Isso é a barreira mais concreta e
   mais barata de resolver de todo o Ciclo A — um caso manual no AWS Console, sem custo, sem código.
   **É o item que mais bloqueia o resto do programa** (PERF-11 load testing é literalmente
   impossível de interpretar com uma quota de 10) e é o único puramente administrativo pendente.

2. **O bundle frontend está OK, marginalmente acima da referência do plano** (517KB/140KB vs.
   ~480KB/135KB, ~4-8% acima) e **sem code-splitting** — um único chunk para todas as rotas
   (`PERF-03-bundle-baseline.md`). Isso não é urgente em si, mas explica um achado do `PERF-03`
   journeys: sob Fast 4G + CPU 4x, DCL piora ~24x e time-to-useful-data ~10x, quase inteiramente
   pelo download+parse do bundle único. Code-splitting (PERF-09, Ciclo B) é a alavanca óbvia aqui —
   mas o plano já proíbe fazer isso "sem evidência" fora de ordem, e agora há evidência real
   justificando priorizar PERF-09 dentro do Ciclo B.

3. **A instrumentação fina (EMF: session_resolve_ms, proxy_ms, request_context_ms,
   business_operation_ms) existe em código mas nunca foi implantada em dev** — só existe nesta
   branch (`PERF-04`, seção de correção). Isso significa que **todo o resto do programa está
   decompondo latência via `Duration` nativa da REPORT line**, não via os spans finos que o PERF-02
   deveria ter habilitado. Isso não bloqueia o Ciclo A/B, mas é uma dependência real para fechar
   PERF-08 (RequestContext) com precisão — **vale considerar merge desta branch (ou ao menos do
   PERF-02) em `develop` antes ou durante o Ciclo B**, não só no fechamento do programa (PERF-15).
   Decisão de Marcelo: não foi tomada ainda, fica registrada aqui como pendência explícita.

4. **O único teste de Power Tuning com lógica de negócio real (`reminder-producer`) mostrou um
   ganho grande e sem trade-off**: 256MB→1769MB é 12.8x mais rápido E mais barato por invocação
   (`PERF-05`). As outras 6 funções testadas não têm dado confiável — os payloads sintéticos nunca
   saíram da validação de rota (~27ms fixos, idêntico em toda memória). **Isso é o principal alerta
   metodológico do Ciclo A**: sempre que uma função precisa de payload autenticado/estruturado real
   para exercitar lógica de negócio, um teste com payload sintético mede *overhead de
   roteamento/validação*, não o produto. O mesmo padrão apareceu em `PERF-03` (medição do frontend
   contra backend mockado, que mede só custo de frontend) — **os dois experimentos já documentam
   honestamente essa limitação**, mas a implicação prática é: qualquer decisão de memória de
   produção baseada no `PERF-05` atual só pode ser tomada com segurança para `reminder-producer`.

5. **Overhead do BFF medido em produção real (não mockado)**: ~56ms/~21% do tempo de execução do
   handler BFF no p50 (`PERF-04`, via `Duration` comparado à Duration dos resource handlers na
   mesma janela — não é per-trace pareado, é correlação de mesmo período). É uma estimativa
   grosseira mas plausível, e consistente com a arquitetura "Full BFF" documentada (D-053/D-054).
   Não há decomposição fina de quanto é `session_resolve_ms` vs. `proxy_ms` (achado #3 acima).

6. **Cold start está na faixa de 2.7%–10% de todas as invocações reais em 7 dias, com InitDuration
   consistente em ~1.8–2.2s** em todas as funções testadas, atribuído à layer ADOT (`PERF-02`,
   `PERF-04`). Isso é uma superfície de otimização conhecida (ex.: SnapStart, ou revisitar se ADOT
   precisa estar ativo em todo função) mas nenhum experimento isolado ADOT ON/OFF foi feito ainda —
   está listado no PERF-05 original e não foi executado por escopo/tempo.

7. **Dois bugs reais e não relacionados ao programa de performance foram encontrados
   incidentalmente** (`PERF-04`, na preparação do tenant de teste):
   - `OrganizationStore.queryGsi4` nega acesso DynamoDB em dev ao criar/ler Document Archive
     requirements — gap de IAM, não de payload.
   - `GET /bff/api/reports/expiring-soon-items` sempre retorna 500 porque `handleProxy` faz
     `JSON.parse()` incondicional de um corpo que essa rota devolve em CSV.
   Nenhum dos dois foi corrigido (fora do escopo das tarefas que os encontraram). **Recomendação:
   abrir 2 itens de bug separados do programa de performance**, com prioridade própria — o segundo
   em particular pode já estar afetando usuários reais de relatórios em produção, não só dev.

## O que o Ciclo A NÃO respondeu (e por quê, honestamente)

- **Overhead fino do RequestContext dentro do Lambda** (`lambda.request_context_ms`) — bloqueado
  pelo achado #3 (métrica existe só nesta branch).
- **Comparação BFF vs. chamada direta ao resource API** — pulado por escopo de tempo (SRP auth
  manual seria necessário, sem biblioteca no repo).
- **% cold start / latência real das 6 funções sob carga de negócio real** — os testes de Power
  Tuning fora de `reminder-producer` mediram overhead de roteamento, não trabalho real.
- **Nenhum teste sob concorrência real** (PERF-11 ainda não rodou, e não pode ainda de forma
  representativa com a quota de 10).

## Recomendação para o Ciclo B

O plano pede começar PERF-06–10 só depois desta análise. Dado o que foi encontrado:

1. **Antes de qualquer coisa no Ciclo B**: resolver a quota Lambda (achado #1) — é o único item
   puramente administrativo, sem dependência de código, e desbloqueia interpretar corretamente
   qualquer teste futuro com mais de ~10 invocações concorrentes. Ação pendente do Marcelo (caso
   manual no AWS Console).
2. **Priorizar PERF-09 (code splitting) dentro do Ciclo B** — é o item do Ciclo B com evidência mais
   forte e mais direta já coletada (achado #2), diferente de PERF-06/07/08/10 que ainda não têm
   baseline específico.
3. **PERF-08 (RequestContext) só terá decomposição fina depois que PERF-02 for implantado em dev**
   (achado #3) — considerar isso ao sequenciar; pode valer a pena adiantar o merge da instrumentação
   antes de PERF-08 especificamente, mesmo que o resto do programa continue em branch.
4. Registrar os 2 bugs encontrados (achado #7) como itens de acompanhamento fora do programa de
   performance, não deixá-los perdidos dentro de docs de resultado.

Nenhuma decisão de "aplicar" mudança estrutural foi tomada aqui — como o plano exige, isto é só a
análise; qualquer ação (merge do PERF-02, priorização de PERF-09, correção dos 2 bugs) depende de
sinal do Marcelo ou é o próprio próximo passo nomeado do roadmap autônomo.
