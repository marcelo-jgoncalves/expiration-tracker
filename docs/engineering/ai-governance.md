---
status: active
owner: Marcelo
authority: normative
---

# Governança de IA e Controles Internos — registros operacionais

Complementa `AGENTS.md` §4 (protocolo de debate Claude↔Codex) e `docs/engineering/joint-review-criteria.md` §"Eixo: Governança de IA e Controles Internos". Aquele eixo define O QUE é avaliado (8 critérios, pesos); este documento é onde os controles concretos (matriz de autoridade, inventário de uso, registro de fornecedor, política de contexto) vivem como artefato durável — criado em `full-audit-round1-governanca-ia` (2026-08-20) para fechar lacunas reais encontradas na nota cega Claude↔Codex (`reviews/full-audit-round1-governanca-ia-summary.md`).

## 1. Matriz de autoridade — ações por agente (Claude Code, Codex CLI)

| Ação | Status | Base |
|---|---|---|
| Editar código/docs em `develop`, rodar testes/lint/typecheck | Permitido sem aprovação prévia | `AGENTS.md` §3 |
| Commitar em `develop` | Permitido sem confirmação a cada commit | `AGENTS.md` §3 |
| Abrir PR `develop→main` e merjar | Permitido sem confirmação explícita a cada merge desde 2026-08-29 (autonomia de merge, `AGENTS.md` §3) — esta linha estava desatualizada até a correção do full-audit round2 (2026-09-07), contradizendo `AGENTS.md` §3 literalmente | `AGENTS.md` §3 |
| Force-push, deletar branch protegida, bypassar CI (`--no-verify`) | Proibido | Git Safety Protocol (harness) |
| Editar `infra/` (código Terraform) e `.github/workflows/{ci,cd}.yml`, rodar `terraform fmt/validate/plan/test` | Permitido sem aprovação prévia, mesma autonomia de código normal desde ADR-0009 (Terraform substituiu CDK) — **linha corrigida no full-audit round2 (2026-09-07)**: a versão anterior ("proibido por padrão") era resíduo da era CDK (2026-08-19/20, antes de ADR-0009) e contradizia a prática real já observada em D-231 e outras fatias, achado do Codex nesta rodada | `AGENTS.md` §7, ADR-0009 |
| Rodar `terraform apply` real ou `aws` de escrita contra conta AWS real fora de `dev`, ou qualquer ação de infra fora do fluxo padrão PR→CI(`plan`)→CD(`apply` em `main`) | Proibido por padrão — exige instrução explícita da sessão | `AGENTS.md` §7 |
| Comandos AWS IAM/Terraform de escrita real (`iam create-policy`, `terraform apply`) | Sujeito a bloqueio automático por classificador de segurança do harness (fail-closed) — não contornar, escalar para decisão humana | Observado nesta sessão (2026-08-20), ver §5 |
| Decisão Type 1 (nível 5-6, `change-risk-scale.md`) | Requer protocolo `AGENTS.md` §4 (nota cega, ≥3 rodadas, gate 9.0) **OU** decisão humana direta registrada em ADR com justificativa explícita de por que o protocolo foi dispensado (ver §2) | `AGENTS.md` §4, ADR-0009 |
| Comunicação externa (e-mail, post público, contato com terceiro) | Não autorizado nesta fase do projeto — nenhum caso de uso real ainda | N/A (registrar aqui se/quando surgir) |

Esta tabela é o candidato mínimo para o critério "Limites de Autoridade" do eixo — não substitui julgamento caso a caso, mas dá um ponto único de referência em vez de reconstruir as regras a cada sessão a partir de prompts dispersos.

