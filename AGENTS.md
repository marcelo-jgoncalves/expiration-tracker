# AGENTS.md — Expiration Tracker

> Fonte canônica de regras duráveis para qualquer agente de IA (Claude Code, Codex CLI) trabalhando neste repositório. `CLAUDE.md` importa este arquivo — não duplicar conteúdo nele.

## 1. Papel e estágio do projeto

Micro-SaaS de controle de vencimentos/renovações, arquitetura AWS serverless. O projeto está na transição **Design Maturity APPROVED → Implementation Blueprint** (ver `docs/architecture/README.md` para o status exato e vigente — não confiar em datas antigas deste arquivo). Marcelo é o responsável final por decisões de produto/arquitetura; o agente atua como engenheiro autônomo, não assistente passivo.

**`docs/00-prompt-mestre.md` é a especificação de processo do ciclo de design já concluído — não é o ponto de entrada da sessão atual.** Não reiniciar a Fase 0 nem tratar suas instruções ("comece pela Fase 0") como comando ativo.

## 2. Início de sessão

1. Ler `NEXT_SESSION_PROMPT.md` (estado atual + próxima ação).
2. Ler `docs/architecture/README.md` (mapa de fontes, status vigente, regra de precedência).
3. Consultar `docs/project/working-memory.md` só quando a tarefa envolver COMO trabalhar com Marcelo (ferramentas, processo), não O QUE decidir sobre o produto.
4. Não carregar todo `docs/architecture/history/` por padrão — é evidência histórica, consultar sob demanda.

## 3. Protocolo de debate Claude ↔ Codex

Aplica-se **obrigatoriamente** a: decisões de arquitetura, requisitos, modelo de dados, segurança/privacidade, e qualquer entregável explicitamente submetido ao protocolo (Type 1, difícil de reverter). **Não é obrigatório** para: correção mecânica, documentação factual, refactors locais reversíveis, lint/teste, implementação direta de decisão já aprovada — aplicar bom senso de engenharia nesses casos.

Quando aplicável: mínimo 3 rodadas (proposta → crítica → tréplica), nota mínima 9.0 de ambos antes de considerar concluído, sem arredondar (8.99 não vira 9). Protocolo de nota cega: o avaliador que responde depois não vê a nota/parecer do primeiro até ambos existirem registrados; desacordo abaixo de 9 reabre rodada em vez de arredondar ou fazer média.

Invocação do Codex: `codex exec --skip-git-repo-check "<prompt>"`, rodar em background. **Nunca usar crases (`` ` ``) dentro de um prompt passado por Bash com aspas duplas** — o shell interpreta como substituição de comando e corrompe a entrada silenciosamente (o processo trava esperando stdin, CPU ~0). Para prompts com crases/markdown, escrever em arquivo e usar `codex exec --skip-git-repo-check - < arquivo.txt`. Se um processo `codex` rodar muito mais que rodadas comparáveis com CPU quase zero, está travado — matar e relançar, não esperar.

## 4. Precedência de fontes

Ver tabela completa em `docs/architecture/README.md`. Resumo: `AGENTS.md` (processo) > ADR aceito (decisão específica) > documento temático corrente (`docs/architecture/*.md`) > `ARCHITECTURE.md` (visão consolidada) > `NEXT_SESSION_PROMPT.md` (estado, nunca normativo) > `docs/architecture/history/` (nunca normativo).

## 5. Manutenção de contexto — checklist por marco

Ao concluir uma fase/marco relevante (ex.: fim do Implementation Blueprint, fim de cada fase de implementação), verificar:

- Estado e próxima ação concordam entre `ARCHITECTURE.md`, `docs/architecture/README.md` e `NEXT_SESSION_PROMPT.md`.
- Nenhum documento em `history/` está sendo tratado como normativo em algum lugar.
- ADRs e `decisions-log.md` têm status compatível entre si.
- Arquivos novos em `docs/architecture/` aparecem no índice.
- Referências a caminhos de arquivo (`docs/architecture/...`) continuam válidas.
- Regras duráveis não foram duplicadas entre `AGENTS.md`, working-memory e handoff.
- Este `AGENTS.md` continua dentro do limite de tamanho (ver §6).
- Fatos temporários foram removidos de `NEXT_SESSION_PROMPT.md` ou promovidos ao lugar correto.

Não há automação disso ainda — é proporcional ao estágio (projeto sem código/CI real). Reavaliar automação (ex.: verificador de links, ou uma skill dedicada como a de um projeto irmão do mesmo usuário) quando: (a) existir CI real, ou (b) houver reincidência de link quebrado/drift documental.

## 6. Quando a implementação começar

Este `AGENTS.md` cobre o estágio de documentação/design. Quando o Implementation Blueprint sair e código real (`src/`, `infra/`, testes, CI) existir, adicionar aqui (não recriar do zero): comandos de build/lint/test/deploy, convenções de código, política de branch/PR, critérios de conclusão por tipo de mudança, e reavaliar a automação da checklist da seção 5 (verificador de links, ou skill de auditoria de consistência — ver `docs/project/working-memory.md` sobre um projeto irmão que já tem isso). Não adiar a atualização deste arquivo para "depois" — ele perde valor exatamente na hora em que mais precisa cobrir o projeto inteiro.

## 7. Manutenção do próprio AGENTS.md

Meta: 60-100 linhas. Antes de adicionar algo, verificar: muda comportamento em várias sessões futuras? É estável, não temporário? Não é derivável do código/Git/decisions-log? Não pertence a `NEXT_SESSION_PROMPT.md`, `working-memory.md` ou a um documento de arquitetura? Se alguma resposta for não, não pertence aqui.
