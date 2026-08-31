Leia este arquivo inteiro, depois apague-o (`rm -f --`). É temporário — não é fonte
normativa, só transfere contexto entre sessões. Estado real e duradouro já está em
`NEXT_SESSION_PROMPT.md`/`docs/architecture/decisions-log.md`/
`docs/architecture/multi-user-b2b-wave-tracker.md`.

Confirme `git branch --show-current` (deve ser `develop`) e rode `git pull` antes de
seguir — múltiplas máquinas/sessões trabalham neste repo.

**Limpeza pendente, faça primeiro**: ainda existem na raiz do repo os arquivos
`expiration-tracker-multi-user-b2b-first-prompt-2026-08-30-b2b14.md` e
`expiration-tracker-multi-user-b2b-handoff-2026-08-30-b2b14.md` — já foram lidos e
avaliados numa sessão anterior (conteúdo já refletido em `NEXT_SESSION_PROMPT.md`),
não precisam ser relidos, só apagados (`rm -f --` nos dois) junto com este arquivo.

Depois da limpeza, siga o processo normal de início de sessão (`AGENTS.md` §2) e leia
`NEXT_SESSION_PROMPT.md` inteiro — ele já está atualizado e é a fonte real do estado
atual e da "Próxima ação, em ordem de valor esperado". Resumo rápido do que essa lista
diz agora, para orientar, sem substituir a leitura:

- Multi-User B2B: Waves B2B-0 a B2B-13 `DONE`. B2B-14 (evidência operacional) em
  andamento, só falta o roteiro manual de convite/aceite com 2ª conta — **adiado pelo
  Marcelo para uma sessão futura, não é para agora, não pergunte de novo**. B2B-15
  (reconciliação de documentação) em andamento, pode continuar autonomamente.
- W3-07 (fence de exclusão de tenant): fence de admissão `DONE`, purge pipeline
  `DONE` (Codex 9,1/10). Falta só o orquestrador real (Step Functions + EventBridge
  Scheduler) — design já **aprovado** via protocolo Claude↔Codex (D-121, 9,1/9,2),
  implementação ainda não construída.
- 3 mecanismos com design já **aprovado**, zero implementação: orquestrador do purge
  W3-07 (D-121), reatribuição de responsabilidade ao remover membro (D-122),
  exportação de dados CSV (D-123). Nenhum tem urgência declarada — implemente pelo seu
  julgamento de valor esperado, ou aguarde sinal de prioridade.
- 2 propostas normativas (`design-system-v1-proposal.md`,
  `frontend-engineering-quality-standard-v1-proposal.md`, em `docs/frontend/`) ainda
  não foram lidas em profundidade nem submetidas ao protocolo Claude↔Codex.

Continue de forma autônoma, seguindo a mesma estratégia de sempre: ler o código real
antes de propor, protocolo Claude↔Codex completo (mínimo 3 rodadas, nota cega, ambos
≥9,0 sem arredondar) para qualquer decisão Type 1, G-V3 com mutação verificada de
verdade, suíte completa antes de considerar uma mudança verificada, documentação nos
mesmos lugares de sempre, commit/push/PR/CI/merge/CD sem esperar confirmação prévia
minha — exceto qualquer comando destrutivo real contra a conta AWS (`aws --profile
claude-dev`), que exige minha confirmação explícita antes de executar (não antes de
planejar/documentar).

Não pare para perguntar sobre o resto — registre qualquer decisão genuinamente
exclusiva minha como pendente e siga para a próxima frente independente, em vez de
travar a sessão.
