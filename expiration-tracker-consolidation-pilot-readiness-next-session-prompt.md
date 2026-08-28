# Expiration Tracker — Prompt para Próxima Sessão: Consolidation + Pilot Readiness (continuação)

> **Uso:** iniciar em uma nova sessão de engenharia, em continuação direta ao trabalho desta sessão.
>
> **Repositório:** `https://github.com/marcelo-jgoncalves/expiration-tracker`
>
> **Branch base:** `develop`
>
> **Data-base desta consolidação:** 2026-08-28
>
> **Observação crítica:** o estado do repositório muda rapidamente entre sessões (múltiplas máquinas trabalham nele). Este arquivo define prioridades e uma sequência lógica, mas **não presuma nada como pendente ou concluído sem confirmar contra o estado real** (`git status`, `git log`, testes rodando de verdade, leitura do código quando um doc afirma algo consequente).

---

## 0. Como trabalhar nesta sessão (leia antes de tudo)

1. **Atualize seu contexto primeiro, sempre:**
   - `AGENTS.md` (raiz) — processo de trabalho, convenções, protocolo Claude↔Codex, regras de shell do ambiente.
   - `NEXT_SESSION_PROMPT.md` (raiz) — estado atual + próxima ação, pode estar à frente deste arquivo.
   - `docs/architecture/README.md` — mapa de fontes de arquitetura, regra de precedência.
   - `docs/engineering/pilot-readiness-program.md` e `docs/engineering/pilot-readiness-assessment.md` — o programa que originou esta lista de trabalho (Waves 0-6), com status por item.
   - `docs/architecture/decisions-log.md` — decisões formais mais recentes (D-0xx).
   - `git status` / `git branch --show-current` / `git log -10 --oneline` em `develop` — nunca presumir a partir de resumo de sessão anterior.
   - Se algo neste prompt divergir do estado real do código/docs, **o estado real vence** — registre a discrepância e siga em frente, não trave esperando esclarecimento que você mesmo pode verificar.

2. **Trabalhe com o máximo de autonomia possível, dentro dos limites já estabelecidos pelo projeto:**
   - Commits, testes, refactors locais reversíveis, implementação direta de decisão já aprovada (níveis de risco 1-4 de `docs/engineering/change-risk-scale.md`) — **não pedir confirmação a cada passo**.
   - Decisões de arquitetura Type 1 (difícil de reverter, nível 5-6) — aplicar o protocolo Claude↔Codex completo (`AGENTS.md` §4) autonomamente, sem esperar aprovação intermediária, **exceto** quando o próprio protocolo exigir uma decisão de produto que só o Marcelo pode tomar (ver §2 abaixo — várias já foram tomadas nesta sessão, outras ainda não).
   - PR `develop→main` é ação visível/compartilhada — pode abrir o PR e mesclar sozinho quando CI estiver verde, **exceto** se `AGENTS.md` §3 ou uma instrução mais recente disser o contrário. Confirme a redação atual de `AGENTS.md` §3 antes de presumir — pode ter mudado.
   - Nunca reabrir User Validation sem sinal explícito do Marcelo (continua suspensa).

3. **Sempre trabalhe dentro da pasta do projeto** (`C:\Users\Usuario\Desktop\projects\expiration-tracker`). Nunca opere em outro diretório nem presuma que o diretório de trabalho persiste entre chamadas — reafirme o `cd` sempre que houver uma lacuna (após esperar notificação, após comando longo, no início de cada retomada).

4. **Nunca encadeie comandos com `&&` (nem passos triviais como `cd` + outro comando).** Cada ação é uma chamada de shell separada. Encadear dispara prompt de aprovação que interrompe o fluxo de trabalho autônomo — isso já é regra documentada em `AGENTS.md` §3, reforçando aqui porque é a causa mais comum de interrupção desnecessária de fluxo.

5. **Regras de invocação do Codex** (protocolo Claude↔Codex): nunca usar crases dentro de um prompt passado por Bash com aspas duplas; para prompts com crases/markdown, escrever em arquivo e usar `codex exec --skip-git-repo-check - < arquivo.txt` em primeiro plano (nunca combinar `- < arquivo.txt` com backgrounding). Detalhe completo em `AGENTS.md` §4.

