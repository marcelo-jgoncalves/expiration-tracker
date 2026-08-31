# Wave 1 — Design System Reconciliation: Rodada 3 (fechamento Claude)

## Nota cega da Rodada 2

- **Claude (auto-avaliação): 8.6/10.** A correção de rumo (adoção seletiva, não "como-está") estava
  certa em espírito, mas a tabela de reconciliação (6 linhas) e o mapa de supersede (2 blocos de
  seção) eram amostras, não o levantamento exaustivo que uma emenda normativa real precisa ser.
- **Codex: 7,7/10 — CHANGES REQUESTED.** 4 achados: (1) reconciliação de tokens incompleta —
  cores semânticas, cor/largura de foco, sombra, motion, altura de botão default, mapeamento
  nome↔valor de spacing, e a escala tipográfica completa também divergem; (2) "arquitetura/catálogo
  adotados como-está" é amplo demais — entradas concretas do catálogo (Button 44px, Card
  `radius.lg`, foco, hover/pressed) carregam valores já rejeitados, só referências simbólicas
  (`radius.lg` como nome) sobrevivem ao remapeamento; (3) matriz de ownership cobre só 4
  sobreposições, faltam Functional Correctness/Error-Recovery/Epistemic-Integrity/UX-Performance/
  Testing/Security-Privacy, e falta regra de "um dono de pontuação por achado"; (4) mapa de
  supersede do BFF proposal cobre só §4-11/§13-23, faltam §12 e §24-37.

Aceito integralmente. Fechamento abaixo — exaustivo, não amostral.

## 1. Reconciliação de tokens — exaustiva

Regra geral mantida da Rodada 2: **valor primitivo concreto já implementado e testado vence;
estrutura/nomenclatura/regra de processo do proposal 1 vence onde não há conflito**. Tabela
completa (baseada nos achados de Codex, que verificou `tokens.css` diretamente):

| Categoria | Proposal 1 | Implementado (`tokens.css`) | Vence | Nota |
|---|---|---|---|---|
| Accent/brand | `purple.600 #7C3AED` | `#2F4FD0` | Implementado | Rodada 1 |
| Fonte | Plus Jakarta Sans | System UI stack | Implementado | Rodada 1 |
| H1/Page title | 32/40 | 22px | Implementado | Rodada 1 |
| H2/Section | 24/32 | 18px | Implementado | Rodada 1 |
| Display/outras escalas nomeadas | 36/44 etc. | escala primitiva 12–28px | Implementado | Achado Codex R2 — escala inteira, não só H1/H2 |
| Radius | sm8/md12/lg16/xl20 | 4/6/8px | Implementado | Rodada 1 |
| Foco (cor) | `#6D28D9` | `#2F4FD0` | Implementado | Achado Codex R2 |
| Foco (largura) | 2px | 2px | Empate — mantém | Achado Codex R2 |
| Cores semânticas (success/warning/danger/info) | valores próprios do proposal | valores próprios de `tokens.css` | Implementado | Achado Codex R2 — nenhum valor específico do proposal sobrevive |
| Shadow.md alpha | `.08` | `.12`, RGB base diferente | Implementado | Achado Codex R2 |
| Motion | 120/180/240ms | 120/160ms, sem 240ms | Implementado (proposal define token extra `slow` sem equivalente hoje — vira gap nomeado, não conflito) | Achado Codex R2 |
| Botão altura default | 44px | `--control-height-md: 36px` (44px só existe como `lg`) | Implementado — proposal 1's "default" vira o nome `lg` no sistema real | Achado Codex R2 |
| Spacing (valores) | 4/8/12/16/20/24/32/40/48/64 | inclui `0/2/4/8...` | Compatível em valor, **não em nome de token** — remapear nome, não substituir escala | Achado Codex R2 |

**Conclusão da reconciliação de tokens**: nenhum valor primitivo concreto do proposal 1 sobrevive
intacto — todos os que existem hoje em `tokens.css` vencem. O proposal 1 continua com valor real
como **estrutura + os primitivos que ainda não existem** (motion `slow`/z-index/breakpoints
nomeados/i18n-readiness/dark-mode-readiness) e como **catálogo de componentes/patterns ainda não
implementados**, onde não há nada implementado para contradizer.

## 2. Correção ao "arquitetura adotada como-está"

Codex está certo: a distinção não é "seção de valores primitivos vs. resto do documento", é
**valor concreto vs. referência simbólica**, e atravessa o documento inteiro. Regra corrigida:

> Qualquer trecho do proposal 1 que cite um **valor concreto** (hex, px, ms, nome de fonte) que
> tenha equivalente já implementado em `tokens.css` é substituído pelo valor implementado. Qualquer
> trecho que cite um **nome de token simbólico** (`radius.lg`, `action.primary.background`,
> `space.4`) permanece válido — o valor por trás do nome é resolvido pela tabela acima ou pelo
> `tokens.css` real, não pelo número escrito no proposal.

