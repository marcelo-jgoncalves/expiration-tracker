# Full audit round1 — Eixo Governança de IA e Controles Internos — Nota cega Claude (Rodada 1)

Protocolo: `AGENTS.md` §4. Critérios: `docs/engineering/joint-review-criteria.md` §"Eixo: Governança de IA e Controles Internos" (8 critérios, pesos 18/15/15/13/12/10/9/8%).

Esta nota é cega: escrita ANTES de rodar o Codex, sem ver o parecer dele.

## Evidência-base usada

- `AGENTS.md` §4 (protocolo de debate Claude↔Codex — nota cega, mínimo 3 rodadas, gate 9.0 sem arredondar).
- `docs/architecture/adr/ADR-0009-cdk-to-terraform-migration.md` (Type-1, "Decisor: Marcelo", explica por que o protocolo §4 NÃO se aplicou aqui e por quê isso é correto, não um bypass silencioso).
- `docs/engineering/decisions-log.md` E-000 a E-009 (decisões atribuídas, com motivo, corrigidas com evidência de comando real).
- `docs/engineering/disagreement-log.md` (D-001/D-002/D-003 — divergência real registrada, inclusive quando Codex se recusou a inventar número; nota operacional sobre falha real de invocação do Codex, registrada como lição de processo).
- `docs/engineering/exceptions.md` EX-001 (exceção com `expiraEm`, owner, tentativa de correção real registrada e revertida com evidência).
- `git log --oneline -40`: mensagens de commit atribuíveis por eixo/rodada (`fix(qualidade): round1 findings...`, `docs(seguranca): resumo do eixo...`), rastreáveis a um summary/rodada específica.
- `docs/engineering/reviews/full-audit-round1-*-summary.md` (6 eixos): todos aplicam nota cega real, muitos fecham abaixo do gate honestamente (operações 5.11/3.92, privacidade abaixo do gate) em vez de arredondar.
- Ausência verificada: nenhum inventário de casos de uso de IA (`docs/engineering/*.md` não tem tal arquivo); nenhum registro dos dois incidentes reais desta sessão (loop de auto-delegação de um agente; bloqueio real do classificador de segurança em `aws iam create-policy`/`terraform apply`).

## Notas por critério