**Ampliação de autoridade (Marcelo, 2026-08-31)**: para as decisões pendentes já nomeadas em `NEXT_SESSION_PROMPT.md` no momento desta ampliação (estratégia de quarentena/retenção LGPD, `AppError.retryable`, supersessão de GTR-01, Design System reconciliation), Marcelo autorizou que resíduos de decisão que antes ficariam reservados a ele (parâmetros de produto dentro do escopo já delimitado, ex. duração de janela, escolha entre alternativas de UX/comportamento) também sejam decididos por Claude+Codex via o protocolo completo (`AGENTS.md` §4: pesquisa externa quando aplicável per `research-protocol.md`, rodada adversarial real, nota cega, ≥9,0 sem arredondar) — não apenas o mecanismo técnico. Justificativa dele: "sobre decisões de produto em si, você e Codex conhecem bem o produto e o objetivo" — revertível por ele a qualquer momento ("se precisar, no futuro, eu peço ajustes"), não um cheque em branco permanente nem uma dispensa do protocolo em si (§2 continua exigindo as 3 condições para dispensar o protocolo formal — isto AMPLIA o que o protocolo pode decidir, não dispensa rodá-lo). **Não se estende** a ações de execução real/destrutiva (ex. `terraform apply` fora de `dev`, comandos AWS de escrita real, `reset-dev-data.ts --confirm`) — essas continuam exigindo confirmação explícita dele por ação, sem exceção, porque não são perguntas de qualidade de decisão e sim autorização de um ato irreversível.

## 2. Quando o protocolo `AGENTS.md` §4 pode ser dispensado

Achado real do full-audit round1 (eixo Governança de IA): ADR-0009 é uma decisão Type 1 (nível 6) que dispensou o protocolo de nota cega porque a escolha já havia sido feita diretamente por Marcelo — mas `AGENTS.md` §4, lido literalmente, descreve o protocolo como obrigatório para todo Type 1 sem essa exceção. Isso não era um bypass silencioso (a ADR documenta o raciocínio linha a linha), mas a regra normativa não formalizava a exceção — dependia de julgamento ad hoc repetido em cada caso.

**Regra explícita**: o protocolo `AGENTS.md` §4 é dispensável para uma decisão Type 1 quando, e somente quando, todas as condições abaixo são verdadeiras — e registradas na própria ADR/decisão:

1. A escolha já foi feita diretamente pelo responsável final por decisões de arquitetura/produto (`AGENTS.md` §1), não por um agente propondo e o outro validando.
2. A ADR/decisão documenta explicitamente que o protocolo foi dispensado e por quê (não fica implícito).
3. Alternativas tecnicamente viáveis continuam registradas na ADR (Options Considered) mesmo que não tenham sido debatidas em rodada formal — para que uma revisão futura consiga avaliar se a decisão foi razoável mesmo sem debate Claude↔Codex.

Uma decisão Type 1 que dispense o protocolo sem essas três condições registradas volta a ser tratada como pendência (protocolo deveria ter rodado e não rodou), não como exceção válida.

## 3. Inventário de casos de uso de IA

| Uso | Finalidade | Dados acessados | Impacto se errado | Autonomia | Reversibilidade | Aprovador |
|---|---|---|---|---|---|---|
| Claude Code — engenharia autônoma do repositório (código, `infra/` incluído desde ADR-0009/Terraform — achado do full-audit round2, 2026-09-07: esta linha afirmava incorretamente "exceto `infra/`", D-231 e outras fatias já editam Terraform diretamente sob autonomia normal, revisão via `terraform plan`/CI, não aprovação humana prévia por edição, docs, testes) | Construir/manter o produto e seu processo de qualidade | Código-fonte, docs, histórico de decisões; nenhum dado real de tenant (pré-produção, sem usuário real) | Bug introduzido, drift de documentação, decisão técnica ruim — mitigado por CI (typecheck/lint/test/check-boundaries/check-docs) e protocolo `AGENTS.md` §4 para Type 1 | Alta para níveis 1-4 (`change-risk-scale.md`), incluindo merge autônomo `develop→main` (`AGENTS.md` §3, 2026-08-29); baixa para Type 1 (requer protocolo ou decisão humana registrada, §2) | Alta — tudo em `develop`, revertível via Git; `main` protegido | Merge autônomo por Claude/Codex; Marcelo permanece aprovador só de Type 1 sem protocolo (§2) e de ação destrutiva/infra real fora de `dev` |
| Codex CLI — revisor independente no protocolo Claude↔Codex | Segregação de funções: segunda opinião cega sobre decisões Type 1 e achados de auditoria | Mesmo escopo de leitura que Claude Code (`--skip-git-repo-check`, sandbox read-only observado nesta sessão) | Revisão fraca/mal calibrada não seria pega — mitigado por nota cega + mínimo de rodadas + gate 9.0 sem arredondar | Somente leitura/avaliação — nunca escreve código diretamente no protocolo | Alta — output é só avaliação, não muda estado do sistema | Claude (interpreta/aplica achados) + Marcelo (decisão final) |
| Futuro componente de IA/OCR do produto (extração de dados de documento de vencimento) | Ainda não implementado — requisito registrado (`requirements.md`), sem design aprovado | Documento do tenant (potencialmente PII/dado sensível) | Alto — erro de OCR pode gerar lembrete incorreto/perdido, ou vazamento de dado de tenant para fornecedor externo de IA | N/A — não implementado | N/A | Decisão de design pendente, sujeita a `AGENTS.md` §4 (Type 1: novo fornecedor externo processando dado de tenant) |

