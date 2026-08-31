# Wave 1 — Design System Reconciliation: Rodada 1 (proposta Claude)

Item 4 da fila (`NEXT_SESSION_PROMPT.md`), Wave 1 de `docs/engineering/pilot-readiness-program.md`.
Autoridade ampliada: `docs/engineering/ai-governance.md` §1 (2026-08-31) nomeia explicitamente
"Design System reconciliation" como um dos itens onde Claude+Codex podem decidir resíduo de
produto, não só mecanismo técnico.

## Declaração de pesquisa externa (research-protocol.md)

`SIM PARCIAL`. Não é uma decisão de padrão de mercado não resolvido (RBAC, invite flow) — é uma
revisão de consistência interna de 2 documentos que Marcelo escreveu contra o que já está
`APPROVED`/implementado neste repositório especificamente. Mas ambos os documentos invocam
referências normativas externas específicas (WCAG 2.2, Core Web Vitals, OWASP ASVS 5.0.0, DTCG
Format Module 2025.10) — verificadas pontualmente abaixo, não pesquisadas amplamente.

- WCAG 2.2 AA contraste 4.5:1 texto normal / 3:1 texto grande — confere com o texto padrão citado
  pelo W3C (`Understanding SC 1.4.3`); já é o padrão usado em `visual-language-and-design-system.md`
  (`VL-G2`). Nenhuma discrepância.
- WCAG 2.2 target size mínimo 24×24 CSS px com exceções — confere com `SC 2.5.8`. O proposal 1
  adota 40×40/44×44 como padrão interno mais rígido, o que é estritamente mais forte, não conflita.
- Core Web Vitals thresholds (LCP≤2.5s, INP≤200ms, CLS≤0.1, p75) — correspondem aos thresholds
  "good" publicados em web.dev/vitals a partir de 2024 (INP substituiu FID em março/2024). Correto.
- OWASP ASVS 5.0.0 — versão real publicada (2025). Uso como baseline de verificação é razoável e
  já é o padrão que `frontend-production-foundation.md` cita implicitamente via os achados de sessão
  fixation/resurrection da Rodada D.
