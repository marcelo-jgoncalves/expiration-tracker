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
| Abrir PR `develop→main` | Requer confirmação explícita de Marcelo antes de merjar | `AGENTS.md` §3 |
| Force-push, deletar branch protegida, bypassar CI (`--no-verify`) | Proibido | Git Safety Protocol (harness) |
| Editar `infra/`, `.github/workflows/{ci,cd}.yml`, rodar `terraform`/`aws` fora de sessão explicitamente autorizada | Proibido por padrão — exige instrução explícita da sessão | Precedente: instruções de sessão 2026-08-19/20 (trabalho ativo de infra por outra sessão) |
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
| Claude Code — engenharia autônoma do repositório (código, infra-as-code exceto `infra/`, docs, testes) | Construir/manter o produto e seu processo de qualidade | Código-fonte, docs, histórico de decisões; nenhum dado real de tenant (pré-produção, sem usuário real) | Bug introduzido, drift de documentação, decisão técnica ruim — mitigado por CI (typecheck/lint/test/check-boundaries/check-docs) e protocolo `AGENTS.md` §4 para Type 1 | Alta para níveis 1-4 (`change-risk-scale.md`); baixa para Type 1 (requer protocolo ou decisão humana registrada, §2) | Alta — tudo em `develop`, revertível via Git; `main` protegido | Marcelo (merge para `main`) |
| Codex CLI — revisor independente no protocolo Claude↔Codex | Segregação de funções: segunda opinião cega sobre decisões Type 1 e achados de auditoria | Mesmo escopo de leitura que Claude Code (`--skip-git-repo-check`, sandbox read-only observado nesta sessão) | Revisão fraca/mal calibrada não seria pega — mitigado por nota cega + mínimo de rodadas + gate 9.0 sem arredondar | Somente leitura/avaliação — nunca escreve código diretamente no protocolo | Alta — output é só avaliação, não muda estado do sistema | Claude (interpreta/aplica achados) + Marcelo (decisão final) |
| Futuro componente de IA/OCR do produto (extração de dados de documento de vencimento) | Ainda não implementado — requisito registrado (`requirements.md`), sem design aprovado | Documento do tenant (potencialmente PII/dado sensível) | Alto — erro de OCR pode gerar lembrete incorreto/perdido, ou vazamento de dado de tenant para fornecedor externo de IA | N/A — não implementado | N/A | Decisão de design pendente, sujeita a `AGENTS.md` §4 (Type 1: novo fornecedor externo processando dado de tenant) |

**Gatilho de reavaliação**: qualquer mudança de escopo de acesso (novo diretório liberado para edição autônoma, novo dado de tenant real acessível, novo fornecedor de IA externo) reabre este inventário — não esperar pela próxima rodada de full-audit.

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
- **Status**: contido, sem recorrência registrada desde então.

### AI-INC-002 — Bloqueio do classificador de segurança em comando AWS IAM/Terraform

- **Data**: 2026-08-19/20 (sessão de migração ADR-0009, CDK→Terraform).
- **O que aconteceu**: o próprio Claude desta sessão foi bloqueado por um classificador de segurança do harness ao tentar executar comandos reais (`aws iam create-policy`/`terraform apply`) contra a conta AWS real.
- **Impacto**: nenhum — é o comportamento esperado e desejado de um controle fail-closed.
- **Contenção**: N/A — o próprio bloqueio é a contenção.
- **Causa raiz**: N/A — não é uma falha, é um controle de supervisão humana funcionando como desenhado (`AGENTS.md` §1: Marcelo é responsável final por decisões de produto/arquitetura; ações de infraestrutura real de produção não são de autonomia irrestrita do agente).
- **Ação corretiva / follow-up**: nenhuma necessária — registrado aqui como evidência POSITIVA de controle funcionando, não como falha a corrigir. Mantido no mesmo registro que AI-INC-001 para não perder a evidência ao fim da conversa (motivação original deste documento).
- **Status**: fechado, evidência de controle efetivo.

**Mecanismo**: novos incidentes de IA (comportamento do agente, não do produto) devem ser adicionados a esta seção com o mesmo formato (data, o que aconteceu, impacto, contenção, causa raiz, ação corretiva, status) antes do fim da sessão em que ocorreram — a evidência existe só na conversa até ser escrita aqui.

## 6. Proteção de contexto/dados no uso de IA

Regra mínima, proporcional ao estágio do projeto (pré-produção, sem dado de tenant real ainda — `principles.md` #1 não justifica um sistema de classificação/DLP completo agora):

- Nenhum segredo real (chave AWS, token, senha) é colado em prompt — credenciais reais usadas nesta sessão (perfil `claude-dev`, conta `975707451904`) foram referenciadas por nome/ID, nunca por valor de chave secreta.
- Quando existir dado real de tenant (documento, PII), esta seção deve ser revisada antes do primeiro caso de uso — colar dado de tenant real em prompt de IA externa (Codex CLI, fornecedor de OCR) exige a mesma decisão Type 1 do inventário (§3).
- Contexto enviado ao Codex CLI é limitado ao necessário para a tarefa (arquivos específicos listados no prompt, não o repositório inteiro) — ver `docs/engineering/reviews/full-audit-round1-governanca-ia-codex-prompt.txt` como exemplo do padrão adotado nesta sessão (lista explícita de arquivos a ler, não "leia tudo").

**Gatilho de reavaliação**: primeiro dado real de tenant acessível a um agente de IA (produção real ou sandbox com dado real) reabre esta seção como prioridade — hoje é lacuna aceita por proporcionalidade, não por omissão.