**Gatilho de reavaliação**: qualquer mudança de escopo de acesso (novo diretório liberado para edição autônoma, novo dado de tenant real acessível, novo fornecedor de IA externo) reabre este inventário — não esperar pela próxima rodada de full-audit.

**Gap real, não corrigido nesta rodada (full-audit round2, 2026-09-07)**: este inventário não modela delegação de subagente dentro de uma mesma sessão (profundidade, verificação de progresso antes de redelegar) — dimensão onde AI-INC-001/AI-INC-003 (§5) realmente ocorreram. A matriz de autoridade (§1) e este inventário tratam "Claude Code"/"Codex CLI" como unidades atômicas; um modo de falha real (redelegação recursiva sem produzir diff) vive dentro dessa unidade e não é coberto por nenhum dos dois documentos hoje. Candidato a rodada futura, não fechado aqui.

## 4. Gestão de modelos, ferramentas e fornecedores

| Ferramenta | Fornecedor | Versão/capacidade observada nesta sessão | Nota |
|---|---|---|---|
| Claude Code | Anthropic | Claude Sonnet 5 (harness Claude Code) | Sem processo formal de avaliação de regressão ao trocar de versão de modelo — mudança de comportamento do fornecedor não é controle interno garantido (mesma ressalva do critério do eixo). |
| Codex CLI | OpenAI | `codex exec` v0.147.0, modelo `gpt-5.6-sol`, sandbox read-only, approval `never` (observado no header do output em `reviews/full-audit-round1-governanca-ia-codex-output-round1.txt`) | Comportamento operacional conhecido e documentado (`AGENTS.md` §4: nunca crase em prompt via Bash aspas duplas, nunca `- < arquivo` com `&`, matar processo travado). |

**Gatilho de reavaliação**: upgrade de CLI/modelo de qualquer ferramenta usada no protocolo — repetir um smoke test do protocolo (uma rodada de nota cega num achado já conhecido) antes de confiar no novo comportamento para uma decisão real. Mudança de dependência de build (não do agente de IA em si, ex. Vitest) segue `exceptions.md`/`decisions-log.md` normalmente (já demonstrado em EX-001).

## 5. Incidentes de IA (registro real, não de engenharia)

Distinto de `docs/engineering/exceptions.md` (exceções de regra de engenharia, ex. vulnerabilidade de dependência) — aqui registram-se eventos onde o comportamento do próprio agente de IA (não do produto) desviou do esperado.

### AI-INC-001 — Agente preso em loop de auto-delegação

- **Data**: 2026-08-20 (sessão de full-audit round1, eixo Governança de IA — este mesmo eixo detectando um evento sobre si mesmo).
- **O que aconteceu**: um agente, em vez de executar trabalho real da tarefa atribuída, entrou em um padrão de delegar repetidamente para um novo subagente sem produzir progresso — precisou de correção direta do usuário para voltar a fazer trabalho real.
- **Impacto**: nenhum dado corrompido nem decisão errada commitada; custo foi tempo/turnos gastos sem progresso.
- **Contenção**: intervenção humana direta (Marcelo identificou o padrão e instruiu a corrigir).
- **Causa raiz**: comportamento de delegação do agente não verificou se o subagente estava de fato progredindo antes de delegar novamente.
- **Ação corretiva / follow-up**: nenhuma mudança de configuração aplicada ainda — registrado aqui como o mecanismo durável que faltava (achado do próprio full-audit deste eixo, critério 8). Se o padrão se repetir, reavaliar uso de subagentes para tarefas deste tipo.
- **Status**: **RECORRENTE** — ver AI-INC-003 abaixo (full-audit round2, 2026-09-07). A frase "sem recorrência registrada" era falsa no momento em que foi escrita porque o evento recorrente (D-227) não tinha sido registrado ainda, não porque não tivesse ocorrido — achado do próprio Codex na Rodada 2 deste eixo.