- DTCG Format Module — proposal 1 já se declara honesto ("não é uma W3C Recommendation", "não
  precisa depender de tooling DTCG para existir") — não é uma alegação forte que precise de mais
  verificação.

Nenhuma dessas claims contradiz nada já decidido neste repositório. Não há necessidade de
checklist pesado de pesquisa — não é o tipo de decisão que E-014 cobre.

## O que já existe hoje (baseline, não repetir integralmente)

- `docs/frontend/visual-language-and-design-system.md`: `APPROVED — PROVISIONAL PENDING USER
  VALIDATION`, protocolo de 16 rodadas (Claude 9.2/Codex 9.04), gates `VL-G1..VL-G17`, tokens
  reais em `frontend/src/**` (2 camadas: primitivo→semântico), ~9 primitivos acessíveis, Operational
  Calm já implementado nas 5 superfícies do Core Expiration slice, 9 testes de acessibilidade no
  CI (`chromium`), 10 baselines de regressão visual (local, projeto `visual`).
- `docs/frontend/interface-quality-standard.md`: `APPROVED`, 12 eixos de qualidade de **interface/
  UX** (Task Suitability, IA, Information Presentation, System Feedback, Error Prevention/Recovery,
  Forms, Data Operations, Accessibility, Consistency, Content, Responsiveness, Trust/Risk) — escopo
  é adequação da interação ao domínio, não engenharia de implementação.
- `docs/frontend/bff-frontend-quality-standard-proposal.md`: nunca adotado. Lido na íntegra agora
  pela primeira vez neste ciclo. É majoritariamente um documento de **2026-08-2x anterior à
  implementação real do Full BFF** — §4 ainda "recomenda" adotar Full BFF como se fosse decisão em
  aberto, quando `frontend-production-foundation.md` já implementou e aprovou Full BFF via protocolo
  (D-053/D-054). Contém uma tentativa inicial de rubrica de qualidade de frontend (`FG1..FG4`,
  fitness function) sobreposta em espírito ao que a proposta nova cobre com mais rigor.

## Proposta 1 — `design-system-v1-proposal.md`

### Avaliação

**O que é genuinamente aditivo** (não existe hoje em `visual-language-and-design-system.md`, que é
um relatório de implementação + evidência, não um contrato de tokens):
- Arquitetura formal de 3 camadas (primitive→semantic→component) com nomenclatura DTCG-compatível
  — hoje os tokens existem em código (`frontend/src/components/ui/`, confirmado por `VL-G8 Token
  Consistency: PASS`) mas não há um documento normativo separado do relatório de implementação.
- Catálogo completo de ~30 componentes obrigatórios (§29) — hoje só ~9 primitivos existem
  implementados; o proposal nomeia o gap corretamente como trabalho futuro, não alega que já existe.
- Patterns nomeados (PageHeader, FilterBar, DataTable, OrganizationSwitcher, DangerZone, etc.) —
  vários já têm equivalente real no código B2B (`ActiveOrganizationProvider`/switcher de D-105/D-106,
  DangerZone-like de "Excluir organização") mas nunca foram formalizados como pattern reutilizável.
- Motion, z-index, breakpoints, i18n-readiness, dark-mode-readiness — nenhum destes é coberto hoje
  em `visual-language-and-design-system.md` (que documenta o que foi testado, não o espaço de design
  completo).
- Regras de token naming (`color.text.strong` em vez de `grayText`) — mais rígido e mais explícito
  do que qualquer coisa já formalizada, mas **consistente** com o que já foi implementado
  (`VL-G8: PASS`, "nenhum hex fora de `tokens.css`").

**Verificação de conflito real com gates já `APPROVED`**: nenhum encontrado. Pontos que à primeira
vista pareceriam reabrir decisão já fechada, na verdade não reabrem:
- §19 recomenda não usar `radius.full` como padrão universal de botão e chama o protótipo de "usa
  pills em excesso" — isso é uma crítica ao **protótipo pré-Design-System**, não ao que já foi
  `APPROVED`. `visual-language-and-design-system.md` já documenta ter corrigido exatamente essa
  classe de problema (a Rodada B achou um achado real de target/contraste). Não há contradição — é
  a mesma direção, formalizada em regra permanente.
- §15 proíbe texto funcional abaixo de 12px e remove o "padrão antigo de 11px para headings
  auxiliares" — `VL-G2 Contrast: PASS` já registra ter corrigido um achado real de contraste 4.48:1,
  na mesma classe de problema. Consistente, não conflitante.
- A paleta hexadecimal específica do proposal (`purple.600 = #7C3AED`, etc., §6) **não foi
  verificada contra os valores reais em `frontend/src/components/ui/tokens.css`** neste round —
  é um resíduo de implementação explícito, não um bloqueio de adoção do contrato/arquitetura.

**O que está underspecified / é resíduo real**:
1. O proposal não diz o que acontece com o documento `visual-language-and-design-system.md`
   existente — ele permanece como registro histórico de protocolo (16 rounds, gates, evidência
   real) ou é descartado? O documento novo não tem evidência de teste nenhuma (nenhum gate, nenhuma
   asserção automatizada) — é puramente prescritivo.
2. Reconciliação token-a-token contra os valores hex reais já implementados não foi feita.
3. O próprio documento (§55, §91) diz explicitamente que os "critérios formais de qualidade de
   engenharia, testes e gates" ficam para "documento separado" — que é exatamente a proposta 2.

### Recomendação

**ADOTAR como novo documento normativo** para arquitetura de tokens/componentes/patterns
(`docs/frontend/design-system.md` ou manter o nome atual promovido de `-proposal` para normativo),
em relação de **COEXISTÊNCIA COM PRECEDÊNCIA EXPLÍCITA**, não substituição, com
`visual-language-and-design-system.md`:

- `design-system-v1-proposal.md` (promovido) é a fonte normativa **prospectiva** — tokens,
  catálogo de componentes, patterns, regras de uso — para toda implementação de frontend daqui em
  diante.
- `visual-language-and-design-system.md` permanece como **registro histórico de protocolo e
  evidência** do que já foi implementado, testado e aprovado (16 rounds, `VL-G1..VL-G17`,
  baselines) — não é descartado nem marcado obsoleto, porque contém prova real que o documento novo
  não tem.
- Nenhum gate `VL-G1..VL-G17` é reaberto; a nova proposta é estritamente compatível com eles.
- Reconciliação token-a-token (paleta hex real vs. proposta) e implementação do catálogo de
  componentes faltante são trabalho de uma **wave futura de implementação**, nomeada explicitamente
  como tal — não código neste round.

## Proposta 2 — `frontend-engineering-quality-standard-v1-proposal.md`

### Avaliação

**Escopo real vs. os dois documentos existentes que poderiam sobrepor**:
- vs. `interface-quality-standard.md` (12 eixos **UX/IA**: Task Suitability, IA, Feedback, Forms,
  Accessibility como percepção, Consistency, Content, Trust/Risk...): a proposta nova declara
  explicitamente (§4.1, §29-30) que UX é avaliada por aquele documento e não duplica a rubrica —
  seu próprio eixo 5 (UX, 10%) é "avaliado pelo Interface Quality Standard", `InterfaceOverall`
  tratado como gate paralelo, nunca redefinido. **Sem sobreposição real** — são 12 eixos
  diferentes cobrindo um espaço diferente (segurança/BFF, confiabilidade técnica, performance,
  arquitetura, testes, privacidade, observabilidade, DS-conformidade-de-implementação,
  responsividade-como-viewport-técnico) do que os 12 eixos de `interface-quality-standard.md`
  cobrem (adequação de tarefa, hierarquia, conteúdo, confiança). Nomes que parecem colidir
  (`Accessibility` aparece nos dois, `Responsiveness`/`Responsividade` também) são a mesma
  preocupação vista de ângulos diferentes (UX de acessibilidade vs. prova técnica automatizada de
  acessibilidade) — não é redundância, é a mesma disciplina que `AGENTS.md` já usa em
  Arquitetura/Qualidade de Engenharia/Engenharia de Contexto como eixos paralelos, não um
  substituindo o outro.
- vs. `bff-frontend-quality-standard-proposal.md` (nunca adotado, lido na íntegra): esse documento
  é estruturalmente mais antigo — parte dele (§4-11) ainda argumenta **a favor de** adotar Full BFF
  como se fosse uma decisão em aberto, quando isso já foi decidido e implementado
  (`frontend-production-foundation.md`, D-053/D-054). Sua rubrica (`FG1..FG4`, fitness function) é
  um esboço menos completo do mesmo espaço que a proposta nova cobre com 12 eixos, gates nomeados
  (`FE-G1..FE-G5`), matriz de aplicabilidade por tipo de mudança, e frontmatter formal
  (`status`/`owner`/`authority`/`scope`). Não há conteúdo real em
  `bff-frontend-quality-standard-proposal.md` que a proposta nova não cubra — o argumento
  arquitetural do Full BFF (§4-11) já é fato consumado no código real, não norma pendente.

**Consistência com o que já está `APPROVED`**: nenhuma contradição encontrada.
- §2 é explícito que não substitui `docs/engineering/definition-of-done.md` globalmente, só
  especializa para frontend — consistente com como `AGENTS.md` §5 já trata precedência de
  documentos temáticos correntes.
- FE-P1/FE-P2/FE-P9 (backend é source of truth, browser não é trust boundary, UI não é boundary de
  segurança) são reafirmações de invariantes já reais no código (`RequestContextResolver`,
  `X-Organization-Id` BFF-derived de B2B-6/D-101-102) — não introduz regra nova, formaliza o que já
  é verdade.
- A seção OCC/idempotência (§12-13) é consistente com os padrões reais já usados
  (`src/shared/dynamodb/occ.ts`, `IdempotencyStore`).

**O que está underspecified / residual real**:
1. §4.2 referencia `docs/frontend/design-system.md` como "caminho reconciliado adotado pelo
   repositório" — depende da decisão da Proposta 1 acima (resolvido por esta mesma rodada: o
   caminho reconciliado é `design-system-v1-proposal.md` promovido).
