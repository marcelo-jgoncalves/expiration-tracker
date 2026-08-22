---
status: critique-round2
owner: claude
authority: design
---

# Crítica Claude — rodada 2 — M7 runtime design

Agora que li a proposta independente do Codex, comparo com a minha (round1) e aponto onde convirjo,
onde discordo, e onde a proposta dele é claramente mais forte.

## Onde convergimos (sem debate necessário)

- Step Functions **Standard**, não Express — mesma decisão, mesma justificativa central (histórico
  auditável + custo irrelevante frente a Textract/Bedrock).
- 12 estados do blueprint mapeados nos mesmos 5 handlers, com `ValidateSchema`/`CompareExtractors`/
  `PersistExtractedFields` como uma única invocação lógica de `ExtractionValidationTaskHandler` (eu
  colapsei em um Task state `ValidateAndPersist`; o Codex manteve 3 Task states separados chamando a
  mesma função com `operation` distinto — ver discordância #1).
- `TextractClient`/`BedrockExtractionRequest`/`ExtractionCandidate` como lacunas reais que precisavam
  de definição de campo — ambos preenchemos essa lacuna, com formas de dado quase idênticas.
- Prompt injection: papel do documento como dado nunca instrução, schema fechado, testes
  adversariais como parte do critério de aceite. A versão do Codex é mais operacional (API Converse,
  tool `submit_extraction` forçada, temperature 0) — adoto a dele.
- Rota HTTP de confirmação como lacuna real a fechar, mesmos 5 passos do blueprint
  (`:1139-1145`), mesma disciplina de OCC com múltiplas versões esperadas.
- Reaproveitar os limites numéricos do sandbox M6 (50 páginas/25MB/512MB/30s) no parser de extração.
- `ExtractionRun`/`ExtractedField` com os mesmos campos centrais (a versão do Codex é mais completa:
  `purgeAfter`, `summary`, `failure.stage/code/retryable` — adoto esses acréscimos).
- Toggle de custo de infraestrutura separado do kill switch operacional — mesma ideia central, nomes
  quase iguais (`extraction_pipeline_enabled` idêntico).

## Discordâncias reais

### 1. Textract síncrono (minha proposta) vs assíncrono com task token (Codex)

Minha justificativa original: 1 página/documento (premissa do `cost-model.md`) não justificaria o
mecanismo de callback. **Concedo o ponto ao Codex**: o limite JÁ APROVADO do sandbox é 50 páginas
(`implementation-blueprint.md:1797`), não 1 página — a premissa do cost-model é só para ESTIMATIVA DE
CUSTO, não um limite de produto. Multi-página real (contratos, apólices, extratos longos) é o caso
comum que o produto precisa suportar desde o dia 1, não uma evolução futura. Isso invalida minha
justificativa central para síncrono. O padrão `waitForTaskToken` do Codex é a escolha correta:
evita manter uma Lambda "esperando" (custo + risco de timeout de execução Lambda, não só de Step
Functions), e a Fase 3 já sinalizava explicitamente essa decisão como pendente — o Codex a fecha
com uma justificativa que se sustenta contra o próprio limite de 50 páginas já aprovado, a minha não.
**Decisão reconciliada: assíncrono, como o Codex propôs**, incluindo o `TextractJob` de correlação
transitória e o cuidado de nunca deixar o task token em log/métrica/trace.

### 2. Parser de extração: estender `parser-sandbox` (minha proposta) vs função nova separada (Codex)

Meu argumento era evitar duplicar a superfície de sandbox. O Codex tem um argumento de fronteira de
confiança que eu subestimei: `parser-sandbox` de M6 é uma barreira de **ingestão** (só valida
estrutura, nunca sai texto) — dar a ela acesso ao bucket **limpo** (não mais quarentena) e a
capacidade de produzir texto extraído muda o que essa função É, na prática promovendo uma função de
baixo-risco (validação binária VALID/INVALID) para uma de risco maior (produz dado que alimenta
Bedrock). Isso amplia o "blast radius" de uma função que M6 já tem em produção real, testada e
verificada — mudar seu contrato de saída/IAM depois do fato é exatamente o tipo de mudança que
deveria passar por reavaliação de M6, não ser feita de passagem dentro do design de M7.
**Decisão reconciliada: função nova (`extraction-parser-sandbox-handler`)**, reaproveitando só as
funções PURAS de validação/limites do pacote `workers/parser-sandbox` como biblioteca compartilhada
(import de função, não reuso de Lambda), nunca a Lambda `parser-sandbox` de M6 em si.

### 3. Retenção do texto OCR: "nunca persiste" (minha proposta) vs classe `EXTRACTION_TRANSIENT` com lifecycle de 24h (Codex)

Minha proposta original assumia que o resultado do Textract síncrono vive só na memória da execução
e nunca é escrito em S3. Como a decisão #1 muda para Textract assíncrono, o resultado
**precisa** ser materializado em algum lugar entre o callback do Textract e o consumo por
`RunDeterministicParser`/Bedrock — a arquitetura assíncrona invalida minha decisão "nunca persiste
bruto" por construção (o SNS/SQS/task-token pattern não carrega o payload inteiro do OCR). A
proposta do Codex de uma classe `EXTRACTION_TRANSIENT` com exclusão explícita + lifecycle de 24h como
safety net é a única forma consistente com Textract assíncrono. **Decisão reconciliada: adoto a
classe `EXTRACTION_TRANSIENT` do Codex**, e isso precisa ser refletido em `privacy-lgpd.md` §4 antes
da implementação (o próprio Codex já sinaliza isso como pendência de tipo 1 de privacidade — concordo).

### 4. Kill switch AI/OCR: AppConfig real — concordância, mas minha proposta original hesitou

Eu cheguei à mesma conclusão (AppConfig real, não o padrão Terraform do M6) mas apresentei como uma
escolha entre duas opções válidas. O Codex é mais categórico e eu concordo com a categorização dele:
o toggle Terraform de M6 é uma decisão de **deploy** (dev liga/desliga entre exercícios), o kill
switch AI/OCR do blueprint é uma resposta a **incidente em produção** (`:1774`, runbook) que precisa
"funcionar sobre backlog" (`:1684`) — chamadas já enfileiradas. Só AppConfig atende isso sem
`terraform apply`. Não há ambiguidade real aqui; era só uma questão de eu não ter sido tão direto
quanto deveria. **Decisão reconciliada: AppConfig real**, com a distinção fina do Codex de que
`OCR=false` bloqueia só o caminho que depende do artefato OCR (não bloqueia o parser determinístico
puro) — isso eu não tinha considerado e é uma correção real sobre minha proposta original.

## Onde minha proposta acrescenta algo que a do Codex não cobriu

- **`TenantQuotaService.release()` já existe** (implementado em M6, `src/modules/identity/application/quota.ts`)
  — a proposta do Codex fala em "compensação pode restituir a reserva" para `AI_CALL` sem mencionar
  que essa primitiva já existe e deve ser reaproveitada, não reinventada.
- Minha proposta foi mais explícita sobre a ação de autorização cobrir tanto confirmar quanto
  rejeitar (`extraction:confirm` como ação única, com o corpo da requisição decidindo qual). A rota do
  Codex assume implicitamente "confirmação" mas não detalha o caminho de rejeição — a reconciliação
  precisa fechar isso explicitamente (ver documento de reconciliação).

## Nota

**Nota da proposta Codex: 8,7/10.** É mais completa e mais rigorosa em 4 das 5 discordâncias reais
que encontrei (Textract assíncrono, parser separado, retenção transitória, nuance do kill switch
`OCR=false`), tem ASL com Retry/Catch real (a minha só listava estados sem política de erro), e
persistência mais completa (`purgeAfter`, `summary`, `failure.stage/code/retryable`). Não chega a
9,0 porque: (1) o critério `NeedsBedrock` não está fechado com thresholds concretos por tipo de
campo/documento (fica em "confidence baixa ou divergência", vago o suficiente para não ser
testável/determinístico); (2) a política de retry do Textract job (o que acontece se o callback
nunca chegar dentro do `HeartbeatSeconds`) não trata explicitamente o caso de job "preso" no lado do
Textract, só o timeout do lado Step Functions; (3) não há desenho de teste de carga/custo para o
cenário realista de um tenant reenviando o mesmo documento repetidamente (abuso de custo, ameaça já
listada em `threat-model.md` como "Cost abuse — D, Média").

**Gate do protocolo**: não atingido por nenhum dos dois lados nesta rodada (minha proposta ficaria
abaixo de 9,0 pelos motivos que o Codex apontou de forma independente, que concordo em maior parte).
Precisa de uma rodada de reconciliação que incorpore as correções de ambos os lados antes de nova
avaliação.

## Nota final desta rodada

A proposta do Codex é mais completa e mais rigorosa em 4 dos 5 pontos de discordância genuína — a
única contribuição real minha que sobrevive é o reaproveitamento explícito de `TenantQuotaService.release()`
e a necessidade de tratar rejeição explicitamente na rota. Isso não é hesitação diplomática: revisei
cada ponto contra o que já está aprovado no blueprint e contra o que M6 já implementou de verdade, e
a maioria das minhas posições originais não resistiu ao teste. Sigo para o documento de reconciliação
com essas 4 decisões trocadas a favor do Codex e as 2 acrescidas da minha proposta.