### AI-INC-002 — Bloqueio do classificador de segurança em comando AWS IAM/Terraform

- **Data**: 2026-08-19/20 (sessão de migração ADR-0009, CDK→Terraform).
- **O que aconteceu**: o próprio Claude desta sessão foi bloqueado por um classificador de segurança do harness ao tentar executar comandos reais (`aws iam create-policy`/`terraform apply`) contra a conta AWS real.
- **Impacto**: nenhum — é o comportamento esperado e desejado de um controle fail-closed.
- **Contenção**: N/A — o próprio bloqueio é a contenção.
- **Causa raiz**: N/A — não é uma falha, é um controle de supervisão humana funcionando como desenhado (`AGENTS.md` §1: Marcelo é responsável final por decisões de produto/arquitetura; ações de infraestrutura real de produção não são de autonomia irrestrita do agente).
- **Ação corretiva / follow-up**: nenhuma necessária — registrado aqui como evidência POSITIVA de controle funcionando, não como falha a corrigir. Mantido no mesmo registro que AI-INC-001 para não perder a evidência ao fim da conversa (motivação original deste documento).
- **Status**: fechado, evidência de controle efetivo.

### AI-INC-003 — Recorrência de delegação aninhada sem progresso (3 níveis de subagentes)

- **Data**: 2026-09-07 (sessão da fatia 2 de D-226, registrado em `NEXT_SESSION_PROMPT.md`/`decisions-log.md` D-227; capturado aqui só pelo full-audit round2 deste eixo, 2026-09-07 — não no mesmo dia do evento).
- **O que aconteceu**: a mesma classe de AI-INC-001 se repetiu — três níveis sucessivos de subagentes redelegaram a mesma tarefa (fatia 2 da emissão de credencial guest) sem nenhum produzir progresso real, até a sessão orquestradora intervir diretamente e concluir o trabalho.
- **Impacto**: tempo/turnos gastos sem progresso, mesmo perfil de AI-INC-001; nenhum dado corrompido.
- **Contenção**: intervenção direta da sessão orquestradora (não um humano desta vez — a própria orquestração de nível superior identificou a estagnação e assumiu a tarefa).
- **Causa raiz**: idêntica a AI-INC-001, não corrigida — nenhuma mudança de configuração foi aplicada depois do primeiro evento, e o mecanismo de verificar progresso antes de redelegar continua inexistente.
- **Ação corretiva / follow-up**: **atrasada** — o evento só foi registrado formalmente nesta auditoria (full-audit round2), não "antes do fim da sessão em que ocorreu" como o mecanismo desta seção exige. Isso é, em si, o achado do critério 8 desta rodada (mecanismo existe mas não foi operado no momento certo). Ação real pendente: considerar um limite explícito de profundidade de redelegação (ex. no máximo 1 nível de subagente sem produzir diff real antes de escalar para execução direta), não apenas "reavaliar se repetir" — já se repetiu uma vez sem reavaliação.
- **Status**: aberto — mecanismo de prevenção ainda não existe, apesar de dois eventos da mesma classe.

### AI-INC-004 — Overclaim de fechamento de item de roadmap sem verificação funcional completa (D-227)

