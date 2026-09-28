---
status: draft
owner: Marcelo
authority: proposta Rodada 2 do protocolo Claude↔Codex (AGENTS.md §4) — nível 3-4, submissão pedida por Marcelo
---

# Latência percebida de carregamento de dados — Rodada 2

Responde aos 8 achados da Rodada 1 (2 erros factuais, falta de baseline, B não comprovado, escopo
de A errado, custo não garantido, keep-alive sem evidência, SnapStart amplo demais, falta plano de
validação). Traz dados reais de `dev` que a Rodada 1 não tinha.

## Correções factuais (achados 1-2)

- O override de 512MB pertence a **`parser-sandbox-handler`** (não `pdf-parser-task-handler`,
  que continua em 256MB — outro candidato real a esta mudança, não coberto na Rodada 1).
- O mínimo de memória do Lambda é **128MB** (AWS), não 256MB — 256MB é só o default deste projeto,
  não "o patamar mais lento disponível" tecnicamente.

## Baseline real medido (achado 3) — CloudWatch `dev`, `--profile claude-dev`, 2026-09-28

Consultei `logs filter-log-events` direto contra os grupos de log reais de 3 handlers tenant-facing
(`exptrk-dev-bff-handler`, `exptrk-dev-items-handler`, `exptrk-dev-memberships-handler`), últimos
~10 eventos `REPORT` de cada, sem manipulação:

| Handler | Init Duration (cold) | Duration total (cold, billed) | Duration (warm, típico) | Duration (warm, outlier) | Memory Used / Alocada |
|---|---:|---:|---:|---:|---:|
| bff-handler | ~1,86-1,89s | 3,48-3,92s | 70-110ms | — | 166-181 / 256 MB |
| items-handler | 1,92s | 4,42s | 325-555ms | — | 183-184 / 256 MB |
| memberships-handler | 1,93-2,01s | 4,42-4,51s | 372-573ms | **893ms-2,58s (sem Init Duration — quente, não frio)** | 182-184 / 256 MB |

**Achados reais, não inferidos de fonte externa**:

1. **Cold start custa ~1,9-2,0s de Init Duration sozinho**, consistente entre os 3 handlers — isso
   sustenta diretamente a hipótese "cold start domina", não é mais só uma citação de blog externo.
2. **O hop duplo (BFF→handler real) pode empilhar dois colds**: se ambos estiverem frios no mesmo
   request, o pior caso observado seria ~3,9s (BFF) + ~4,5s (handler) — **quase 8,4 segundos** para
   uma única tela, o suficiente pra explicar "telas que ficam um pouco carregando" sem precisar de
   nenhuma outra causa.
3. **Uso de memória consistente em ~182-184MB de 256MB alocados (71-72%)** — headroom real, mas não
   extremo; sustenta memória como candidato, não prova sozinho que 512MB resolveria.
4. **Achado novo, não coberto na Rodada 1**: `memberships-handler` teve uma invocação **QUENTE**
   (sem `Init Duration`) de **893ms**, e o `bff-handler`, à parte os colds, teve execuções de
   **1,72-1,76s com `Status: error, Error Type: Runtime.Unknown`** — ou seja, existe latência real
   NÃO explicada por cold start nem por memória, e pelo menos um sinal de erro de runtime real que
   esta proposta não investiga. Registrado como achado separado (seção "Fora de escopo" abaixo),
   não misturado com a otimização de cold start.

## Recomendações revisadas

**A (revisada) — override explícito, não o default compartilhado.** Só nos handlers tenant-facing
já medidos + os dois candidatos adicionais encontrados nesta rodada: `bff-handler`,
`items-handler`, `memberships-handler`, `documents-handler`, `document-archive-handler`,
`pdf-parser-task-handler` (256MB hoje, `parser-sandbox-handler` já está em 512MB). O teste
`infra/modules/lambda-function/tests/lambda_function.tftest.hcl:91` (`memory_size == 256` como
default do MÓDULO) continua correto e não muda — só os `module` callers desses 6 handlers recebem
`memory_size = 512` explícito nos seus blocos em `infra/main.tf`.

**Custo**: não afirmo mais "zero" — o componente de GB-segundo sobe, o de duração pode cair; sem
tráfego real hoje (`AGENTS.md` §1), o valor absoluto é irrelevante para decidir, mas a alegação
errada foi retirada.

**B (revisada) — minify sem alegar auditabilidade ainda não comprovada.** Habilitar
`minify: true, keepNames: true, sourcemap: "external"` (já existe) **E** adicionar
`NODE_OPTIONS=--enable-source-maps` como variável de ambiente dos handlers afetados (confirmei:
não existe hoje em nenhum Lambda). **Gate de validação obrigatório antes de declarar sucesso**:
depois do deploy, forçar um erro controlado (ex. invocar com payload inválido que already lança
uma exceção nomeada) e conferir no CloudWatch se o stack trace resolve para o arquivo/linha
TypeScript original, não só para `index.js` minificado. Sem essa prova, a mudança não fecha.

**C — mantido sem mudança** (não externalizar o SDK nesta rodada) — Codex concordou que é
proporcional.

**D — mantido, com a correção de framing do SnapStart**: não se aplica ao empacotamento ZIP
(`nodejs24.x` gerenciado) que este projeto usa hoje — o anúncio de 2026-07 cobre especificamente
Lambdas empacotados como imagem de container, uma migração de empacotamento maior e não relacionada,
fora de escopo. Não é "SnapStart não existe para Node.js" de forma absoluta.

**Retirado**: o "achado" de keep-alive ausente — sem evidência de problema real, não é mais parte
desta proposta.

## Plano de validação (Codex apontou a ausência disso)

1. Antes: capturar o mesmo baseline desta rodada (10 `REPORT` por handler, cold+warm) para os 6
   handlers listados em A, imediatamente antes do deploy.
2. Depois: mesmo capture, pelo menos 1 invocação fria (forçada por `update-function-configuration`
   ou espera de ociosidade) + 10 mornas por handler.
3. Critério de sucesso: Init Duration médio cai de forma mensurável (não precisa de alvo numérico
   fixo agora — primeira rodada é exploratória, per a própria recomendação do Codex de comparar
   256/512/1024 antes de fixar um padrão nível de repositório).
4. Gate de B: teste de erro forçado com stack trace resolvido, conforme acima.
5. `terraform plan` mostra só os 6 `memory_size` overrides alterados, nada mais.

## Fora de escopo desta proposta (achados reais, registrados, não investigados aqui)

- **`memberships-handler` com 893ms de execução QUENTE** (sem cold start) — possível gargalo real
  de query DynamoDB/lógica de aplicação, não coberto por memória/bundle isoladamente. Candidato a
  investigação de X-Ray separada.
- **Erros `Runtime.Unknown` no `bff-handler`** (Init Duration 1,7-1,8s, `Status: error`) —
  encontrados incidentalmente ao coletar o baseline, não investigados nesta proposta. Recomendo
  registrar como item separado em `NEXT_SESSION_PROMPT.md` para Marcelo decidir prioridade.
