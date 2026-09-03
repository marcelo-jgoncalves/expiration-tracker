# Rodada 5 - Crítica Codex (final)

A régua permanece fechada. Avalio somente os quatro pontos remanescentes.

## 1. Claim atômico do parse — FECHADO

A combinação `version = job.version AND status IN (UPLOADED, AWAITING_MAPPING)` fornece exclusão atômica: apenas uma entrega pode efetuar a transição para `PARSING`; as demais encerram antes de ler o S3 ou produzir outro plano.

A discriminação dos envelopes no handler também está adequadamente definida: evento S3 e mensagem SQS são traduzidos para o mesmo comando interno `{tenantId, jobId}`. Isso preserva a função de aplicação independente do transporte.

Precisão textual: a primeira ação ainda é a leitura do `ImportJob`, necessária para obter versão e mapping; o claim é a primeira mutação e ocorre antes da leitura do S3. Isso não prejudica o mecanismo.

## 2. Vínculo `/schema` → objeto parseado — PARCIAL

Aceito a conclusão operacional, mas não integralmente a fundamentação.

Leitura direta confirma que o `planSha256` atual é calculado sobre o conteúdo JSONL derivado do plano, não sobre os bytes do CSV original. Portanto, é impreciso dizer que “os bytes efetivamente parseados estão hasheados no plano”. CSVs diferentes podem, em princípio, produzir o mesmo plano.

Também não é garantido que um mapeamento baseado no objeto antigo falhe: o arquivo substituto pode preservar os mesmos nomes de coluna e conter dados diferentes. Assim, `objectETag` informativo realmente não prova identidade entre o objeto inspecionado por `/schema` e o posteriormente parseado.

Entretanto, aceito a proporcionalidade da decisão:

- O preview é produzido a partir do plano efetivamente parseado.
- O commit verifica esse plano por `planSha256`.
- Portanto, permanece válida a invariante principal: o commit não aplica um plano diferente daquele disponibilizado no preview.
- A possibilidade de sobrescrever o objeto antes do parse já existe no fluxo shipped de Subject; esta fatia não cria a mutabilidade da upload key.
- A lacuna residual é um TOCTOU entre inspeção de schema e parse, com possível surpresa de UX, não corrupção silenciosa entre preview e commit.

Minha classificação é, portanto, **PARCIAL**: discordo da afirmação forte de que não existe gap algum e da descrição do que o hash cobre, mas concordo em tratá-lo como risco pré-existente aceito e não como regressão bloqueante desta fatia. O registro final deve preservar exatamente essa distinção.

## 3. UTF-8 cortado na fronteira do Range — FECHADO

O descarte exclusivo de uma sequência multibyte incompleta no sufixo, seguido de decodificação fatal do prefixo restante, resolve o falso negativo causado pelo corte mecânico sem tolerar bytes inválidos no meio do conteúdo.

Na implementação, a inspeção deve operar nos bytes brutos e reconhecer apenas bytes líderes UTF-8 válidos e sua quantidade esperada de continuations; a primeira decodificação não-fatal descrita é desnecessária. Isso é detalhe implementacional, não lacuna do design fechado.

## 4. `#` e limites dos componentes de chave — PARCIAL

Leitura direta confirma que `src/runtime/aws/ids.ts` gera:

- `documentId` como `doc_${ulid()}`;
- `requirementId` como `req_${ulid()}`;
- `subjectId` como `subject_${ulid()}`;
- `templateItemId` como `reqtplitem_${ulid()}`.

Esses alfabetos não contêm `#`, portanto a conclusão sobre IDs controlados pelo sistema está correta. A justificativa reformulada para proibir `#` em `externalId` também está suficientemente precisa: trata-se de preservar uma gramática de chave simples e extensível, não de alegar colisão imediata inevitável.

Há, porém, uma imprecisão verificável sobre D-191. Ela fixou `MAX_NAME_BYTES = 200` e aplica esse limite aos itens de template, mas o caminho atual `createRequirement()` não chama `assertTemplateItemSizes()` nem executa uma validação equivalente em bytes. O schema HTTP limita 200 code points, não 200 bytes UTF-8. Portanto, ainda não existe uma invariante universal de domínio segundo a qual todo `Requirement.name` já foi validado nesse orçamento.

Isso não bloqueia o bulk import: a nova implementação pode reutilizar explicitamente `MAX_NAME_BYTES` ou promover uma validação comum para todos os caminhos. Mas o registro não deve afirmar que a validação já cobre universalmente `Requirement.name`.

## Veredito final

O design está aprovado com duas qualificações documentais/implementacionais:

1. `objectETag` permanece não-autoritativo; há um TOCTOU aceito entre `/schema` e parse. `planSha256` protege plano-preview-commit, não a identidade dos bytes brutos do CSV.
2. O limite de 200 bytes de `Requirement.name` deve ser aplicado explicitamente pelo bulk import — idealmente por uma validação compartilhada — porque D-191 ainda não o torna universal em todos os caminhos existentes.

Essas qualificações não invalidam o mecanismo central nem justificam impedir a fatia. O claim concorrente e o tratamento da fronteira UTF-8 estão fechados; os riscos restantes são delimitados, registráveis e proporcionais.

**O protocolo converge nesta Rodada 5**: Claude 9.4 e Codex 9.1, ambos ≥9.0 sem arredondamento. Não registro desacordo arquitetural bloqueante. Registro apenas a divergência residual acima sobre a extensão exata das garantias de `planSha256` e sobre a cobertura atual do orçamento de bytes de `Requirement.name`.

**Nota Codex (cega), Rodada 5 - design: 9.1/10.**