2. O eixo 11 (Design System / consistência, peso 3%) é bem mais leve do que faria sentido se
   `design-system-v1-proposal.md` for adotado com o catálogo de ~30 componentes — mas isso é
   calibração de peso, não motivo de rejeição; pode ser recalibrado numa revisão futura sem reabrir
   o protocolo inteiro (a própria regra de manutenção do documento, §109, permite isso).
3. `docs/engineering/joint-review-criteria.md` já define pesos por eixo em nível de projeto para o
   protocolo Claude↔Codex geral — a nova rubrica de 12 eixos é *específica de frontend*, não
   substitui aquele documento; a relação de precedência deveria ser nomeada explicitamente no
   próprio `joint-review-criteria.md` ou em `docs/engineering/README.md`.

### Recomendação

**ADOTAR como documento normativo** em
`docs/frontend/frontend-engineering-quality-standard.md` (renomear de `-v1-proposal`, `status:
PROPOSED`→`APPROVED`), e **SUPERSEDER explicitamente**
`bff-frontend-quality-standard-proposal.md` (marcar `SUPERSEDED`, mover referência em
`docs/frontend/README.md` da posição atual "documento distinto e mais amplo, ainda não adotado"
para "histórico, superseded por `frontend-engineering-quality-standard.md`") — sem perda de
conteúdo real, porque a parte não coberta (argumento a favor de Full BFF) já é fato implementado
em outro documento `APPROVED`.