Isso resolve o exemplo de Codex: "Card usa `radius: lg`" (§40 do proposal 1) permanece válido como
regra ("Card usa o token de radius grande do sistema"), mas o valor de `radius.lg` passa a ser 8px
(implementado), não 16px (proposal). "Button height: 44px" (§30) deixa de ser lido como "o botão
default deve medir 44px" e passa a ser lido como "o token de altura grande (`lg`) do sistema mede
44px; o botão default usa o token `md` (36px)" — sem alterar a regra estrutural de o Button
consumir um token de altura, só qual token é o default.

**Camadas**: o proposal 1 prescreve 3 camadas nomeadas (primitive→semantic→component). O
implementado hoje é deliberadamente 2 camadas (primitivo→alias semântico, confirmado por
`VL-G8`) mais tokens de componente **só quando justificado** (não uma terceira camada obrigatória
em todo componente). Reconciliação: a terceira camada (component tokens) não é retroativamente
exigida para os ~9 primitivos já implementados — é a convenção para componentes **novos**
construídos depois desta adoção. Não é uma migração do que já existe.

## 2. Emenda formal ao arquivo antes de promoção

`design-system-v1-proposal.md` recebe, no topo, uma seção nova `## 0. Reconciliação de valores
(2026-08-31, D-130)` contendo a tabela da seção 1 acima e a regra "valor concreto vs. referência
simbólica" da seção 2, com um aviso: *"Onde este documento cita um valor numérico que conflita com
`frontend/src/styles/tokens.css`, o valor implementado vence. Este documento é normativo para
arquitetura, regras de processo, catálogo de componentes e patterns — não para os valores
primitivos específicos já decididos em `visual-language-and-design-system.md`."* Só depois disso o
arquivo é renomeado/promovido.

## 3. Crosswalk exaustivo de eixos (ownership de pontuação)

Cada achado de review pertence a exatamente **um** eixo-dono; o outro documento pode citá-lo como
evidência/gate-dependency, nunca pontuá-lo de novo:

| Achado / preocupação | Dono da pontuação | Outro documento trata como |
|---|---|---|
| Tarefa serve o domínio real (JTBD) | Interface Standard — Task Suitability | N/A para Frontend Engineering |
| Contrato de API/payload/OCC/idempotência correto | Frontend Engineering — Functional Correctness | Interface Standard cita como pré-condição de Data Operations, não repontua |
| Usuário entende o que está acontecendo (loading/error/unknown) | Interface Standard — System Feedback | Frontend Engineering — Reliability pontua só se o *mecanismo* (TanStack Query state machine) está certo, não se a mensagem é clara |
| Epistemic Integrity (não afirmar mais do que o sistema sabe) | Interface Standard — Data Operations/Content/Trust-Risk (é onde já vive, `interface-quality-standard.md` §6) | Frontend Engineering cita como gate `FE-G4`, nunca repontua o princípio |
| Erro recuperável, forms preservados | Interface Standard — Error Prevention/Recovery | Frontend Engineering pontua só a implementação técnica (não perde dado por race de query) em Reliability |
| Segurança/BFF/sessão/CSRF/cross-tenant | Frontend Engineering — Security (gate FE-G2) | Interface Standard — Trust/Risk cita como pré-condição de confiança percebida, não repontua o mecanismo |
| Performance (Core Web Vitals, bundle) | Frontend Engineering — Performance | Interface Standard não tem eixo equivalente — N/A |
| Acessibilidade — jornada navegável, decisão de produto | Interface Standard — Accessibility | Frontend Engineering — Accessibility pontua só a prova técnica automatizada/testada (axe, cobertura de foco no CI) |
| Acessibilidade — implementação técnica (semântica HTML, ARIA correto) | Frontend Engineering — Accessibility | Interface Standard cita como evidência de que a jornada é navegável |
| Consistência de convenção de interação (mesmo padrão em toda superfície equivalente) | Interface Standard — Consistency | Frontend Engineering — Design System pontua só conformidade de token/implementação, não convenção de interação |
| Conformidade de token/hardcoded value | Frontend Engineering — Design System | Interface Standard não pontua isso |
| Testes automatizados existem e provam o comportamento certo | Frontend Engineering — Testing | Interface Standard cita como evidência, nunca pontua "quantidade de teste" |
| Responsividade estrutural (nada escondido, tarefa possível em mobile) | Interface Standard — Responsiveness | Frontend Engineering — Responsividade/compatibilidade pontua só cobertura de matriz de viewport testada |
| Privacidade/minimização de dado exposto | Frontend Engineering — Privacy (gate FE-G5) | Interface Standard não tem eixo equivalente — N/A |
| Observabilidade/correlação de erro | Frontend Engineering — Observability | Interface Standard não tem eixo equivalente — N/A |
| Conteúdo/microcopy/jargão | Interface Standard — Content | Frontend Engineering não pontua isso |

