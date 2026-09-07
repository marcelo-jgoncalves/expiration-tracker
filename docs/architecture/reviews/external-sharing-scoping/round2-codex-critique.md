# Rodada 2 — Crítica Codex (ExternalShareLink)

**Revisor**: Codex (`codex exec`), 2026-09-07. Nota cega, avaliação achado-a-achado da revisão Rodada 2 do Claude contra os 17 achados originais.

## Nota cega — Rodada 2

A revisão melhora materialmente o desenho: congela o arquivo, remove o falso estado `EXPIRED`, reconhece a janela residual do presign, adiciona lifecycle fencing e tenta tornar a criação atômica. Porém, ainda há inconsistências executáveis importantes. Algumas correções citam atributos inexistentes no modelo real, o cap de cinco links não tem mecanismo atomicamente aplicável, o rate limiting continua distinguível e a auditoria desapareceu acidentalmente do checklist v2.

### Avaliação dos 17 achados

1. **PARCIALMENTE FECHADO** — A promessa foi corrigida para “revogação imediata para novas emissões”, com janela residual de presign de cinco minutos. Falta fechar a corrida entre a leitura de `ACTIVE` e a emissão do presign: uma revogação concorrente ainda pode ocorrer nesse intervalo.

2. **FECHADO** — `documentFileId` tornou-se obrigatório, concreto e resolvido na criação, com regra determinística para escolher o `PRINCIPAL`.

3. **NÃO FECHADO** — A intenção transacional é correta, mas as condições propostas usam atributos que não existem: `DocumentFile` possui `scanStatus`, não `status`; `DocumentVersion` possui `state`, não `status`. Além disso, a condição precisa conferir explicitamente `versionId` no arquivo. Como escrito, a transação não implementa o vínculo prometido.

4. **PARCIALMENTE FECHADO** — `no-store` e redaction são mitigações pertinentes, mas a própria revisão deixa a redaction condicionada a confirmação futura e não especifica o `Referrer-Policy: no-referrer` exigido pelo checklist. URL continua exposta a histórico, telemetria e infraestrutura intermediária.

5. **FECHADO** — A autoridade foi definida como o selector e o conflito com `{shareId}` colapsa no erro genérico. Ainda seria mais simples remover `{shareId}` da rota, mas não resta ambiguidade de autorização.

6. **PARCIALMENTE FECHADO** — Link e ponteiro foram colocados numa única transação, mas o cap de cinco links ativos não possui fence/counter materializado. DynamoDB não consegue condicionar atomicamente a quantidade de itens retornada por uma Query. O tratamento de colisão do selector também é afirmado, não especificado.

7. **PARCIALMENTE FECHADO** — A referência a `DocumentArchiveGuestRateLimiter.consumeBoth` agora é factual. Contudo, o código real consome selector e IP sequencialmente, produzindo diferenças de estado e latência. A revisão também oferece duas ordens contraditórias: o checklist diz hash antes do rate limit; a resposta diz rate limit antes do hash. Um HTTP 429 continua distinguível de 404 pelo próprio status.

8. **PARCIALMENTE FECHADO** — A comparação dummy foi adicionada conceitualmente, mas não foi definido o material dummy, nem demonstrado custo equivalente nos caminhos selector inexistente, secret inválido e token malformado. A ordem contraditória do achado 7 também impede afirmar equivalência.

9. **FECHADO** — Remover `EXPIRED` persistido e derivar a expiração de `expiresAt` elimina corretamente a transição inexistente.

10. **FECHADO** — `ttlDays` agora tem semântica inequívoca: opcional, default 7, intervalo válido `1..30`.

11. **FECHADO** — O acesso foi congelado em um `documentVersionId` e `documentFileId` concretos. Não há mais ampliação silenciosa para versões futuras.

12. **NÃO FECHADO** — A revisão continua dizendo que a postura sem senha depende de confirmação de Marcelo e bloqueia a implementação. Sendo uma decisão material de segurança-produto, o protocolo não pode simultaneamente considerá-la encerrada. A pesquisa também não sustenta adequadamente que Google e Dropbox tratem bearer link como base apropriada para apólices/contratos desta aplicação.

13. **PARCIALMENTE FECHADO** — Remover contadores mutáveis e renomear `ACCESSED` para `PRESIGN_ISSUED` são correções fortes. Mas não foi definido onde os quatro eventos serão persistidos, sua retenção, consulta ou atomicidade. O `security-audit.ts` real escreve logs tipados no CloudWatch; não é, por si, um “stream de auditoria” consultável como a revisão afirma.

