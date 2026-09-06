# Rodada 1 — Crítica do Codex

**Revisor**: Codex (`codex exec --skip-git-repo-check`, sem acesso ao repositório real — avaliou só o texto da proposta). **Data**: 2026-09-06. Nota cega: Codex não viu nenhuma nota do Claude antes de responder.

## 1. Pesquisa Externa

`SIM` é defensável, mas a proposta usa algumas fontes além do que elas demonstram diretamente.

- Salesforce sustenta bem a cautela com conversão de tipo (perda de dados, recomendação de evitar conversão com dado existente), mas **não sustenta sozinho** "o padrão correto é sempre arquivar e criar outro `fieldId`" — essa é uma inferência de design conservadora do Claude, não uma regra Salesforce. Fonte: Salesforce Help, "Considerations for Converting the Field Type of a Custom Field".
- Force.com/Salesforce sustenta o modelo metadata-driven multitenant, mas não sustenta diretamente as decisões locais de embutir definições no `DocumentType`, guardar valores em `Document`, nem o cap de 20 campos — essas são decisões internas.
- Airtable sustenta bem o anti-exemplo de conversão permissiva com perda/limpeza de valores (fonte oficial). A thread comunitária citada é evidência fraca — sinal prático, não base normativa.
- HubSpot sustenta tipos fechados e propriedades configuráveis, mas **não sustenta a política de imutabilidade absoluta** — HubSpot permite algumas mudanças de tipo com ressalvas.
- Contentful sustenta fortemente version/OCC em mutações de schema e validação prospectiva, mas a proposta usa Contentful para "expand-and-contract recomendado explicitamente" — citação imprecisa; as fontes sustentam versionamento/migrations, não essa frase especificamente.
- Confluent sustenta schema evolution/compatibilidade, mas "só mudança aditiva é retrocompatível" está simplificado — depende de formato/defaults/optionalidade/modo (backward/forward/full/transitive).

## 2. Checklist — CONTESTADO

Régua boa para "não corromper valor existente por mudança de tipo", mas **estreita demais para uma decisão nível 5**. Falta critério derivado diretamente da pesquisa sobre versionamento/OCC de schema (central em Contentful/Confluent) e sobre identidade estável de opções em `SINGLE_SELECT` (onde renomear/remover opção gera ambiguidade).

Por critério original:
- **Critério 1 (peso 25%)**: correto e importante; peso talvez alto, mas defensável.
- **Critério 2 (peso 20%)**: incompleto — valor carrega `valueType` mas não versão da definição nem snapshot de opção/label; suficiente para interpretar tipo, insuficiente para exibir/auditar valor histórico pós-rename/archive.
- **Critério 3 (peso 20%)**: correto.
- **Critério 4 (peso 15%)**: correto para `valueType`, mas mistura tipo de campo com opções — opções têm problema PRÓPRIO de identidade/rename/archive/valor legado.
- **Critério 5 (peso 10%)**: âncora precisa separar "Document existente permanece válido" de "Document existente EDITADO depois precisa satisfazer novas validações" (Contentful faz a segunda coisa em publish/update) — a proposta original não distinguia isso explicitamente.
- **Critério 6 (peso 10%)**: correto, mas fraco sem critérios de representação (date-only vs. datetime, decimal/money, limites de texto, precisão numérica).

**Critérios que Codex adicionaria/substituiria**:
- OCC/versionamento de definição e escrita de valor (proteção contra stale schema/lost update).
- Identidade e lifecycle de opções (`optionId` estável, não string nua).
- Limites de storage distinguindo campos/opções ATIVOS de total histórico (tombstones nunca removidos fisicamente).
- Semântica de update parcial/clear/null explícita (merge vs. replace, remoção de valor).

**Nota da régua (Rodada 1): 7,1/10.**

## 3. Decisões — achados por decisão