**COEXISTE, não substitui,** com `interface-quality-standard.md` — os dois são avaliados em
paralelo (`FrontendOverall >= 9.0 AND InterfaceOverall >= 9.0` quando aplicável, exatamente como o
próprio documento já propõe em §30/§104). Nenhuma mudança necessária em
`interface-quality-standard.md`.

## Residual de produto decidido nesta rodada (autoridade ampliada)

1. Caminho de arquivo final: `design-system-v1-proposal.md` → `docs/frontend/design-system.md`;
   `frontend-engineering-quality-standard-v1-proposal.md` →
   `docs/frontend/frontend-engineering-quality-standard.md`. Sufixo `-proposal` removido só após
   convergência ≥9.0/9.0.
2. `visual-language-and-design-system.md` não é renomeado nem movido — continua no lugar como
   registro de protocolo, com uma nota adicionada apontando para o novo `design-system.md` como
   fonte prospectiva de tokens/componentes.
3. `bff-frontend-quality-standard-proposal.md` recebe frontmatter `status: SUPERSEDED` e uma nota
   de uma linha apontando para o documento novo — arquivo não é deletado (é evidência histórica,
   mesmo tratamento dado a `docs/architecture/history/`).
4. Nenhuma implementação de código nesta rodada — reconciliação token-a-token e catálogo de
   componentes faltante são nomeados como wave futura (**Wave 1b — Design System Implementation
   Gap**, a decidir prioridade/timing numa sessão futura, fora do escopo desta reconciliação de
   documentação).

## Nota final

Nenhum dos dois proposals foi rejeitado — ambos são consistentes com o que já está `APPROVED`,
preenchem um gap real (contrato de tokens/componentes formal; rubrica de engenharia de frontend
formal com gates), e nenhum reabre um `VL-G` gate ou um eixo já fechado de
`interface-quality-standard.md`. O trabalho desta rodada é majoritariamente de **reconciliação de
precedência entre documentos**, não de mérito técnico de conteúdo (os proposals são, no geral, de
boa qualidade e bem alinhados ao que o produto já faz).
