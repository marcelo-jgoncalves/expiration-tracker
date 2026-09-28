---
status: draft
owner: Marcelo
authority: proposta Rodada 4 do protocolo Claude↔Codex (AGENTS.md §4) — nível 3-4, submissão pedida por Marcelo
---

# Latência percebida de carregamento de dados — Rodada 4

Responde aos 4 achados da Rodada 3 (NODE_OPTIONS retirado por engano; "4,6s"/"tecnicamente
impossível" fortes demais; evidência bruta não anexada; plano de validação ainda incompleto).

## Evidência bruta embutida (achado 3 da Rodada 3)

Todas as consultas abaixo: `aws --profile claude-dev logs filter-log-events --log-group-name
"/aws/lambda/<nome>" --filter-pattern "REPORT" --start-time <epoch ms> --query
"reverse(sort_by(events, &timestamp))[:N].message"`, executadas em 2026-09-28 (agora =
`1790635200`, 19:40 UTC-3).

**`exptrk-dev-memberships-handler`, janela de 72h, 8 linhas mais recentes** (cold starts
recorrentes e frequentes nas últimas horas):

```
RequestId: b6725ac7-f17f-4567-86eb-fbbe0b204057  Duration: 1492.00ms  Billed: 3683ms  Init: 2190.92ms
RequestId: 4721d6b2-ed8b-4969-b836-c2c8352f91e2  Duration: 1342.85ms  Billed: 3139ms  Init: 1795.49ms
RequestId: 180f6e3d-bd36-4754-92ff-6a477450fd9e  Duration: 694.73ms   Billed: 695ms   (sem Init)
RequestId: a8bf18cc-1776-4a1f-8188-c2f2a7d15200  Duration: 1499.69ms  Billed: 3694ms  Init: 2193.82ms
RequestId: 4a3d5c21-d427-4272-976a-814c7496ee6e  Duration: 1544.24ms  Billed: 1545ms  (sem Init)
RequestId: c0b7949a-89a7-4aa4-be16-8c4c939da6ea  Duration: 1455.92ms  Billed: 3597ms  Init: 2140.70ms
RequestId: 06d554ea-969a-4a05-ab3d-3173a97d28eb  Duration: 1437.69ms  Billed: 3612ms  Init: 2173.99ms
RequestId: 80ab3948-6acc-402d-8d42-f18ab75700c7  Duration: 1462.24ms  Billed: 3608ms  Init: 2145.11ms
```
(Memory Size 256MB, Max Memory Used 192-197MB em todas as 8 — todos TraceId capturados no arquivo
fonte desta rodada, omitidos aqui por brevidade, disponíveis sob pedido.)

**`exptrk-dev-bff-handler`, janela de 2h (17:40-19:40 UTC-3), 10 linhas mais recentes** — nenhuma
com `Init Duration`:

```
RequestId: 89a02437-81e3-4239-9377-89c746328929  Duration: 100.13ms  (sem Init)
RequestId: 855b2bbc-cf1d-431d-848e-568487bb917c  Duration: 89.50ms   (sem Init)
RequestId: f803b55a-c4e0-4697-9d12-172cb67eae16  Duration: 111.27ms  (sem Init)
RequestId: f3695bd0-3ea9-4c67-b68d-167a70c7f512  Duration: 107.92ms  (sem Init)
RequestId: f434c171-3394-46fa-9894-1a1057bf67ea  Duration: 200.55ms  (sem Init)
RequestId: 4624dee9-38ee-4a06-a488-448cb194c23d  Duration: 91.59ms   (sem Init)
RequestId: 94946362-64bc-4967-8608-edd27dcfdf1c  Duration: 89.28ms   (sem Init)
RequestId: f4f90be8-f82d-4393-92bf-814f3492f156  Duration: 188.39ms  (sem Init)
RequestId: eb68a585-5f63-4019-8087-071d9ef726ec  Duration: 97.38ms   (sem Init)
RequestId: 88c24139-d26c-420f-b594-dfb0d25fa4ac  Duration: 107.09ms  (sem Init)
```

**Relação entre a janela sem `Init Duration` do BFF e as amostras anteriores** (achado 4 pedido pelo
Codex): o `bff-handler` não é chamado num ritmo automático fixo — os intervalos entre as linhas
acima variam (26s a 876s), sem padrão de "ping" regular. A explicação mais simples, consistente com
a documentação da AWS sobre reuso de ambiente de execução, é que o volume de chamadas nesta janela
específica de 2h foi suficiente para manter pelo menos um ambiente quente o tempo todo — **não é
uma garantia arquitetural, é uma observação de uma janela específica**, que pode não se repetir em
períodos de menor uso (madrugada, fins de semana). Registrado como hipótese de reuso, nunca como
garantia, conforme o achado 4 exige.

## Correção do achado 1 — NODE_OPTIONS restaurado

Configuração completa de B, sem omissão:
- `minify: true`
- `keepNames: true`
- `sourcemap: "linked"` (não `"external"` — emite `//# sourceMappingURL=index.js.map`, o
  `"external"` original nunca emitia essa referência)
- o arquivo `.map` incluído no artefato final (mesmo diretório do `index.js` no ZIP)
- **`NODE_OPTIONS=--enable-source-maps`** como variável de ambiente dos handlers cobertos por B —
  restaurada; `sourcemap:"linked"` sozinho resolve só a referência dentro do bundle, nunca faz o
  Node consultar o mapa em tempo de execução sem essa flag.

## Correção do achado 2 — linguagem de hipótese, não de medição

Substituído em todo o documento:
- ~~"piso combinado plausível de ~4,6s"~~ → **"se os dois saltos inicializarem sequencialmente no
  mesmo request, dois `Init Duration` da ordem de ~2,2s cada poderiam contribuir com
  aproximadamente 4,4s combinados — um cenário hipotético baseado em duas amostras independentes,
  nunca uma medição ponta a ponta do mesmo request, e não é um limite superior garantido do
  sistema."**
- ~~"antes de qualquer lógica de negócio rodar"~~ → removido (o BFF processa autenticação/roteamento
  antes de chamar o backend; essa lógica acontece DEPOIS do Init do BFF e ANTES do Init do backend,
  não "antes de qualquer lógica").
- ~~"tecnicamente impossível" (correlacionar os 2 saltos)~~ → **"não conseguimos correlacionar os
  dois saltos na evidência coletada nesta investigação; não há propagação explícita de
  `X-Amzn-Trace-Id`/`traceparent` no código (`bff.ts:37`, `proxy-service.ts:51` só repassam
  `x-correlation-id`, que não liga árvores de X-Ray) — isso não descarta por completo alguma
  injeção automática pelo layer ADOT que esta investigação não isolou."**

## Correção do achado "5" — plano de validação operacional

1. **Deploy real**: via CD normal (`develop` → CI verde → publica versão → atualiza alias `live`).
   Um deploy não garante automaticamente 5 ambientes frios — a obtenção real de colds é: registrar
   o número de versão publicado (`aws lambda get-alias --name live --query FunctionVersion`) logo
   após o deploy, então aguardar invocações reais espaçadas (cada gap de inatividade > ~10-15min
   tende a reciclar o ambiente, per o comportamento documentado da AWS) e filtrar por
   `REPORT`+`Init Duration` presente **E** número de versão correspondente ao deploy, nunca contar
   uma invocação sem confirmar os dois.
2. **Taxas, não contagens**: comparar (nº de invocações com erro / nº total de invocações) na
   mesma janela de tempo antes/depois, mesmo volume de tráfego aproximado.
3. **Cobertura real de erro** (achado do Codex, confirmado em `items-handler.ts:102`): o padrão
   `catch (err) { ... return {statusCode: 500, ...} }` faz TODO erro de negócio virar uma resposta
   HTTP estruturada — a invocação Lambda em si sempre é reportada como sucesso (`Status: error`
   nunca aparece no REPORT para esse caminho). Medir erro real exige olhar `5XXError`/`4XXError` do
   API Gateway (métrica CloudWatch nativa) e/ou grep dos logs de aplicação por `statusCode: 500`,
   nunca só o campo `Status` do REPORT do Lambda (que só cobre timeout/crash/erro de runtime não
   capturado).
4. **Cobertura de B** (minificação é global, todos os ~50 handlers): validação inclui um smoke
   funcional representativo — pelo menos 1 rota HTTP de cada módulo principal (organization,
   document, document-archive, extraction, expiration) + 1 worker assíncrono (ex. o worker de
   digest do WhatsApp, D-347) — não só os 5 candidatos de A, que testam só memória.
5. **Rollback nomeado corretamente**: `.github/workflows/rollback.yml` (mecanismo real já existente,
   "Emergency Rollback (dev)") — reaponta o alias `live` para a versão saudável anterior via
   `aws lambda update-alias`, nunca `terraform apply`. Critério de acionamento: taxa de erro (item 2)
   sobe de forma mensurável OU nenhuma melhoria de `Init Duration`/`Duration` aparece nas amostras
   pós-deploy dos 5 candidatos de A.

## Candidatos finais (inalterado desde a Rodada 3, Codex já concordou)

A: `memory_size = 512` explícito em `bff-handler`, `items-handler`, `memberships-handler`,
`documents-handler`, `document-archive-handler` — default do módulo continua 256MB.
`pdf-parser-task-handler` fora de A (task de Step Functions, não rota HTTP), mas dentro do escopo
de B (minificação global).

## O que permanece sem mudança

C (não externalizar SDK) e D (não propor SnapStart/provisioned concurrency) — aceitos pelo Codex
desde a Rodada 1, sem achado novo contra eles.
