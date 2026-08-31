# Wave 1 — Design System Reconciliation: Rodada 4 (fechamento final)

## Nota cega da Rodada 3

- **Claude (auto-avaliação): 9.0.**
- **Codex: 8,6/10 — CHANGES REQUESTED**, 3 gaps precisos, nenhum gap novo de escopo. Corrigidos
  abaixo, um a um, sem reabrir nada já fechado nas Rodadas 1-3.

## Gap 1 — regra de papel semântico, não só de valor numérico

Correto: `44px` do proposal 1 não conflita numericamente com `--control-height-lg: 44px`
implementado, então a regra "valor concreto vs. símbolo" da Rodada 3 não deriva sozinha que o
**default** deveria ser `md`/36px. Regra adicionada, explícita:

> Onde o sistema implementado atribui um **papel semântico/default** diferente do que o proposal 1
> assume implicitamente, o papel implementado vence, mesmo que o valor numérico citado pelo
> proposal exista em algum token do sistema real. Especificamente: o Button **default** do sistema
> real é o papel `md` (36px); `44px` (`lg`) existe e é válido, mas não é o tamanho assumido por
> padrão quando o proposal diz apenas "Button height: 44px" sem qualificar variante.

Isso fecha a lacuna sem reabrir nenhum valor da tabela da Rodada 3 — é uma regra adicional, não uma
mudança de valor.

## Gap 2 — Forms como overlap real de eixo

Aceito: Forms não deveria ficar implicitamente absorvido em "Error Prevention/Recovery". Linha
adicionada ao crosswalk da Rodada 3:

| Achado / preocupação | Dono da pontuação | Outro documento trata como |
|---|---|---|
| Forms como interação (label real, validação clara ao usuário, dado preservado em erro, associação programática erro↔campo) | Interface Standard — Forms (eixo 6) | Frontend Engineering §85 cita como pré-condição UX, não repontua |
| Forms como mecanismo técnico (schema/contrato consistente, client validation nunca substitui server, submit guard/double-submit, idempotency propagation) | Frontend Engineering — Reliability (Functional Correctness quando envolve payload/contrato) | Interface Standard cita como evidência de que a recuperação funciona, não repontua o mecanismo |

Mesma disciplina "um achado, um dono" da Rodada 3 — Forms não é um eixo novo em nenhum dos dois
documentos, é a mesma preocupação (UX de formulário vs. engenharia de formulário) que já tinha
padrão análogo na linha de Acessibilidade do crosswalk.

## Gap 3 — §12/§37 do BFF proposal: reclassificação, não supersede

Aceito: `frontend-engineering-quality-standard-v1-proposal.md` §106 não é uma bibliografia
equivalente — falta IETF OAuth 2.0 for Browser-Based Applications, heurísticas de Nielsen,
documentação CloudFront, e orientação de BFF via Next.js que §12/§37 do documento antigo citavam.
Correção ao mapa de supersede da Rodada 3, linhas §12 e §37:

| Seção | Conteúdo | Destino corrigido |
|---|---|---|
| §12 Referenciais externos | OWASP, IETF OAuth BBA, Nielsen, CloudFront, Next.js BFF | **Reclassificado de Superseded para HISTÓRICO/SUPORTE — mapeado individualmente**: OWASP/WCAG/Core-Web-Vitals cobertos por §106 do doc novo (esses sim equivalentes). IETF OAuth 2.0 for Browser-Based Applications — não citado no doc novo, mas seu conteúdo já informa decisões reais registradas em `frontend-production-foundation.md` (cookies HttpOnly/Secure/SameSite, ausência de token no browser) — permanece como referência de proveniência, não descartada. Heurísticas de Nielsen — já vivem como fonte formal em `interface-heuristic-accessibility-evaluation.md` (H1-H10), documento diferente, não este. CloudFront/Next.js BFF — específico da análise de opção de stack (§6 do doc antigo, já "fato consumado" porque Full BFF real não usa Next.js) — histórico puro, sem sucessor porque a pergunta que respondiam não está mais em aberto. |
| §37 Referências | Bibliografia completa da análise | Mesma lógica linha a linha de §12 — nenhuma referência é "descartada"; cada uma é ou (a) coberta por §106 do doc novo, (b) já informa uma decisão `APPROVED` registrada em outro documento, (c) histórica porque a pergunta que respondia (qual stack usar para o BFF) já foi decidida e não precisa de fonte normativa contínua. |

Frontmatter do `bff-frontend-quality-standard-proposal.md` atualizado para refletir: `status:
SUPERSEDED (conteúdo normativo) — ver mapa completo §1-37 nesta nota; referências externas de §12/
§37 preservadas como proveniência histórica, não descartadas`.

## Estado final (inalterado desde a Rodada 3, evidência agora completa)

1. `design-system-v1-proposal.md` → **ADOTAR COM EMENDA** (arquitetura/catálogo/patterns
   integralmente; valores primitivos concretos e papéis semânticos de default substituídos pelos
   já implementados, ambas as regras — valor concreto vs. símbolo, e papel semântico vs. valor
   numérico — registradas na emenda).
2. `frontend-engineering-quality-standard-v1-proposal.md` → **ADOTAR**, com o crosswalk de eixos
   completo (Rodada 3 + Forms desta rodada) como seção formal.
3. `bff-frontend-quality-standard-proposal.md` → **SUPERSEDED** para todo conteúdo normativo,
   com §12/§37 corrigidos para preservar proveniência de referência em vez de declarar
   equivalência que não existe.
4. `visual-language-and-design-system.md` → inalterado.

## Pedido de nota de fechamento

Os 3 gaps da Rodada 3 foram corrigidos pontualmente, sem introduzir escopo novo. Peço nota final.