| # | Critério | Peso | Nota (0-10) | Evidência / lacuna |
|---:|---|---:|---:|---|
| 1 | Limites de Autoridade, Permissões & Supervisão Humana | 18% | 7.0 | Supervisão humana real e comprovada nesta sessão: ADR-0009 registra decisão explícita de Marcelo; instruções de sessão restringem `infra-terraform/`, `.github/workflows/{ci,cd}.yml`, proíbem `terraform`/`aws` — e o bloqueio real do classificador de segurança em `aws iam create-policy`/`terraform apply` nesta mesma sessão é evidência direta de um controle fail-closed funcionando, não hipotético. **Lacuna real**: essas regras vivem espalhadas em prompts de sessão e `AGENTS.md` §3 (branch), não há uma tabela única e durável em `AGENTS.md`/documento de governança listando ações permitidas/proibidas/sujeitas-a-aprovação por agente — cada sessão precisa reconstruir isso ad hoc a partir do prompt do usuário, o que é frágil (só existe enquanto alguém lembrar de repetir a regra). |
| 2 | Atribuição, Proveniência & Reprodutibilidade das Ações | 15% | 8.3 | Forte: commits atribuíveis a eixo/rodada/achado (`git log`), `decisions-log.md` liga decisão→motivo→evidência de comando, reviews nomeadas por eixo/rodada/agente (`full-audit-round1-<eixo>-{claude,codex-prompt,codex-output}.*`). Reconstruível sem precisar de prompt bruto armazenado indiscriminadamente (E-002 distingue N/A de NEE por evidência, não por confiança). **Lacuna**: nenhum commit ou decisão registra explicitamente versão/modelo do agente (ex. "Claude Sonnet 5", hash de sessão) — atribuição é a "o quê/por quê", não "qual agente/versão exatos". |
| 3 | Independência da Revisão & Segregação de Funções | 15% | 9.2 | Controle central do projeto, `AGENTS.md` §4, aplicado de verdade em 6 eixos completos nesta sessão com nota cega real (inclusive divergências >1 ponto registradas sem arredondar, ex. operações 5.11 vs 3.92). ADR-0009 é o teste mais interessante: em vez de simular uma rodada de debate quando a decisão já foi tomada pelo humano ("seria teatro, não revisão real"), a ADR documenta honestamente por que o protocolo não se aplicou — isso é o critério funcionando corretamente (o protocolo não vira ritual vazio), não uma brecha. `disagreement-log.md` mostra Codex recusando-se a inventar número quando faltava informação (D-003) — evidência de independência real, não complacência. |
| 4 | Inventário de Casos de Uso & Gestão do Risco de IA | 13% | 2.5 | Lacuna real e sem mitigação: nenhum arquivo em `docs/engineering/` ou `docs/architecture/` inventaria os usos de IA deste projeto (Claude/Codex construindo/revisando o repo; futuro OCR/IA do produto) por finalidade/impacto/dado/autonomia/reversibilidade. Não há gate "mudança relevante reabre avaliação". |
| 5 | Avaliação de Correção, Limitações & Impacto | 12% | 8.7 | Prática real e consistente: E-002 formaliza NEE vs N/A: nota alta sem evidência de arquivo:linha não fecha revisão — visível em todos os 6 summaries lidos (ex. operações classifica cada critério explicitamente como impedimento externo vs. escopo maior, não aceita nota alta sem justificar). **Lacuna menor**: essa disciplina é aplicada às decisões de ENGENHARIA revisadas pelo protocolo, não há uma avaliação equivalente e explícita das LIMITAÇÕES do próprio agente de IA (taxa de erro conhecida, classes de tarefa onde Claude/Codex historicamente erraram neste projeto) como artefato central. |
| 6 | Proteção de Contexto, Dados & Segredos no Uso de IA | 10% | 5.5 | Controles técnicos fortes existem no PRODUTO (`SecureLogger`/`Redactor`, AGENTS.md §7) mas não há política explícita sobre o que é/não é apropriado colar em prompt de Claude/Codex (segredos reais, dado de tenant real, credencial AWS) — o projeto é pré-produção sem dado de tenant real ainda, o que reduz o risco concreto hoje, mas não há uma regra escrita que sobreviva a quando isso deixar de ser verdade. |
| 7 | Gestão de Modelos, Ferramentas, Fornecedores & Mudanças | 9% | 5.0 | Existe disciplina real para mudança de FERRAMENTA (EX-001: upgrade de Vitest tentado, quebrou CI real, revertido com evidência de duas execuções — exatamente o padrão "avaliação de regressão" que o critério pede) mas isso é sobre dependências de build, não sobre o modelo de IA em si — nenhum registro de versão de Claude/Codex usada, nem processo formal para quando o comportamento do fornecedor mudar (ex. Codex CLI atualizar e mudar como invoca ferramentas). |
| 8 | Incidentes de IA, Exceções & Melhoria Contínua | 8% | 2.5 | Mecanismo de exceção EXISTE (`exceptions.md`, padrão `expiraEm`) mas nunca foi usado para um incidente causado pela própria IA — está desenhado para exceção de regra de engenharia (ex. vulnerabilidade de dependência). Os dois incidentes reais desta sessão (agente preso em loop de auto-delegação corrigido pelo usuário; bloqueio do classificador de segurança em comando AWS/Terraform) não estão registrados em nenhum lugar — se a conversa terminar agora, essa evidência de comportamento real do agente (bom e ruim) se perde. |

## Nota ponderada (Rodada 1, antes de qualquer fix)

(18×7.0 + 15×8.3 + 15×9.2 + 13×2.5 + 12×8.7 + 10×5.5 + 9×5.0 + 8×2.5) / 100
= (126 + 124.5 + 138 + 32.5 + 104.4 + 55 + 45 + 20) / 100
= 645.4 / 100 = **6.45/10**

Abaixo do gate (9.0) em 5 dos 8 critérios (1, 4, 6, 7, 8). Critérios 2, 3, 5 já estão próximos ou acima do gate com evidência real forte.