Regra formal: **um finding, um dono**. Quando um finding é citado nos dois documentos (ex.: "cache
cross-tenant exibido" aparece como gate em ambos), ele é **um único achado real** com **um
registro de evidência único**, referenciado por ambos os relatórios de avaliação — nunca dois
achados separados nem duas notas rebaixadas pelo mesmo defeito. Isto fecha a lacuna de
double-counting que a Rodada 2 deixou parcialmente aberta.

## 4. Mapa de supersede completo (`bff-frontend-quality-standard-proposal.md`, §1-37)

| Seção | Conteúdo | Destino |
|---|---|---|
| §1 Objetivo | Escopo geral | Superseded — escopo equivalente no frontmatter do doc novo |
| §2-2.1 Estado do repo (histórico) | Levantamento do frontend em 2026-08-2x | Histórico — preservado só como evidência de contexto, sem valor normativo (o estado real mudou) |
| §3 Questão arquitetural do BFF | Análise que motivou Full BFF | Fato consumado — `frontend-production-foundation.md` (D-053/D-054) |
| §4-11 Recomendação/arquitetura/cookies/CSRF/proxy | Ver Rodada 2 | Fato consumado — implementação real + achados de segurança da Rodada D daquele protocolo |
| §12 Referenciais externos | Lista de fontes (OWASP, etc.) | Superseded — `frontend-engineering-quality-standard-v1-proposal.md` §106 tem lista equivalente/mais atual (ASVS 5.0.0, WCAG 2.2, Core Web Vitals) |
| §13-23 Rubrica v0/testes | Ver Rodada 2 | Superseded pela rubrica de 12 eixos |
| §24 Fluxos E2E obrigatórios | Lista de fluxos críticos | Superseded — `frontend-engineering-quality-standard-v1-proposal.md` §47 tem lista equivalente e mais completa (inclui B2B: convite/switch/role-change, que o doc antigo não tinha porque é anterior ao Multi-User B2B) |
| §25 Gate FG5 Privacidade | Gate de privacidade | Superseded — vira eixo 9 + gate `FE-G5` no doc novo |
| §26 Observabilidade de frontend | Requisitos de observabilidade | Superseded — eixo 10 do doc novo |
| §27 Design System | Seção sobre DS | Superseded — eixo 11 do doc novo + relação formal com `design-system-v1-proposal.md` (§4.2 do doc novo), mais completa |
| §28 Responsividade/compatibilidade | — | Superseded — eixo 12 do doc novo |
| §29 Processo de avaliação por PR/feature/milestone | — | Superseded — §65-73 do doc novo cobrem o mesmo processo com mais detalhe (matriz por tipo de mudança) |
| §30 Gates eliminatórios oficiais | FG1-FG4 | Superseded — `FE-G1..FE-G5` do doc novo |
| §31 Avaliação do desenho do BFF (histórico) | 3 revisões do BFF real | Histórico — preservado como evidência de como o Full BFF real foi avaliado antes de existir `frontend-production-foundation.md` |
| §32 ADR recomendado | Recomendação de abrir ADR para Full BFF | Fato consumado — decisão já tomada e implementada, ADR real (se existir) coberto por `AGENTS.md` §5/precedência normal |
| §33 Documentos normativos recomendados | Lista de docs a criar | Fato consumado — os documentos recomendados (design system formal, quality standard formal) são exatamente os 2 proposals desta reconciliação; a recomendação foi atendida |
| §34 Baseline oficial para avaliações futuras | Baseline por eixo | Superseded — coberto pela rubrica completa do doc novo |
| §35 Exemplo de avaliação futura | Exemplo ilustrativo | Não normativo — nunca foi regra, é exemplo; sem destino necessário |
| §36 Conclusão | Resumo | N/A — texto de fechamento do próprio documento antigo |
| §37 Referências | Bibliografia | Superseded — §106 do doc novo |

**Nenhuma seção fica sem destino.** Confirma-se `SUPERSEDED` para as seções normativas (a maioria)
e `HISTÓRICO — sem valor normativo` para as poucas que só faziam sentido como registro de um
momento em que Full BFF ainda não existia (§2, §3, §31-33).

## 5. Estado final das recomendações (inalterado em decisão, completo em evidência)

1. **`design-system-v1-proposal.md`** → **ADOTAR COM EMENDA**. Emenda = seção de reconciliação de
   valores (§1-2 acima) inserida no topo do arquivo antes da promoção. Renomear para
   `docs/frontend/design-system.md` só após a emenda estar escrita no arquivo real (ação de
   implementação desta mesma sessão, é edição de documentação, não código).
2. **`frontend-engineering-quality-standard-v1-proposal.md`** → **ADOTAR**, com o crosswalk
   exaustivo de eixos (§3 acima) inserido como seção formal (resolve double-counting).
3. **`bff-frontend-quality-standard-proposal.md`** → **SUPERSEDED**, com o mapa completo §1-37
   (§4 acima) no frontmatter.
4. **`visual-language-and-design-system.md`** → inalterado, continua sendo a fonte de verdade dos
   valores primitivos reais.

## Pedido de nota final

Este fechamento resolve os 4 achados nomeados na Rodada 2 exaustivamente (tokens completos,
distinção valor-concreto-vs-símbolo aplicada ao documento inteiro, crosswalk de eixos completo com
regra de um-dono-por-achado, mapa de supersede §1-37 sem lacuna). Peço nota de fechamento.