- **Data**: 2026-09-07 (mesma sessão de AI-INC-003; corrigido horas depois pela verificação ao vivo pós-merge que originou D-228).
- **O que aconteceu**: D-227 declarou fechado o "item 9 do roadmap P0" (ciclo guest de emissão de credencial) após implementar e mergear a fatia 2 (consumidor/armazenamento), mas o worker de entrega real (que leria a tabela via DynamoDB Streams e enviaria o link ao guest) nunca foi construído — confirmado só depois, por `aws lambda list-event-source-mappings` vazio e pelo próprio comentário do código dizendo "future worker not built yet". Na prática, nenhum guest recebia um link utilizável no momento da declaração de fechamento.
- **Impacto**: item de roadmap P0 marcado incorretamente como concluído por um ciclo (entre D-227 e D-228); PR já mergeado em `main` e deployado antes da correção. Nenhum dado de tenant real exposto (pré-produção).
- **Contenção**: a própria disciplina de verificação ao vivo pós-merge deste projeto (já madura, critério 5 deste eixo) pegou a divergência antes que avançasse mais — não uma segunda revisão humana nem o protocolo `AGENTS.md` §4 (o item não tinha sido submetido a ele como decisão Type 1 de "isto está completo").
- **Causa raiz**: "suíte verde + CI verde + deploy bem-sucedido" foi tratado como prova suficiente de que um fluxo ponta a ponta funcionava, quando na verdade nenhum teste cobria o elo faltante (o worker de entrega inexistente). Mesma classe de risco que `definition-of-done.md` (E-012/E-013) tenta mitigar para itens de todo list, mas aqui o claim era sobre um item de ROADMAP (granularidade maior), onde a mesma disciplina de "gate por evidência mínima antes de declarar concluído" não estava sendo aplicada com o mesmo rigor.
- **Ação corretiva / follow-up**: D-228 corrigiu o estado (worker construído, item reaberto e depois fechado de verdade). Ação estrutural pendente, não aplicada ainda: exigir que o fechamento de um item de ROADMAP (não só de todo list de sessão) cite explicitamente qual evidência prova o fluxo PONTA A PONTA (não só cada fatia individualmente verde) antes de ser marcado 🟢 — candidato a emenda futura de `definition-of-done.md`, fora do escopo desta auditoria (que só registra, não corrige código/processo de outro documento).
- **Status**: fechado quanto ao fato em si (D-228 corrigiu), mas a causa raiz (ausência de gate explícito de "evidência ponta a ponta" para fechamento de item de roadmap) permanece sem correção estrutural — registrado como gap real para rodada futura.

**Mecanismo**: novos incidentes de IA (comportamento do agente, não do produto) devem ser adicionados a esta seção com o mesmo formato (data, o que aconteceu, impacto, contenção, causa raiz, ação corretiva, status) antes do fim da sessão em que ocorreram — a evidência existe só na conversa até ser escrita aqui. **Achado do full-audit round2 (2026-09-07)**: este mecanismo não foi seguido para AI-INC-003/AI-INC-004 — ambos ocorreram na mesma sessão que produziu D-227/D-228 e só foram registrados aqui por uma auditoria formal posterior, não pela sessão que os viveu. Ver critério 8 da nota cega desta rodada.

## 6. Proteção de contexto/dados no uso de IA

Regra mínima, proporcional ao estágio do projeto (pré-produção, sem dado de tenant real ainda — `principles.md` #1 não justifica um sistema de classificação/DLP completo agora):

- Nenhum segredo real (chave AWS, token, senha) é colado em prompt — credenciais reais usadas nesta sessão (perfil `claude-dev`, conta `975707451904`) foram referenciadas por nome/ID, nunca por valor de chave secreta.
- Quando existir dado real de tenant (documento, PII), esta seção deve ser revisada antes do primeiro caso de uso — colar dado de tenant real em prompt de IA externa (Codex CLI, fornecedor de OCR) exige a mesma decisão Type 1 do inventário (§3).
- Contexto enviado ao Codex CLI é limitado ao necessário para a tarefa (arquivos específicos listados no prompt, não o repositório inteiro) — ver `docs/engineering/reviews/full-audit-round1-governanca-ia-codex-prompt.txt` como exemplo do padrão adotado nesta sessão (lista explícita de arquivos a ler, não "leia tudo").

**Gatilho de reavaliação**: primeiro dado real de tenant acessível a um agente de IA (produção real ou sandbox com dado real) reabre esta seção como prioridade — hoje é lacuna aceita por proporcionalidade, não por omissão.