- **Decisão 1** (definições embutidas): boa direção, mas cap único de 20 combinado com "nunca remover fisicamente" deixa um tenant sem caminho de evolução depois de criar/arquivar 20 campos, mesmo com zero campos ATIVOS úteis — cap deve distinguir ativos de total.
- **Decisão 2** (valores no `Document`): concorda com `Document` (não `DocumentVersion`), mas contrato incompleto — falta `updatedAt`/`updatedBy`, falta semântica de remoção de valor, risco de **lost update** se o PATCH substituir o mapa inteiro sem OCC no `Document.version`. `value: string | number | boolean` com JS `number` é perigoso para dinheiro/decimais ("valor da apólice").
- **Decisão 3** (imutabilidade de `valueType`): **sólida — a parte mais forte da proposta.** Só precisa virar invariante de domínio/contrato HTTP explícito, não só convenção de service.
- **Decisão 4** (arquivamento/opções): **contradição real** — a decisão diz que uma opção referenciada nunca é removida, mas também diz que isso não é validado e que uma opção órfã é aceitável; as duas afirmações não coexistem sem uma identidade estável de opção. Posição do Codex: opção deve ser objeto `{optionId, label, status}`, valor armazenado guarda `optionId` (+ snapshot de label), remover uma opção vira `ARCHIVED`, nunca delete físico.
- **Decisão 5** (required prospectivo): aceitável, mas a semântica exata precisa ser explícita — se um Document antigo tiver QUALQUER metadata editada depois de um campo virar `required`, isso é validação no PRÓXIMO write (padrão Contentful), não "nunca bloqueado" como a redação original sugeria.
- **Decisão 6** (RBAC): sem achado forte, boa separação definição-vs-valor; só confirmar que editar metadata não contorna outros fences já existentes (tenant boundary, DocumentType inactive, etc.).
- **Decisão 7** (rotas HTTP): **race real (TOCTOU)** — cliente lê definição ATIVA, monta update; outro request arquiva o campo nesse meio-tempo; primeiro request grava valor sob campo já arquivado se a escrita não for transacional/condicionada à versão do `DocumentType` lida. Endpoint de valores precisa de `expectedDocumentVersion` (OCC no Document) + fencing contra a versão da definição usada; endpoint de field patch precisa de OCC explícito também.
- **Decisão 8** (taxonomia): fechada é correto, mas `NUMBER` subespecificado para dinheiro (`DECIMAL` normalizado como string seria melhor) e `DATE` deveria ser explicitamente `YYYY-MM-DD` (date-only), não ISO datetime genérico.
- **Decisão 9** (busca fora de escopo): concorda, mas a modelagem não deve fechar a porta para indexação futura — guardar valor normalizado (não label cru) preserva essa opção.

## 4. Perguntas abertas — posição do Codex

1. Valores devem ficar no `Document`, não em `DocumentVersion`, para esta fatia — metadata configurável é propriedade editável do registro atual; se auditoria por renovação for necessária no futuro, resolver via histórico/audit event opcional, não mover tudo para `DocumentVersion` agora.
2. Cap 20 é aceitável só como cap de campos ATIVOS — propõe `MAX_ACTIVE_METADATA_FIELDS=20` + `MAX_TOTAL_METADATA_FIELD_DEFINITIONS=100` (tombstones), mais limites de tamanho de texto/opções; o limite de 400KB do DynamoDB não deve ser o único dimensionador mas deve informar os limites de texto.

## 5. Nota Final da Rodada 1

Régua contestada → duas notas separadas, só neste artefato de rodada (nunca como coluna do `decisions-log.md` final, per `research-protocol.md`):

- **Nota da régua**: 7,1/10
- **Nota do design contra a régua corrigida**: 7,4/10

Veredito: direção arquitetural boa (destaque para imutabilidade de `valueType`, Decisão 3), mas Rodada 1 não fecha por lacunas reais em OCC/versionamento, lifecycle de opções, cap com tombstones, semântica de `required` em update parcial, e representação de dinheiro/data.

## Auto-nota do Claude (Rodada 1, formada de forma independente, sem ver a nota do Codex antes de fechar o design da Rodada 2)

- **Nota da régua original**: 7,0/10 — concordo com a maior parte da crítica do Codex antes mesmo de ler seu texto completo: o checklist da Rodada 1 cobria bem "nunca reinterpretar tipo", mas não cobria OCC/concorrência (uma omissão real, já que este projeto tem disciplina explícita de OCC em toda escrita mutável, `AGENTS.md` §7 — deveria ter sido um critério desde o início) nem identidade de opção.
- **Nota do design original**: 7,2/10 — Decisão 3 (imutabilidade de tipo) é o ponto mais forte e fecha 2 critérios por construção; Decisão 4 tem uma contradição real que eu deveria ter pego antes de propor (disse "nunca remover opção referenciada" e "órfã é aceitável" na mesma decisão, sem uma identidade estável que tornasse as duas frases compatíveis); ausência de OCC explícito nas Decisões 2/7 é um gap real dado o padrão já estabelecido do projeto (`occ.ts`), não um nice-to-have.
