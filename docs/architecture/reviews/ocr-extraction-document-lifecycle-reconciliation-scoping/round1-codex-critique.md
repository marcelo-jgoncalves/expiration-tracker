# Round 1 (Codex) — Critique

> Extracted from the raw exec transcript (`round1-codex-critique.txt`) — Codex's first attempt
> at this critique bled together with an unrelated prior review (`bulk-import-documents-...`)
> Codex read as a "structural reference"; only the final, on-topic critique (which explicitly
> re-verified every claim against this repo's real files) is kept here, verbatim from the
> transcript's last occurrence.

A Rodada 1 encontrou corretamente a desconexão física entre os pipelines, mas ainda não apresenta um design aceitável para implementação. O diagnóstico factual é parcialmente sólido; a conclusão de "pipeline autoritativo", a incorporação obrigatória do worker ao escopo e, sobretudo, a transação `3 + N Requirements` vão além do que a evidência sustenta.

## 1. Pipeline autoritativo: achado correto, conclusão superestimada

Confirmei no código: `malware-result-handler.ts:59` tenta apenas `parseQuarantineKey`/`parseSubmissionQuarantineKey`; uma chave `document-archive/...` cai no branch não reconhecido, é logada e descartada sem `batchItemFailures` (não é "silencioso" — há log de erro — mas é descarte definitivo sem retry/DLQ). `confirmFileScanClean` não tem call site em handler real. `buildQuarantineKey` produz o namespace `document-archive/tenant/...`. `extraction-starter-handler.ts:42` só entende o formato antigo. `document-classifier.ts` classifica formato físico, não `DocumentType` de negócio — achado correto.

Três excessos: (1) Terraform prova deploy/roteabilidade, não volume/recência de tráfego — o comentário "real traffic already" é evidência histórica de log group, não de autoridade de produto; (2) "autoritativo" mistura três conceitos (pipeline fisicamente completo / API que recebe tráfego / autoridade conceitual futura) — o código só sustenta o primeiro; (3) a proposta omite que **`upload-finalizer-handler.ts` também só reconhece os formatos antigo e de submission** — não basta corrigir `malware-result-handler`, o lado de upload finalizado do `document-archive` também é descartado, deixando arquivos presos em `PENDING_UPLOAD`, não só `SCANNING`.

**Conclusão corrigida**: o módulo antigo é hoje o único pipeline fisicamente completo no código implantável. `document-archive` é o modelo de domínio aprovado com entrada HTTP/presign real, mas não tem consumidores reais para NENHUM dos dois sinais físicos (upload finalizer E malware result) que a correlação de scan exige.

## 2. Opção A é um falso dilema e amplia indevidamente o escopo

O worker de promoção é pré-requisito para ATIVAR o pipeline novo ponta-a-ponta, não para DECIDIR corretamente o contrato de reconciliação. Existe uma Opção C melhor delimitada: (1) desenhar a identidade de extração contra `DocumentVersion`/`DocumentFile` agora; (2) definir o contrato do evento clean e as precondições que o starter deve validar; (3) implementar/testar a extração re-chaveada sem ligá-la ao trigger real; (4) implementar upload-finalizer + malware-result + promoção como fatia independente; (5) ativar o trigger novo só quando ambas as fatias estiverem prontas. Isso não exige re-key duas vezes.

Além disso, o worker de promoção proposto está nebuloso: não define fila/schema do handoff, ordem publish-antes-ou-depois de `applyFileScanResult`, quem consome o S3 Object Created da quarentena, retry/DLQ, ownership do `CopyObject`, limpeza do objeto de quarentena, tenant lifecycle fence.

## 3. A transação "3 + N Requirements" não está sound

- **3.1 Sem access pattern reverso**: `Requirement` mora na partição do Subject (`PK=TENANT#t#SUBJECT#s`); `evidenceVersionId` é só atributo, sem índice "todas as Requirements que apontam para esta versão" — "atualizar todos os Requirements" não é descobrível sem Scan.
- **3.2 Phantom race**: uma query pré-transação não fecha a corrida contra um `linkEvidence` concorrente que vincula um Requirement C à mesma versão entre a leitura e o commit — OCC de A/B não protege a ausência de C.
- **3.3 Limite transacional**: `TransactWriteItems` tem teto de 100 ações; cardinalidade aberta por vínculos é design inaceitável mesmo abaixo do limite técnico (contenção/custo imprevisíveis).
- **3.4 `linkEvidence()` não é reusável como builder** — faz autorização + leitura + derivação + update + sua própria transação; não pode ser chamado dentro de outro `TransactWriteItems` sem extração explícita de um planner puro.
- **3.5 Auto-confirmação esquecida (bloqueante central)**: `run-extraction-validation.ts:229` + `dynamodb-extracted-field-store.ts:52` já escrevem o agregado de negócio dentro de `commitRunOutcome` para campos auto-confirmados — a proposta afirma (contraditoriamente) que só `confirmField` grava valor de negócio.
- **3.6 Idempotência subespecificada**: request hash não diz como incorpora seq/versionId/fileId, versões esperadas de Requirements descobertos dinamicamente, nem o comportamento da janela commit-then-fail-before-complete().
- **3.7 Confirm/reject não separados com precisão** para o novo modelo (reject nunca deveria tocar `validUntil`; auto-confirm precisa da mesma semântica do confirm manual).

## 4. Riscos adicionais omitidos

- **Multi-arquivo/PRINCIPAL**: `DocumentFile` permite PRINCIPAL + anexos; se cada objeto promovido gerar evento clean, múltiplos arquivos podem disparar OCR concorrente para a mesma Version. Política (só PRINCIPAL dispara? cada arquivo tem run próprio?) não definida. Identidade `{documentId,seq,fileId}` proposta não bate com o `ExtractionRun` atual (ainda tem `itemId` e `documentVersion: number` ambíguo).
- **Evento clean antes da confirmação DynamoDB**: `CopyObject` gera S3 Object Created antes/possivelmente-fora-de-ordem da transação `confirmFileScanClean` — o starter não pode confiar só na chave, precisa reconsultar `DocumentFile` (scanStatus=CLEAN, cleanObject bate exatamente, é PRINCIPAL, versão não retirada, tenant lifecycle ok).
- **Convenção de chave clean subespecificada** (por que `seq` e não `versionId` imutável; encoding/estabilidade sob retry).
- **Estados de `DocumentVersion` elegíveis para extração** não definidos (o que acontece se rejeitada/retirada/superseded durante o run).
- **Proveniência humana insuficiente**: `ExtractedField` não tem `confirmedBy`/`confirmedAt` — o checklist da proposta afirma auditabilidade que a própria entidade não sustenta (falha seu próprio critério 4).

## 5. E-014 e checklist

`SIM PARCIAL` é razoável, mas a pesquisa é periférica à decisão real (identidade, fan-out transacional, promoção S3, consistência entre agregados — não human-in-the-loop, que não está sendo redesenhado). Checklist mal ponderado: 55% repete a mesma garantia (preservar review/não autoaceitar mismatch), 25% contradiz a auto-confirmação já existente, 20% exige `confirmedBy` que o modelo não persiste, e nenhum peso cobre atomicidade/idempotência/identidade/multi-file/corrida copy-before-confirm/cardinalidade — uma proposta poderia tirar nota máxima nele e ainda perder updates de Requirement ou extrair um objeto órfão.

**Reponderação sugerida para Rodada 2**: 25% identidade/idempotência por DocumentVersion/DocumentFile; 25% atomicidade/convergência de `validUntil`+Requirements; 20% segurança do trigger e corrida S3-copy/DynamoDB-confirm; 15% semântica multi-arquivo; 10% preservação de auto-confirmação/revisão humana; 5% proveniência/auditoria.

## O que deve mudar na Rodada 2 (lista completa do Codex)

1. Reescrever o achado central distinguindo completude física, tráfego observado e autoridade futura.
2. Incluir o gap real do `upload-finalizer-handler`, não só o resultado GuardDuty.
3. Adicionar a Opção C: design/re-key independente, promoter separado, ativação só após ambos prontos.
4. Definir precisamente a arquitetura do promoter (fila/schema, ordem, retry/DLQ, ownership do CopyObject, cleanup, tenant fence).
5. Especificar ordem copy/confirm, objeto órfão, validação autoritativa no starter.
6. Decidir política PRINCIPAL vs ATTACHMENT.
7. Redesenhar identidade de `ExtractionRun` (eliminar ambiguidade OCC `version` vs `DocumentVersion.seq/versionId`).
8. Tratar explicitamente o caminho de auto-confirmação, não só o confirm HTTP.
9. Abandonar ou redesenhar "3+N Requirements": access pattern reverso, cardinalidade, phantom fence, limite de 100 ações, estratégia de convergência.
10. Especificar expected versions e request hash de idempotência, incl. falha entre commit e complete().
11. Separar transações de confirm/reject/auto-confirm por efeitos reais.
12. Definir estados de `DocumentVersion` elegíveis e comportamento sob transição concorrente.
13. Corrigir checklist E-014 para medir os riscos reais.
14. Não afirmar auditabilidade de "quem confirmou" sem fonte durável para isso.

**Nota (cega): 5.6/10.**
