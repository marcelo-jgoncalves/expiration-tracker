# Rodadas 3-4 — Dossiê Documental PDF/Excel (fechamento)

## Rodada 3 — Revisão Claude + crítica Codex

Aceitos os 5 pontos da Rodada 2: (1) limitação explícita registrada — manifesto v1 mostra a
evidência ATUALMENTE linkada + histórico de versões daquele documento, NÃO reconstrói relinks
anteriores para outro `documentId`; (2) "histórico" = lista de `DocumentVersion` com estado
terminal, não log evento-a-evento; (3) XLSX vira formato EXAUSTIVO (nenhum truncamento de texto),
PDF vira SUMÁRIO NARRATIVO (pode envolver texto, nunca omite uma linha/Requirement inteiro) — os
dois nunca divergem em CONJUNTO de dados, só em apresentação visual; (4) mitigação de Excel
registrada como extensão deliberada (tab/controle além de `=`/`+`/`-`/`@`), não cópia literal; (5)
contrato físico adotado: `POST .../dossier` cria `DossierExportRun` com snapshot do escopo e
dispara UM worker que gera AMBOS artefatos na mesma execução; `GET .../download?format=` só
autoriza+entrega via presign sob demanda.

**Nota cega Codex Rodada 3: 8,8/10.** Objeção bloqueante: `POST` disparar o worker imediatamente
não cumpre bem J22 ("mostra escopo antes de exportar") — mostrar o snapshot DEPOIS de disparar
geração é tarde demais para o usuário corrigir escopo. Exigido: preview antes de confirmar geração
(2 rotas: preview mostra escopo+hash, confirm dispara geração com o hash). Também faltava declarar
se o dossiê reflete valores "as of preview time" ou "as of generation time".

## Rodada 4 — Revisão final Claude + fechamento Codex

Aceito por completo, design final: `POST .../dossier` cria `DossierExportRun` em
`PREVIEW_READY` (NUNCA dispara o worker) — a resposta já É o preview (lista de `requirementId`s +
campos que aparecerão) + um `scopeHash` (fingerprint do conjunto de `requirementId`s+versão de
cada um no momento do preview, inspirado no padrão de fingerprint de cursor de D-194 — mesmo
princípio técnico, canonical JSON+SHA-256+rejeição fail-closed, não a mesma convenção literal,
correção de precisão do Codex). `POST .../dossier/{runId}/confirm` (idempotente, exige o MESMO
`scopeHash`; hash divergente → 409, força novo preview) dispara o worker. **Semântica declarada**:
CONJUNTO de linhas incluídas = congelado no preview (via `scopeHash`); VALORES de cada campo
(status/validade/histórico) = relidos FRESCOS no momento da geração, nunca congelados do preview —
mesma convenção de releitura fresca de D-193 (nunca stale-write). Dossiê gerado declara
`generatedAt` explicitamente (rodapé/cabeçalho) para nunca deixar ambíguo se é "as of preview" ou
"as of generation" (é sempre a segunda para valores, a primeira para o conjunto de linhas).

**Nota cega final Codex: 9,2/10.**
**Nota cega final Claude: 9,3/10** — 4 rodadas reais, cada achado do Codex verificado por leitura
direta de código (`authorization.ts:323`, `csv-export-writer.ts`, campos de `Requirement`/
`DocumentVersion`), design final reusa 4 precedentes já `APPROVED` (fingerprint de D-194,
releitura fresca de D-193, mitigação de formula-injection de D-195, RBAC ADMIN-only de D-204) em
vez de inventar mecanismo novo em qualquer ponto.

**Ambos ≥9,0, sem arredondar. FECHADO — DESIGN APROVADO.**
