# Handoff — Multi-User B2B, continuar B2B-14/B2B-15 + 3 decisões de produto aprovadas

> Ler isto primeiro, depois apagar este arquivo (`rm -f --`), depois seguir o processo normal de
> início de sessão do `AGENTS.md` §2. Este arquivo é temporário — não é fonte normativa, existe só
> para transferir contexto de uma sessão para a próxima. Todo o estado real e duradouro já está em
> `NEXT_SESSION_PROMPT.md`/`docs/architecture/decisions-log.md`/`docs/architecture/
> multi-user-b2b-wave-tracker.md`, que já foram atualizados — este arquivo não duplica esse
> conteúdo, só aponta para ele e explica a ESTRATÉGIA DE TRABALHO que produziu esse estado.

## Estado ao final desta sessão

Multi-User B2B: **Waves B2B-0 a B2B-13 `DONE`**. **B2B-14 (Operational Evidence) `EM ANDAMENTO`**
— 7 achados reais severos corrigidos (D-114 a D-120), todos encontrados só por exercitar o fluxo
de verdade contra `dev` pela primeira vez. D-120 (o mais recente: convite/aceite/sair-da-
organização nunca alcançáveis de ponta a ponta + e-mail real via SES nunca ativado) mergeado
(PR #121), CD `success`. **Testado ao vivo com o cookie de sessão real do Marcelo**: save de
Settings, listagem de organizações/membros — tudo confirmado funcionando; cap de uma-organização-
por-`GlobalUser` confirmado (bloqueia teste de troca de organização até convite/aceite fecharem o
ciclo). **O roteiro manual restante (convite/aceite com 2ª conta, troca de role, switch, revogação,
exclusão de organização) foi explicitamente adiado pelo Marcelo para uma sessão futura** — não é
mais um item aguardando ação imediata.

**B2B-15 (Documentation Reconciliation) `EM ANDAMENTO`**, adiantada em paralelo (não depende de
B2B-14 fechar): `docs/architecture/README.md` (bloco de status desatualizado, corrigido através de
D-121), `docs/architecture/session-log.md` (zero entradas para toda a iniciativa Multi-User B2B —
backfilled com 2 entradas consolidadas 2026-08-29/2026-08-30), índice de `reviews/` (3 pastas novas
adicionadas), `docs/frontend/README.md`/`docs/engineering/pilot-readiness-program.md` (2 documentos
novos do Marcelo indexados, ver seção própria abaixo). **Falta**: uma passada final conferindo ADRs
vs. `decisions-log.md` e referências de caminho de arquivo, antes de marcar a wave `DONE`.

**3 decisões de produto novas (levantadas pelo Marcelo, "o que você acha disso tudo?") fecharam
design `APROVADO` via protocolo Claude↔Codex completo, nenhuma implementada ainda**:
- **D-121** — orquestrador do purge pipeline W3-07 (decisão pendente desde D-083): Step Functions
  (`tenant-purge-workflow`) + EventBridge Scheduler. 9,1/9,2.
- **D-122** — reatribuição de responsabilidade ao remover/sair de um Membership: precondição
  bloqueante *best-effort*, reaproveitando GSI1 já existente (zero índice novo). 9,1/9,1.
- **D-123** — exportação de dados (CSV) de `ExpirationItem`: nova action RBAC `item:export`,
  síncrono, capped (2.000 itens/4MB), distinção explícita do DSR formal de LGPD (ainda não
  implementado). 9,1/9,1.

Todas as 3: "sessão dedicada futura" para implementação real, mesmo padrão de D-081. Nenhuma tem
urgência declarada pelo Marcelo.

**2 documentos novos trazidos pelo Marcelo** (achados na raiz do repo no meio da sessão, movidos
por mim para `docs/frontend/` — ver `docs/frontend/README.md` para o registro completo):
`design-system-v1-proposal.md` (a atualização que a Wave 1/Design System Reconciliation esperava
desde 26/08) e `frontend-engineering-quality-standard-v1-proposal.md` (padrão de engenharia de
frontend mais amplo, frontmatter formal `status: PROPOSED`). **Nenhum dos dois foi lido em
profundidade nem submetido ao protocolo Claude↔Codex ainda** — próxima sessão decide se vale a
pena rodar a adoção formal antes de continuar outra coisa.

## A estratégia de trabalho desta sessão (o que realmente importa transferir)

Esta foi a sessão mais longa da iniciativa até agora: fechou D-114 a D-123 (10 decisões/achados),
mais 5 passadas de reconciliação de documentação. Padrões novos que funcionaram bem e devem se
repetir, além dos já formalizados em handoffs anteriores (protocolo Claude↔Codex, G-V3, 5 arquivos
de documentação por wave — não repetidos aqui):

### 1. Forks paralelos para decisões de escopo independentes — padrão novo, funcionou bem

Quando 2+ decisões de design são genuinamente independentes (não competem pelos mesmos arquivos),
dispatchar um fork por decisão, cada um rodando o protocolo Claude↔Codex completo sozinho, é mais
rápido que serializar. Usado para D-121/D-122/D-123 nesta sessão — os 3 rodaram em paralelo,
cada um levou 15-20 minutos.

**Cuidados reais que apareceram**: (a) instrua cada fork explicitamente a NÃO tocar nos arquivos
que os outros forks/o thread principal estão usando — dado no prompt de cada um; (b) como todos os
forks compartilham o mesmo working directory (nenhum usou `isolation: "worktree"`), eles escrevem
e commitam para o MESMO `develop` — instrua cada um a `git fetch`/reler o estado atual de
`decisions-log.md`/`NEXT_SESSION_PROMPT.md` imediatamente antes de commitar (nunca sobrescrever o
que outro fork já commitou); (c) cada fork deve escolher seu próprio número D-XXX verificando o
mais alto já usado — nesta sessão os 3 coordenaram corretamente sozinhos (D-121, D-122, D-123 em
sequência, sem colisão), mas vale checar o resultado no fim, não presumir.

### 2. Pesquisa externa pode estar errada mesmo "verificada" — não repetir uma alegação de sessão anterior sem reconferir

Eu mesmo, mais cedo nesta sessão, disse ao Marcelo que a regra de reatribuição que ele propôs
"bate com como Jira/Linear tratam unassign-on-deactivation" — **isso estava errado**. Quando o
fork de D-122 pesquisou de verdade (fetch direto, não só busca), Jira/GitHub/Linear convergem em
**NÃO bloquear** essa operação — só Jira bloqueia exclusão real de conta (operação mais destrutiva,
sem análogo aqui). A decisão final divergiu dessa convergência de propósito (motivo de domínio:
rastreamento de prazo de compliance), registrado explicitamente como divergência consciente. Lição:
uma alegação de pesquisa feita informalmente numa resposta a uma pergunta do Marcelo não é a mesma
coisa que uma alegação verificada pelo protocolo — sempre reconferir com fetch direto quando a
alegação vira parte de uma decisão real, mesmo que "pareça óbvia".

### 3. Testar contra `dev` real usando o cookie de sessão do usuário — capacidade nova, usar de novo se fizer sentido

Marcelo repassou `__Host-et_session`/`__Host-et_csrf` (nomes exatos, `src/modules/bff/domain/
cookies.ts`) da própria sessão dele no browser. Isso permite chamadas autenticadas reais via
`curl` sem precisar dele clicar em nada — usado para confirmar `GET /bff/session`, `GET
/bff/organizations`, `GET /bff/api/organizations/members` (achado o vazamento corrigido em
D-120) e `POST /bff/organizations` (confirmou o cap de uma-organização-por-usuário). **Detalhes
técnicos que custaram tentativa e erro**: toda chamada mutating precisa do header `Sec-Fetch-Site:
same-origin` (`curl` não manda isso por padrão, `checkCsrf()` rejeita sem ele) além do cookie CSRF
replicado como header `x-csrf-token`. Rotas `/bff/organizations`/`/bff/session` são diretas
(BFF-owned); qualquer outra rota de recurso passa por `/bff/api/<path>` (o proxy catch-all).

**Limite real, não contornável só com cookie**: para testar o convite/aceite de ponta a ponta é
preciso uma SEGUNDA identidade Cognito com e-mail verificável de verdade (a checagem anti-
account-takeover exige `callerVerifiedEmail` batendo com o convite) — nenhuma ferramenta deste
ambiente lê e-mail. Marcelo propôs (ainda não configurado, registrado como ideia para "em breve",
não urgente) usar uma caixa de teste descartável tipo Mailinator com API pública simples, em vez de
Gmail OAuth pessoal (que foi considerado e rejeitado — acesso amplo demais pra essa necessidade
pontual).

### 4. SES sandbox exige verificar remetente E destinatário, não só um dos dois

Achado real ao ativar e-mail de convite (D-120): a conta SES de `dev` tinha ZERO identity
verificada — nem sequer `ses_from_address` (placeholder `noreply@example.com` desde M4, nunca
trocado). Em modo sandbox, SES só entrega para endereço VERIFICADO — então tanto o remetente
quanto qualquer destinatário de teste precisam de verificação individual (`aws sesv2
create-email-identity --email-identity <endereço> --profile claude-dev`, o link de confirmação
chega por e-mail, sem código pra copiar/colar, só clicar). Isso bloqueava não só convite, mas
qualquer fluxo dependente de SES real neste ambiente (`EmailDeliveryWorker`,
`DocumentChasingDispatch`) — corrigido de uma vez ao trocar `ses_from_address` pro endereço real
verificado.

### 5. CI/CD — uma lição nova sobre esperar o run certo

Ao filtrar `gh run list --workflow "Deploy (CD)"` por `headSha` logo após um merge, o run pode
ainda não existir na lista (CD dispara só depois do CI do próprio `main` terminar, com atraso real
de alguns minutos). Um script de espera com quoting bash aninhado errado pode silenciosamente
"encontrar" um `run_id` vazio e sair sem erro real — aconteceu 2 vezes nesta sessão. Prefira
escrever o loop de espera como um arquivo `.py` de verdade (não heredoc bash aninhado com aspas
escapadas) quando precisar filtrar JSON por campo antes de `gh run watch`.

## Prompt curto para começar a próxima sessão

Está em `expiration-tracker-multi-user-b2b-first-prompt-2026-08-30-b2b14.md`, mesma pasta (raiz do
repo) — copiar o conteúdo dele literalmente como primeira mensagem da próxima sessão. Ele já instrui
a apagar os dois arquivos (este e ele mesmo) depois de lidos.
