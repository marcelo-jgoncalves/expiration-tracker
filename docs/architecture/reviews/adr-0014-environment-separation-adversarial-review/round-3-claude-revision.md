# ADR-0014 — Rodada 3 (polimento textual final, nota Codex 9,1/10 na Rodada 2)

A Rodada 2 já atingiu o gate de 9,0 (Codex 9,1), mas o protocolo exige mínimo 3 rodadas mesmo
quando o gate é atingido cedo. O único achado restante era o item 6 (consolidação textual) — sem
bloqueador arquitetural novo, "resíduos documentais" nas palavras do próprio Codex. Todos aplicados:

1. **Cabeçalho e "Pendência explícita"**: não apresentam mais o protocolo como suspenso — refletem
   que está em andamento (D-331), apontando para as rodadas reais.
2. **Fase 2**: `CD(apply em main)` corrigido para `CD(apply em dev, via develop, D-306)`.
3. **Cabeçalho**: removida a referência solta a "3 parâmetros de produto"/"nível do default"/seção
   de escopo sem pertinência.
4. **Opção 1**: não é mais descrita como a "única" que atende isolamento/uso do Terraform —
   reconhece que Control Tower (opção 5) também atenderia, rejeitado por desproporção ao estágio,
   não por incapacidade técnica.
5. **"Options Considered"**: marcado explicitamente como registro histórico ("Estado em
   2026-09-20"), nunca reescrito para parecer retrospectivamente onisciente.
6. **Fase 4**: reformulada para dizer diretamente que o gatilho abre uma REAVALIAÇÃO, nunca
   autoriza criação automática da conta de produção — alinhado com a Emenda 3.
7. **"main não dispara deploy nenhum"**: qualificado como "automaticamente" — `workflow_dispatch`
   manual continua disponível em `main` como fallback.
8. **Opção Control Tower**: suavizado "sem re-arquitetar nada" para reconhecer adequações reais de
   inscrição/governança na adoção futura, e citado que a AWS não define um limiar econômico
   explícito (julgamento do projeto, não uma regra oficial).

Nenhuma mudança de código nesta rodada — só consolidação textual do ADR. `npm run check-docs`
limpo após todas as edições.

**Codex confirmou 9,1/10 nesta rodada** (convergência do lado dele: 3 rodadas atingidas, ≥9,0 nas
duas últimas), apontando 3 resíduos textuais menores, "ajustes documentais não bloqueantes":
`Evidence` ainda descrevia o estado de 2026-09-20 como atual (marcado agora como registro
histórico); a Emenda 1/D-306 ainda dizia `main` fica "sem gatilho de deploy" (qualificado para
"sem gatilho AUTOMÁTICO" — `workflow_dispatch` manual continua disponível); contradição entre
"2-3 contas no total" e "3-4 contas" no mesmo parágrafo da opção Control Tower (corrigido para
"2-3 contas de carga de trabalho, 3-4 no total incluindo management"). Todos os 3 corrigidos nesta
mesma rodada, sem exigir uma 4ª rodada formal (mesmo padrão de D-321/D-329: polimento pós-gate).

## Auto-nota cega (Claude), Rodada 3

Ver `round-3-claude-selfgrade.md` (arquivo separado).
