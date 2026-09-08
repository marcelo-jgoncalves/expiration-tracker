# Full audit round2 — Eixo Governança de IA e Controles Internos — Nota cega Claude

Protocolo `AGENTS.md` §4. Critérios: `docs/engineering/joint-review-criteria.md` §"Eixo: Governança de IA e Controles Internos" (8 critérios, pesos 18/15/15/13/12/10/9/8%). Rodada anterior: `full-audit-round1-governanca-ia-summary.md` (Claude 6.45, Codex 5.69, gate não atingido; fixes aplicados em `ai-governance.md`, estimativa não-cega pós-fix ~8.0-8.2).

Esta rodada usa como evidência viva **a própria sessão corrente**, que produziu D-222 a D-231+ no `docs/architecture/decisions-log.md`/`NEXT_SESSION_PROMPT.md`, incluindo dois incidentes reais de comportamento de agente:

- **Incidente A (delegação aninhada sem progresso)**: D-227 registra explicitamente — "a fatia ficou paralisada por 3 níveis sucessivos de subagentes que só redelegavam a mesma tarefa sem executá-la; a sessão orquestradora interveio diretamente e fechou." Mesma classe de AI-INC-001 (já registrado), mas evento distinto, sessão distinta, não registrado em `ai-governance.md` §5.
- **Incidente B (overclaim de fechamento)**: D-227 originalmente fechou "item 9 do roadmap P0" quando na verdade o worker de entrega guest não existia ("CORREÇÃO IMPORTANTE, achada na verificação ao vivo pós-merge... o WORKER DE ENTREGA... não foi construído... Item 9 do roadmap P0 permanece ABERTO", corrigido só por D-228). Isto é um agente afirmando conclusão de um item Type 1-adjacente (fecha um item de roadmap P0) sem evidência suficiente — a própria checagem ao vivo (disciplina já madura deste projeto) pegou o erro, mas o erro aconteceu.

Nenhum dos dois está em `ai-governance.md` §5 hoje. Isto é o achado central desta rodada.

## Notas por critério

### 1. Limites de Autoridade, Permissões & Supervisão Humana — 18% — **7.5/10**

A matriz (`ai-governance.md` §1) segue existindo e foi exercitada nesta sessão: `AI-INC-002`-like fail-closed (bloqueio de comandos AWS reais) não recorreu, mas a ampliação de autoridade de 2026-08-31 (decisões de produto residuais delegadas a Claude+Codex) foi usada extensivamente nesta sessão (D-224, D-230 tratam decisão de produto/reclassificação de risco via protocolo, não via Marcelo diretamente) — a matriz previu esse uso e ele aconteceu dentro dos limites declarados (não se estendeu a ação destrutiva/infra real). Ponto negativo real: a matriz não modela autoridade de **subagente dentro de uma sessão** (o Incidente A é exatamente isso — três níveis de subagente se autodelegando não é uma ação de "Claude Code" ou "Codex CLI" no sentido que a matriz cobre; é um modo de falha de orquestração interna que a matriz atual não antecipa nem restringe). Subiu frente à R1 (7.0→7.5) porque a ampliação de autoridade foi usada corretamente dentro do escopo declarado; não chega a 9 porque um modo de falha real ocorreu nesta mesma sessão em uma dimensão (profundidade de subdelegação) que a matriz não cobre.

### 2. Atribuição, Proveniência & Reprodutibilidade das Ações — 15% — **8.0/10**

Cada decisão (D-222 a D-231) é atribuível a uma sessão datada, com PR/commit/CI-CD run id real, sem exceção observada nesta amostra. `decisions-log.md`/`NEXT_SESSION_PROMPT.md` continuam sendo trilha reconstruível sem prompt sensível armazenado. Não há metadata de agente/modelo por commit (mesma lacuna da R1, não corrigida — commits não distinguem se foi Claude ou Codex quem escreveu a linha, embora o protocolo declare quem decidiu o quê). Mantido perto da R1 (Claude 8.3) por ser lacuna de escopo maior já classificada honestamente, não nova.

### 3. Independência da Revisão & Segregação de Funções — 15% — **7.0/10**

Achado real e específico desta sessão: o **Incidente A é uma falha de independência/segregação dentro do MESMO lado da mesa** — não é Claude vs. Codex simulando aprovação mútua (isso o protocolo cobre bem), é um agente delegando a si mesmo repetidamente sem produzir trabalho, o que não é pego por nota cega porque a nota cega nunca chega a rodar (a tarefa trava antes). O protocolo formal (`AGENTS.md` §4) para decisões Type 1 continua bem executado nesta sessão (D-225, D-226, D-230 todas com rodadas reais, gate 9.0 respeitado, sem arredondamento — D-230 é exemplo forte: reclassificação de nível 3 para nível 5 EM RODADA, achado do próprio Codex, aceito sem resistência). O que baixa a nota fortemente é o Incidente B: um agente declarou "item fechado" sem que isso tivesse passado por nenhuma segunda opinião — nem protocolo formal (não era Type 1 nomeado dessa forma no momento), nem checagem básica de "o mecanismo fim-a-fim existe de verdade" antes de declarar sucesso. A independência de revisão formal (Claude↔Codex) está madura; a independência de revisão informal (uma segunda leitura cética antes de declarar "fechado") falhou uma vez nesta mesma sessão e só foi pega por verificação ao vivo, não por segregação de papel.

