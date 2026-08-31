Leia o arquivo `expiration-tracker-multi-user-b2b-handoff-2026-08-30-b2b14.md` na raiz do repo
inteiro. Depois de ler e ter a próxima ação clara, apague-o e apague também este arquivo de prompt
(`rm -f --` nos dois). D-120 (PR #121) já está confirmada mergeada em `main` com CD `success`
(convite/aceite/sair-da-organização ativos em `dev`, e-mail real via SES ligado) — confirme
`git branch --show-current` (deve ser `develop`) e rode `git pull` antes de seguir (múltiplas
máquinas trabalham neste repo).

Continue trabalhando de forma autônoma, seguindo exatamente a mesma estratégia de trabalho
descrita no handoff: ler o código real antes de propor, protocolo Claude↔Codex completo (mínimo
3 rodadas, nota cega, ambos ≥9,0 sem arredondar) para qualquer decisão Type 1, G-V3 com mutação
verificada de verdade, suíte completa dos dois lados (backend E frontend, se aplicável) antes de
considerar uma mudança verificada, documentação nos mesmos 5 lugares de sempre, commit/push/PR/
CI/merge/CD sem esperar confirmação prévia minha.

**Wave B2B-14 permanece formalmente aberta só pelo roteiro manual de convite/aceite com uma
segunda conta** (trocar role, trocar de organização, revogar membership, excluir organização) —
**eu já disse explicitamente que isso fica para uma sessão futura, não é para esta.** Não pergunte
sobre isso de novo nem trate como bloqueante; se eu trouxer o assunto, o passo a passo já está em
`decisions-log.md` D-120.

**Continue a Wave B2B-15 (Documentation Reconciliation)** até fechar de verdade o checklist de
`AGENTS.md` §6 — já avançou bastante (ver handoff para o que já foi feito).

**Três decisões de produto novas já têm design `APROVADO` via protocolo Claude↔Codex** (orquestrador
de purga W3-07 = D-121, reatribuição de responsabilidade ao remover membro = D-122, exportação de
dados CSV = D-123) — nenhuma foi implementada ainda. Nenhuma tem urgência declarada por mim; pode
implementar qualquer uma se fizer sentido no seu julgamento de valor esperado, ou aguardar eu
priorizar. Se implementar, siga o mesmo rigor de sempre (o protocolo já rodou para o design, não
precisa rodar de novo — só a implementação real, com testes completos).

**Trouxe 2 documentos novos** (já movidos por você mesmo para `docs/frontend/` nesta sessão —
`design-system-v1-proposal.md` e `frontend-engineering-quality-standard-v1-proposal.md`): são
propostas normativas reais, ainda **não lidas em profundidade nem adotadas**. A primeira é
exatamente a atualização que a Wave 1 (Design System Reconciliation,
`docs/engineering/pilot-readiness-program.md`) esperava para deixar de estar `DEFERRED` — decida
se vale a pena rodar o protocolo Claude↔Codex para adotá-las antes de continuar B2B-15/as 3
implementações acima, ou se prefere aguardar meu sinal de prioridade. Não presuma que já foram
adotadas só porque existem no repo.

Uma exceção real, não uma formalidade: se qualquer wave concluir que a política certa é resetar os
dados de `dev`, pode decidir e documentar isso sozinho — mas PARE e me pergunte antes de executar de
verdade qualquer comando que apague dados na conta AWS real (`aws --profile claude-dev`), mesmo
sendo só dado sintético. Registre o pendente e siga para outra frente independente enquanto espera,
em vez de travar a sessão.

Não pare para perguntar sobre o resto — prossiga de forma autônoma, registrando qualquer decisão
genuinamente exclusiva minha em vez de bloquear.
