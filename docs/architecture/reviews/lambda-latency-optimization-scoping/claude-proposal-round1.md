---
status: draft
owner: Marcelo
authority: proposta Rodada 1 do protocolo Claude↔Codex (AGENTS.md §4) — submissão pedida por Marcelo, 2026-09-28
---

# Latência percebida de carregamento de dados — Rodada 1

Pedido de Marcelo (2026-09-28): "quanto a melhorar esse tempo de carregamento dos dados. Faça uma
investigação sobre isso, busque na Internet e acione o protocolo." Complementa o trabalho de
animação de loading (D-350, cosmético/percepção) com uma investigação real da CAUSA (por que as
telas demoram) — achados de código verificados diretamente, nunca por suposição.

## Nível de risco

Nível 3-4 pela escala (`change-risk-scale.md`): ajuste de configuração de infraestrutura já
aprovada (memória/bundling de Lambda), reversível, sem mudança de modelo de dados/contrato/
fronteira de módulo. Não seria obrigatório pelo protocolo por si só, mas Marcelo pediu
explicitamente — submetido como pedido dele, mesmo padrão já usado para o achado de disclosure de
IA.

## Pesquisa externa considerada: SIM PARCIAL

**Fontes (consultadas em 2026-09-28)**:
- [Cost Nimbus — Lambda Cold Starts: The Complete 2026 Optimization Guide](https://costnimbus.com/article/lambda-cold-starts/)
- [Momento — How we turned up the heat on Node.js Lambda cold starts](https://www.gomomento.com/blog/how-we-turned-up-the-heat-on-node-js-lambda-cold-starts/)
- [hidekazu-konishi.com — AWS Lambda Cold Start Mitigation Guide](https://hidekazu-konishi.com/entry/aws_lambda_cold_start_mitigation_guide.html)
- [AWS — SnapStart for container image functions (2026-07)](https://aws.amazon.com/about-aws/whats-new/2026/07/aws-lambda-snapstart-container/)
- [Alokai / AWS Mobile Blog / Microsoft Learn — Backends for Frontends pattern](https://aws.amazon.com/blogs/mobile/backends-for-frontends-pattern/)
- [Medium (Jaewoo Ahn) — Low hanging fruit to reduce API Gateway to Lambda latency](https://medium.com/@lancers/low-hanging-fruit-to-reduce-api-gateway-to-lambda-latency-8109451e44d6)

**Escopo do que é informado por pesquisa vs. decisão interna**: os NÚMEROS-alvo (memória
recomendada, tamanho de bundle recomendado) vêm das fontes acima, aplicados a este código real;
QUAL handler prioriza cada mudança e a ordem de rollout são decisão interna, específica deste
projeto (sem usuário real, sem pressão de tráfego — `AGENTS.md` §1).

## Achados reais (verificados diretamente no código, não por suposição)

1. **Memória padrão de Lambda é 256MB** (`infra/modules/lambda-function/variables.tf:71`) para a
   maioria dos handlers — só `pdf-parser-task-handler` sobe para 512MB, e só por causa do `pdf-lib`.
   Lambda aloca CPU proporcionalmente à memória — 256MB é o patamar mais lento de CPU disponível.
   As fontes pesquisadas convergem em **1024MB+ como o ponto de corte recomendado** para workloads
   Node.js CPU-bound (parsing JSON, verificação JWT, crypto) — não é só sobre RAM disponível, é
   sobre CPU proporcional.

2. **Bundles de Lambda não minificados, SDK da AWS empacotado por inteiro** (`scripts/build-lambdas.ts:171-176`,
   comentário explícito: `minify: false` "AWS SDK v3 bundled IN, stack traces stay auditable" —
   `external` nunca é passado ao esbuild). Tamanho real medido nesta sessão:
   `dossier-export-generation-handler` 4.9MB, `pdf-parser-task-handler` 2.7MB,
   `document-archive-handler`/`documents-handler`/`memberships-handler` 2.1-2.4MB cada — a maioria
   dos ~50 handlers está na faixa de 1.5-2.5MB. As fontes pesquisadas confirmam que um bundle
   minificado + SDK externalizado (o runtime `nodejs24.x` já inclui `@aws-sdk/*` nativamente)
   tipicamente cai para 400-800KB — **quanto menor o bundle, menos JS o Node precisa parsear no
   cold start**, proporcionalmente.

3. **`minify:false` é uma troca deliberada, documentada** (auditabilidade de stack trace) — não é
   um descuido. Qualquer correção precisa reconciliar com esse objetivo, não simplesmente inverter
   a flag.

4. **Nenhum Lambda tem provisioned concurrency ou warm-up** — só `reserved_concurrent_executions`
   existe (proteção contra throttling, não mitigação de cold start). Confirmado: SnapStart **não
   existe para Node.js** (só Java/Python/.NET/imagens de container, per anúncio da AWS de
   2026-07) — não é uma opção real para este projeto, mesmo que fosse considerado.

5. **Arquitetura de 2 saltos confirmada**: toda chamada do frontend passa por um Lambda de BFF
   (`src/runtime/aws/composition/bff.ts`, `fetchBackend.fetch()`) que faz uma chamada HTTP real
   (`fetch()` nativo do Node) para o API Gateway "de verdade" (`apiBaseUrl`), que invoca um SEGUNDO
   Lambda (o handler de domínio real). As fontes pesquisadas confirmam isso como um trade-off
   NOMEADO e conhecido do padrão BFF ("extra integration latency... double hop... increases AWS
   bill"), não um bug desta implementação — mas significa que uma requisição pode pagar cold start
   DUAS vezes (BFF + handler real) em vez de uma. Uma fonte cita API Gateway adicionando ~10-30ms e
   cold start ~100-500ms por invocação — o cold start domina, não o hop em si.

6. **`fetchBackend.fetch()` usa o `fetch()` global do Node sem nenhum `Agent`/keep-alive
   explícito** — não necessariamente um bug (o `fetch` nativo do Node 18+/undici já faz pooling de
   conexão por padrão dentro do mesmo processo), mas nenhuma configuração explícita garante isso
   nem mede se está de fato acontecendo entre invocações "quentes" do mesmo container.

7. **Camada ADOT (OpenTelemetry) já está presente** (`scripts/build-lambdas.ts`'s comentário sobre
   o bug do M5) — instrumentação automática de tracing tem custo de inicialização conhecido e
   documentado nas fontes pesquisadas, mas removê-la trocaria observabilidade por velocidade, uma
   decisão de produto que não decido sozinho aqui.

## Recomendações propostas (nenhuma implementada ainda — desenho para avaliação)

**A. Subir a memória padrão de 256MB para 512MB** em todos os handlers tenant-facing
(`documents-handler`, `memberships-handler`, `document-archive-handler`, o handler do BFF, etc.) —
mudança de 1 linha no Terraform (`variables.tf`'s `default`), zero custo adicional relevante no
volume de tráfego atual (sem usuário real), reversível instantaneamente. Não proponho 1024MB direto
sem medir primeiro (Codex, veja pergunta 1 abaixo).

**B. Habilitar `minify: true` mantendo `keepNames: true`** — reduz o bundle (menos parsing/menos
bytes baixados) preservando nomes de função legíveis em stack traces (meio-termo entre a
auditabilidade original e o ganho de tamanho — `keepNames` é justamente a opção do esbuild pra
isso, confirmada pelas fontes pesquisadas). `sourcemap: "external"` já existe e continua
funcionando com minify ligado.

**C. NÃO externalizar `@aws-sdk/*` nesta rodada** — decisão consciente de NÃO seguir uma das
recomendações mais fortes da pesquisa, porque introduz um risco real não trivial: a versão do SDK
embutida no runtime `nodejs24.x` pode divergir da versão que o código foi escrito/testado contra,
e nenhum mecanismo deste projeto hoje verifica essa compatibilidade automaticamente. Registro como
candidato futuro, não desta rodada — quero a opinião do Codex sobre se essa cautela é
desproporcional ou justificada (pergunta 2 abaixo).

**D. NÃO propor provisioned concurrency nem redesenho do hop BFF→backend** — custo real recorrente
sem tráfego real para justificar (`AGENTS.md` §1), e um redesenho arquitetural (ex. BFF chamando os
serviços de domínio diretamente em vez de via HTTP) é uma mudança de fronteira de módulo genuína
nível 5-6, fora do escopo desta rodada de latência.

## Perguntas para o Codex

1. A/B acima são suficientes como primeira rodada, ou a pesquisa justifica ir direto a 1024MB (a
   fonte mais forte cita isso como o "recommended cutoff", não 512MB)?
2. A cautela do item C (não externalizar o SDK) é proporcional, ou o risco de divergência de
   versão é pequeno o bastante (dado que o runtime documenta qual versão do SDK inclui) para valer
   a pena pelo ganho de tamanho?
3. Alguma lacuna real na investigação (achados 1-7) antes de qualquer mudança ser implementada?