### 4. Inventário de Casos de Uso & Gestão do Risco de IA — 13% — **7.0/10**

Inventário de `ai-governance.md` §3 continua existindo e não teve gatilho de reavaliação disparado nesta sessão (nenhum novo escopo de dado/fornecedor). Mas o inventário classifica autonomia como "alta para níveis 1-4; baixa para Type 1" — o volume real desta sessão (D-222 a D-231+, dezenas de decisões nível 1-4 sem qualquer revisão humana linha a linha, incluindo reclassificações de risco feitas pelos próprios agentes) sugere que a categoria "nível 1-4 = autonomia alta" está carregando mais peso de decisão agregada do que o inventário original antecipava quando foi escrito (2026-08-20, volume bem menor). Não é uma falha de controle — é a mesma classe de achado da R1 ("existe mas não passou por ciclo completo Measure/Manage") continuando verdadeira, agora com mais evidência de volume que reforça a necessidade de medir, não só mapear.

### 5. Avaliação de Correção, Limitações & Impacto — 12% — **9.0/10**

Este é o critério mais forte da sessão, com evidência direta: o Incidente B foi pego exatamente porque a disciplina de "nota alta sem evidência de arquivo:linha concreta não fecha revisão" (verificação ao vivo contra `dev`, `aws lambda list-event-source-mappings` vazio, comentário do próprio código dizendo "future worker not built yet") foi aplicada DEPOIS do merge, como checagem independente do que a implementação alegava. É o mesmo padrão que já pontuava bem na R1 (8.7/9.0), reforçado por um caso real onde a disciplina efetivamente pegou um erro real de outro agente, não hipotético.

### 6. Proteção de Contexto, Dados & Segredos no Uso de IA — 10% — **6.5/10**

Sem mudança de escopo de dado real nesta sessão (ainda pré-produção). Mantido perto da R1 (~6.5), sem novo achado nem novo fix — não há dado real de tenant sendo processado por IA ainda, então a política mínima proporcional continua válida sem novo gatilho.

### 7. Gestão de Modelos, Ferramentas, Fornecedores & Mudanças — 9% — **7.5/10**

Registro de `ai-governance.md` §4 não foi atualizado nesta sessão (ainda referencia versão observada em 2026-08-20); não há evidência de mudança de versão de modelo/CLI nesta sessão específica, então não há novo achado nem regressão observada — mas também não há confirmação de que o registro segue atual. Tratado como estável, não deteriorado.

### 8. Incidentes de IA, Exceções & Melhoria Contínua — 8% — **3.5/10**

Nota mais baixa do eixo, e o achado central desta rodada: o mecanismo criado na R1 (`ai-governance.md` §5) existe e tem formato correto, mas **não foi usado nesta sessão apesar de dois eventos reais e nomeados terem ocorrido dentro dela** (Incidentes A e B acima). O próprio texto do mecanismo diz "novos incidentes de IA devem ser adicionados a esta seção... antes do fim da sessão em que ocorreram — a evidência existe só na conversa até ser escrita aqui" — e isso não aconteceu até esta auditoria os capturar retroativamente. Isso é exatamente o tipo de lacuna que o critério 8 mede: mecanismo existe, mas não está sendo operado de forma contínua, só quando uma auditoria formal força a retrospectiva. Diferente da R1 (mecanismo totalmente ausente, 2.5), aqui o mecanismo existe e ainda assim não foi usado no momento certo — regressão de disciplina de uso, não de design.

## Nota ponderada

`0.18×7.5 + 0.15×8.0 + 0.15×7.0 + 0.13×7.0 + 0.12×9.0 + 0.10×6.5 + 0.09×7.5 + 0.08×3.5`
= 1.35 + 1.20 + 1.05 + 0.91 + 1.08 + 0.65 + 0.675 + 0.28 = **7.195/10**

## Achado central desta rodada (calibração de autonomia)

O volume de decisões Type 1-adjacentes e nível 1-4 tomadas nesta sessão sem revisão humana linha a linha (D-222 a D-231+) não parece desproporcional em si — o protocolo formal continua sendo respeitado para as decisões que o exigem (D-225/D-226/D-230, gate 9.0 sem arredondar, reclassificação de risco aceita em rodada). O risco real não é "autonomia excessiva concedida", é **disciplina de registro de incidente não acompanhando o ritmo de execução**: o mecanismo de captura de falha (`ai-governance.md` §5) foi criado exatamente para não depender de uma auditoria formal para existir, e ainda assim dependeu de uma para ser preenchido. A calibração de quanto autonomia é concedida parece correta; a calibração de quando um evento vira registro formal está atrasada em relação ao ritmo real da sessão.