---

## 1. To-do list consolidado

Ordem = sequência lógica de dependências, não apenas prioridade. Itens marcados `[BLOQUEADO]` não devem ser iniciados sem o gatilho indicado.

### Já em andamento ou concluído nesta sessão anterior (confirmar estado antes de continuar)

- [x] Corrigir drift de documentação do Pilot Readiness Program (Wave 6 status, W2-02/W3-01 status, `docs/frontend/README.md` data, marcador `PENDING` em W3-09) — commit `88e5eda`.
- [~] **W2-01 — auto-confirm escreve `dueDate` automaticamente**: decisão do Marcelo tomada (escrever automaticamente, não exigir confirmação humana). Implementação **iniciada em background nesta sessão** — **confirme o resultado antes de reimplementar**: `git log` procurando o commit que menciona W2-01/auto-confirm/dueDate, rodar os testes de `test/unit/extraction/` relacionados a `decide-field-outcome`/`confirm-reject-field`/persist-extracted-fields. Se não terminou ou não foi commitado, complete-a: o campo extraído auto-`CONFIRMED` (MATCH/single-source confiante, `decide-field-outcome.ts`) deve atualizar `ExpirationItem.dueDate` na mesma transação/padrão OCC que `confirm-reject-field.ts` já usa para confirmação manual.

### Trabalho de engenharia autônomo, sem decisão pendente do Marcelo

- [ ] **W3-06 — purge real de `USER_DOCUMENT`**: decisão do Marcelo tomada (priorizar agora). Documentos de usuário (contratos, licenças) hoje nunca são fisicamente apagados apesar do campo `purgeAfter` existir — não é o atributo TTL real do DynamoDB, e não há lifecycle no bucket `clean`. Implementar usando o mesmo padrão já provado do `EXTRACTION_TRANSIENT` (worker explícito de purge + lifecycle S3 como rede de segurança). **Isto é uma decisão de arquitetura Type 1** (mecanismo de deleção real sobre dado de usuário, difícil de reverter) — aplicar o protocolo Claude↔Codex completo (`AGENTS.md` §4) antes de implementar, mesmo com a decisão de produto ("fazer agora") já tomada; o protocolo aqui é sobre o *desenho do mecanismo*, não sobre *se deve ser feito*. W3-07 (cascata de deleção real para DSR) usa o mesmo mecanismo — escopar os dois juntos é o caminho eficiente, mas não expandir further sem necessidade.
- [ ] **W5-01 — GTR-01 (identidade do requester exposta ao guest)**: decisão do Marcelo tomada (implementar agora). `GuestSubmissionService.getRequestInfo()` hoje retorna `{requirementName, deadline, allowedMediaTypes, maxUploadBytes}` sem nenhuma identidade do requester. Pequeno-médio: um campo novo em `UserProfile` (ou equivalente) + lookup + inclusão na resposta HTTP + atualização do template de e-mail relevante. Verificar se isto conta como decisão Type 1 (provavelmente não — é implementação direta de um gap já modelado, não uma decisão de arquitetura nova) antes de decidir se precisa do protocolo completo ou só de revisão normal.
- [ ] **Corrigir referência local `main` desatualizada** (achado da avaliação anterior): `git fetch origin` antes de qualquer comparação `main`/`develop` — o ref local de `main` pode ficar centenas de commits atrás sem um fetch explícito, o que já produziu uma leitura errada de "21 commits não mergeados" quando na verdade eram 0.
- [ ] **Registrar formalmente em `decisions-log.md`** as decisões tomadas nesta sessão (W2-01: escrever dueDate automaticamente; W3-06: priorizar purge real; W5-01: implementar GTR-01 agora) como entradas D-0xx novas, já que a última entrada registrada é D-057 (2026-08-25) e nada do Pilot Readiness Program está lá ainda.

### Wave 2 — drills operacionais (engenharia, mas custam recurso real em `dev` — confirmar escopo antes de rodar)

Maior débito não pago para *qualquer* escopo de pilot, mesmo o mais estreito — "zero evidência operacional real" foi o achado mais sério da avaliação. Sequência sugerida (mais barato/fundamental primeiro):