14. **PARCIALMENTE FECHADO** — O HMAC com pepper separado e o uso de `requestContext.identity.sourceIp` fecham parte do problema. Porém, o limiter real monta a PK com o IP cru (`DOCARCHIVEGUESTIP#${ip}#RATE`), persistindo o endereço em DynamoDB. A revisão protege apenas o evento de auditoria, não o armazenamento operacional do IP.

15. **PARCIALMENTE FECHADO** — A leitura de `TenantLifecycleRecord = ACTIVE` foi acrescentada, mas precisa ser explicitamente strongly consistent e ainda sofre corrida entre a leitura e a emissão do presign. Também não foi descrita a remoção dos ponteiros tenantless no purge do tenant.

16. **PARCIALMENTE FECHADO** — O DTO fechado evita serializar agregados internos. Entretanto, `sanitizeFormulaInjection` é uma defesa de planilha, não sanitização geral de JSON/HTML, e altera o texto exibido sem resolver output encoding no frontend. Faltam limites de tamanho/caracteres, tratamento de `Content-Disposition` e definição correta da fronteira de escaping.

17. **NÃO FECHADO** — O modelo revisado não contém `GSI1PK/GSI1SK`, nem define namespace e ordenação do índice. Logo, a listagem “via GSI1” não tem writer. Paginação/cursor não foram especificados e, principalmente, o cap de cinco links não pode ser imposto atomicamente pela listagem proposta.

## Novos achados da Rodada 2

18. **A auditoria desapareceu da régua v2.** O texto afirma que o antigo Critério 7 foi repesado de 5% para 12%, mas nenhum dos dez critérios avalia auditoria. Os 12% foram atribuídos à revogação. Isso permite nota máxima mesmo sem qualquer evento de auditoria.

19. **A criação referencia nomes de atributos incorretos.** `DocumentFile.status` e `DocumentVersion.status` não existem; os nomes reais são `scanStatus` e `state`.

20. **`documentTypeId` não evita a leitura prometida.** A resposta precisa de `documentTypeName`, mas o item denormaliza apenas o ID. É necessário persistir um snapshot do nome ou reler `DocumentType`, definindo também a semântica após rename/archive.

21. **A ordem anti-enumeração é internamente contraditória.** O critério 5 define `parse → dummy/real hash → rate limit → lookup`; a resposta ao achado 7 define `parse → rate limit → hash → lookup`.

22. **O cap não possui autoridade concorrente.** “Contar links ativos e depois criar” admite duas criações simultâneas ultrapassando cinco. É necessário um contador/fence no `Document`, um item agregado dedicado ou abandonar a garantia rígida.

23. **A chave do rate limiter persiste IP cru.** Isso contradiz a disciplina de pseudonimização defendida para auditoria e cria retenção de PII operacional não discutida.

## Calibração do checklist v2

O checklist v2 ainda está mal calibrado por três razões:

- auditoria foi removida acidentalmente apesar da afirmação de repeso;
- criação atômica e integridade referencial se sobrepõem parcialmente, enquanto transporte recebe apenas 8%;
- requisitos de lifecycle/purge, política de presign S3 e auditabilidade não estão apoiados por pesquisa primária correspondente.

Eu restauraria auditoria como critério próprio e incluiria lifecycle completo — acesso, purge do link e remoção do ponteiro tenantless — em vez de avaliar apenas a leitura de `TenantLifecycleRecord`.

## Notas cegas

**Pesquisa: 6,2/10.** A revisão não adicionou fontes. Permanecem ausentes documentação primária da AWS sobre presigned URLs, revogação/capability URLs e logs, além de fonte oficial do Google. Parte relevante da régua v2 deriva corretamente da análise interna, mas não da pesquisa externa que ela afirma recalibrar.

**Design: 6,7/10.** Houve avanço substancial, especialmente nos achados 2, 9, 10 e 11. A nota permanece abaixo do gate porque há condições DynamoDB inexequíveis como escritas, cap concorrente sem mecanismo, anti-enumeração contraditória, auditoria subespecificada e uma decisão material de senha ainda dependente do responsável final.

NOTA FINAL: pesquisa=6,2/10 design=6,7/10
