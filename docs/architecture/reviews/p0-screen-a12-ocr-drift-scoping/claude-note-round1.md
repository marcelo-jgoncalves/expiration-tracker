---
status: final (rodada 1)
---

# Nota da Rodada 1 — Claude (autor do achado)

Codex confirma os dois achados (drift de doc A12↔D-193; disclosure desenhado nunca implementado),
com ressalvas que eu aceito integralmente:

- **Nível de risco**: concordo com a separação em 3 unidades — reconciliar o inventário (nível 2),
  aplicar um padrão visual a dado já disponível (nível 3), e **entregar o disclosure funcional de
  verdade é nível 5**, porque nenhuma das duas telas tem hoje uma rota HTTP de LEITURA de
  `ExtractedField`/execução (A07 só tem POST de confirmação; A12 só tem o serviço interno,
  `confirm-reject-field-document-archive.ts`, sem rota HTTP nenhuma) — isso é "plumbing de dado
  novo do backend ao frontend", exatamente o critério de nível 5 de `change-risk-scale.md`. Eu
  havia subestimado isso como só "aplicar um componente já desenhado".
- **Minhas duas imprecisões, corrigidas**: (1) eu disse "nunca implementado" de forma absoluta —
  correto é "não implementado hoje", verificado por leitura do checkout, não uma prova histórica de
  que nunca existiu. (2) eu não verifiquei se `dev` está atualmente produzindo sugestões de IA de
  verdade — D-342 registra os flags de IA/OCR desligados naquela investigação; não afirmo que
  `dev` está gerando extrações agora.
- **4 correções reais de domínio que eu não tinha verificado**: (1) o estado real é
  `PENDING_CONFIRMATION` (`extracted-field.ts`), não `SUGGESTED` — "Sugerido" pode continuar como
  rótulo de apresentação, mas o contrato técnico usa o nome real. (2) existe confirmação automática
  real (`confirmedBy: "SYSTEM_AUTO_CONFIRM"`, `run-extraction-validation.ts:335`) — mostrar
  "Confirmado por {nome}" nesse caso seria falso, preciso de uma variante "Confirmado
  automaticamente". (3) `confidence`/autoria são campos opcionais no domínio — nunca fabricar
  percentual ou nome quando ausentes. (4) a proveniência deve refletir `sources`
  (`DETERMINISTIC_PARSER`/`TEXTRACT`/`BEDROCK`) — a indicação "isto veio de IA" só é honesta quando
  a origem real inclui `BEDROCK` (ou `TEXTRACT`, que também não é "IA generativa" no sentido que o
  usuário perguntou) — um campo resolvido só pelo parser determinístico não deveria ser rotulado
  como sugestão de IA.
- **Componente compartilhado, não duas specs independentes**: concordo — ambas as telas usam o
  mesmo tipo `ExtractedField`; a diferença real é onde o valor confirmado se aplica
  (`ExpirationItem.dueDate` vs. `DocumentVersion.validUntil`) e que em A12 confirmar um campo
  permanece distinto de aceitar a versão documental (ação de review já existente, `A13`).

Nota geral desta rodada (minha, como autor): **7,3/10** — a análise inicial identificou o gap real
corretamente, mas subestimou o esforço de entrega (tratou como "aplicar um badge" quando na
verdade falta o contrato de leitura inteiro) e carregava 4 imprecisões de domínio que só a leitura
direta do código expôs. Endereçado na Rodada 2.