- [ ] W2-03 — prova real do kill switch de feature flag em condição de falha (base para os demais).
- [ ] W2-04 — drill do pipeline de reminder (falha real, não só teste unitário).
- [ ] W2-05 — drill de DLQ/replay.
- [ ] W2-08 — verificação real de alarmes (CloudWatch dispara e é visível).
- [ ] W2-06 — drill de restore (P2, maior, avaliar se cabe nesta rodada).
- [ ] W2-07 — teste de carga (P2, maior, avaliar se cabe nesta rodada).

Nota: estes drills injetam falha real e podem incorrer custo real de Textract/Bedrock contra `dev` compartilhado — confirmar com o Marcelo se o escopo/custo está autorizado antes de rodar, mesmo que a decisão de "fazer os drills" já esteja implícita no programa.

### Pequenos, mas com bloqueio de ambiente

- [ ] **Teste com leitor de tela real (NVDA/VoiceOver)** — declarado `REQUIRED` antes de Pilot, nunca rodado porque o ambiente atual não tem um leitor de tela disponível. Precisa de uma máquina com NVDA ou VoiceOver — real gate, não apenas nice-to-have.
- [ ] **Wire `npm run test:visual` no CI** — baselines de regressão visual foram gravadas em `win32`, CI roda em `ubuntu-latest`. Gravar baselines novas num runner Linux, commitar, plugar no job `frontend` de `.github/workflows/ci.yml` (caminho já descrito em `docs/frontend/visual-language-and-design-system.md` §31). Baixa urgência — cobertura funcional equivalente já existe via `frontend/e2e/expiration-density.spec.ts`.

### `[BLOQUEADO]` — não iniciar sem o gatilho indicado

- [ ] **Wave 1 — reconciliação do Design System com o protótipo standalone**: Marcelo disse que vai atualizar formalmente o Design System a partir do novo protótipo standalone (`Expiration Tracker - Prototipo Standalone (1).html`, salvo em 2026-08-27). Reconciliar contra uma definição que está prestes a mudar é trabalho descartável. **Gatilho**: Marcelo sinalizar que a reconciliação do protótipo está pronta/aprovada.
- [ ] **User Validation**: suspensa a pedido explícito do Marcelo (2026-08-25). **Gatilho**: sinal explícito e novo do Marcelo, não inferência.
- [ ] **M12 (billing) / M13 (Organization/RBAC/platform admin) / W4-02 / W4-03**: bloqueados por decisão de fornecedor de pagamento (D-052) e por gatilho comercial real (primeira venda B2B) que não disparou. **Gatilho**: decisão de fornecedor + venda B2B real.
- [ ] **Elaboração formal de RIPD**: gatilho (IA processando documento real de titular de dados) não disparou — `extraction_pipeline_enabled` continua `false`. **Gatilho**: flag ligada para cliente real.
- [ ] **Mitigação CloudFront/WAF para acesso direto ao `execute-api`**: débito real e registrado, mas gated em tráfego de produção pública, não em pilot controlado. **Gatilho**: decisão de ir a produção pública.

---

## 2. Decisões do Marcelo já tomadas nesta sessão (não perguntar de novo)

| Item | Decisão |
|---|---|
| W2-01 | Auto-confirm escreve `dueDate` automaticamente (não exigir confirmação humana para o caminho de alta confiança). |
| W3-06 | Priorizar implementação do purge real de `USER_DOCUMENT` agora, usando o padrão do `EXTRACTION_TRANSIENT`. |
| W5-01 | Implementar GTR-01 (identidade do requester exposta ao guest) agora. |

Se ao iniciar a sessão qualquer um destes já estiver implementado e commitado, apenas confirme e siga — não reimplemente.

## 3. O que fazer se este prompt e o estado real divergirem

Este arquivo é um plano, não a fonte de verdade. Se `NEXT_SESSION_PROMPT.md`, `docs/engineering/pilot-readiness-program.md` ou o código real mostrarem algo diferente do que está registrado aqui (item já feito, decisão mudada, novo bloqueio descoberto), **confie no estado real**, registre a divergência brevemente na atualização de `NEXT_SESSION_PROMPT.md` ao final da sessão, e prossiga pela lógica da situação real — não trave esperando reconciliação externa antes de agir.
