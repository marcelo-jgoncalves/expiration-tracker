---
status: aprovado (protocolo Claude↔Codex encerrado, Rodada 6, nota 9,25/10)
owner: Marcelo
---

# Latência de carregamento de dados — desenho final aprovado

Investigação de por que as telas ficam carregando (cold start de Lambda + arquitetura BFF de duplo
salto), submetida ao protocolo Claude↔Codex (AGENTS.md §4) por pedido explícito de Marcelo, embora o
nível de risco (3-4, config de infra reversível) não o exigisse obrigatoriamente. 6 rodadas até
convergência: 7,12 → 7,80 → 8,20 → 8,60 → 8,70 → 9,25. Rodadas completas em
`claude-proposal-round{1..6}.md`/`claude-note-round{1..6}.md` nesta pasta.

**Nenhum código ou infraestrutura foi alterado por esta investigação** — é desenho aprovado, pronto
para implementação numa sessão futura.

## A — Memória Lambda

`memory_size = 512` explícito (override, não mudança de default) em 5 handlers HTTP tenant-facing:
`bff-handler`, `items-handler`, `memberships-handler`, `documents-handler`,
`document-archive-handler`. Default do módulo (`infra/modules/lambda-function/variables.tf`)
permanece 256MB. `pdf-parser-task-handler` fora de A (é task do Step Functions, não rota HTTP de
carregamento de tela) — mas dentro do escopo de B.

## B — Bundling (aplicado globalmente, ~50 handlers)

Em `scripts/build-lambdas.ts`: `minify:true`, `keepNames:true`, `sourcemap:"linked"` (não
`"external"` — só `"linked"` emite a referência `//# sourceMappingURL=` que faz o runtime consultar o
mapa), `.map` incluído no ZIP, e a variável de ambiente `NODE_OPTIONS=--enable-source-maps` no
handler (as duas exigências são independentes; uma sem a outra não resolve). Validação: função
dedicada que lança exceção não capturada (fora do pipeline de redação `redactor.ts`, que trunca stack
traces por design) comparando o stack trace nativo do runtime antes/depois da minificação.

## C — SDK da AWS

Não externalizar do bundle nesta rodada — versão empacotada pelo runtime `nodejs24.x` não está
caracterizada/garantida estável o suficiente para justificar a mudança agora.

## D — SnapStart / Provisioned Concurrency

Não perseguir: SnapStart não suporta Node.js empacotado como ZIP (só Java/Python/.NET/imagem de
container); provisioned concurrency tem custo real recorrente sem tráfego de usuário real para
justificá-lo (`AGENTS.md` §1 — fase pré-lançamento, sem usuário real).

## Plano de validação (para quando a implementação acontecer)

- Deploy pelo pipeline real (CD → publica versão → atualiza alias `live`), nunca
  `update-function-configuration` direto (não afeta o que o alias serve).
- Correlacionar cada amostra à versão via `aws lambda get-alias --name live`, capturando
  `FunctionVersion` + `RevisionId` + `RoutingConfig` antes E depois da coleta (`RevisionId` muda a
  cada operação de alias, inclusive uma que reverte à mesma versão — só `FunctionVersion` não detecta
  isso; `RoutingConfig` confirma ausência de canário/peso).
- Mínimo 5 observações frias independentes e 10 quentes por handler. Obter frias via concorrência
  sintética controlada quando o tráfego natural não bastar (nunca por um prazo de reciclagem
  específico — a AWS não documenta um número fixo). Contar só o que for de fato observado como frio
  (`Init Duration` presente no REPORT); se insuficiente, declarar inconclusivo, nunca extrapolar.
- Comparar `Init Duration`/`Duration` antes/depois.
- Taxa de erro via métricas corretas de HTTP API v2: `Sum(5xx)/Sum(Count)` por gateway (BFF e API de
  recursos separadamente), dimensão `ApiId`, minúsculo (`5xx`/`4xx`, não `5XXError`/`4XXError` —
  nomenclatura de REST API v1, que este projeto não usa). Denominador zero = sem amostra, nunca 0% de
  erro. O campo `Status` do REPORT do Lambda não cobre erro HTTP 500 tratado pela própria aplicação
  (`items-handler.ts:102` retorna 500 estruturado sem lançar exceção — por isso a métrica do API
  Gateway é obrigatória, não o REPORT sozinho).
- Smoke funcional cobrindo módulos representativos + pelo menos um worker assíncrono (escopo de B é
  global).

## Rollback

`.github/workflows/rollback.yml` ("Emergency Rollback (dev)") — reaponta o alias `live` de cada
Lambda para versões previamente saudáveis via `aws lambda update-alias`, nunca `terraform apply`.
Critério de acionamento: taxa de erro sobe (métricas acima) OU nenhuma melhoria mensurável de
`Init Duration`/`Duration` aparece após completar a amostragem planejada.

## Achado colateral registrado, não resolvido nesta rodada

`src/runtime/aws/composition/bff.ts`/`proxy-service.ts`: o `fetch()` do BFF para o backend não
propaga `X-Amzn-Trace-Id`/`traceparent`, então os dois saltos (BFF → handler) não aparecem
correlacionados numa única árvore de trace no X-Ray hoje. Não bloqueia a aprovação deste desenho —
registrado aqui para uma iniciativa de observability futura, não descrito como parte de A/B/C/D.
