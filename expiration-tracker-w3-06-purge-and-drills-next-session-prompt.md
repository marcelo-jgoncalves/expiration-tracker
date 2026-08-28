# Expiration Tracker — Prompt para Próxima Sessão: W3-06 (purga real) + drills remanescentes

> **Uso:** iniciar em uma nova sessão de engenharia, em continuação direta ao trabalho da sessão de 2026-08-28 (W2-01, W5-01, Wave 2 completa, Test Engineering Standard).
>
> **Repositório:** `https://github.com/marcelo-jgoncalves/expiration-tracker`
>
> **Branch base:** `develop`
>
> **Data-base deste prompt:** 2026-08-28
>
> **Observação crítica:** o estado do repositório muda rapidamente entre sessões (múltiplas máquinas trabalham nele). Este arquivo define prioridades e uma sequência lógica, mas **não presuma nada como pendente ou concluído sem confirmar contra o estado real** (`git status`, `git log`, testes rodando de verdade, leitura do código quando um doc afirma algo consequente).

---

## 0. Como trabalhar nesta sessão (leia antes de tudo)

1. **Atualize seu contexto primeiro, sempre:**
   - `AGENTS.md` (raiz) — processo de trabalho, convenções, protocolo Claude↔Codex, regras de shell do ambiente.
   - `NEXT_SESSION_PROMPT.md` (raiz) — estado atual + próxima ação, pode estar à frente deste arquivo.
   - `docs/architecture/README.md` — mapa de fontes de arquitetura, regra de precedência.
   - `docs/engineering/README.md` — mapa de fontes de processo/qualidade (rubrica, protocolo, achados de auditoria) — **inclui agora `test-engineering-standard.md`**, novo nesta sessão (ver §2 abaixo).
   - `docs/engineering/pilot-readiness-program.md` e `docs/engineering/pilot-readiness-assessment.md` — o programa que originou W3-06 e a Wave 2, com status por item.
   - `docs/architecture/decisions-log.md` (D-0xx) e `docs/engineering/decisions-log.md` (E-0xx) — são dois arquivos DISTINTOS, não confundir a numeração.
   - `git status` / `git branch --show-current` / `git log -10 --oneline` em `develop` — nunca presumir a partir de resumo de sessão anterior.
   - Se algo neste prompt divergir do estado real do código/docs, **o estado real vence** — registre a discrepância e siga em frente, não trave esperando esclarecimento que você mesmo pode verificar.

2. **Trabalhe com o máximo de autonomia possível, dentro dos limites já estabelecidos pelo projeto:**
   - Commits, testes, refactors locais reversíveis, implementação direta de decisão já aprovada (níveis de risco 1-4 de `docs/engineering/change-risk-scale.md`) — **não pedir confirmação a cada passo**.
   - Decisões de arquitetura Type 1 (difícil de reverter, nível 5-6) — aplicar o protocolo Claude↔Codex completo (`AGENTS.md` §4) autonomamente, sem esperar aprovação intermediária, **exceto** quando o próprio protocolo exigir uma decisão de produto que só o Marcelo pode tomar.
   - PR `develop→main` é ação visível/compartilhada — confirme a redação atual de `AGENTS.md` §3 antes de presumir se pode abrir/mesclar sozinho; pode ter mudado.
   - Nunca reabrir User Validation sem sinal explícito do Marcelo (continua suspensa).
   - **Ações de mutação real em AWS `dev`** (feature flag, DLQ redrive, restore, forçar alarme) passam pelo classificador de segurança do Claude Code e podem exigir uma regra de permissão local (`.claude/settings.local.json`) — ver `scripts/grant-wave2-drill-permissions.mjs` desta sessão como modelo se precisar de permissões novas; **o próprio agente nunca pode rodar esse tipo de script de auto-concessão** (bloqueado por design), só o Marcelo, no terminal dele.

3. **Sempre trabalhe dentro da pasta do projeto** (`C:\Users\Usuario\Desktop\projects\expiration-tracker`). Nunca opere em outro diretório nem presuma que o diretório de trabalho persiste entre chamadas — reafirme o `cd` sempre que houver uma lacuna.

4. **Nunca encadeie comandos com `&&`.** Cada ação é uma chamada de shell separada.

5. **Regras de invocação do Codex** (protocolo Claude↔Codex): nunca usar crases dentro de um prompt passado por Bash com aspas duplas; para prompts com crases/markdown, escrever em arquivo e usar `codex exec --skip-git-repo-check - < arquivo.txt` em primeiro plano (nunca combinar `- < arquivo.txt` com backgrounding). Detalhe completo em `AGENTS.md` §4.

6. **Padrão de qualidade de teste/drill — novo nesta sessão, USE-O.** `docs/engineering/test-engineering-standard.md` (APPROVED, 2026-08-28, protocolo Claude↔Codex de 8 rodadas, nota final Codex 9,62/10) é agora a régua normativa para qualquer teste automatizado ou drill operacional que esta sessão produzir ou avaliar. Antes de declarar um teste/drill "concluído", checar contra os gates binários de §3 (determinismo/reprodutibilidade de veredito, isolamento de dado, asserção não-tautológica, intenção declarada, adequação claim→evidência, e — para drill — blast radius declarado por escrito ANTES da execução + plano de reversão tentado e registrado). Diferença prática mais importante vs. a sessão anterior: **declare a pergunta operacional e o blast radius de um drill por escrito ANTES de rodar**, não só depois — isso é o que torna G-V4/G-V5 satisfazíveis pela primeira vez (a Wave 2 anterior não pôde ser marcada `OK` retroativamente nesses dois gates exatamente por faltar esse registro prévio, ver `test-engineering-standard.md` §5).

---

## 1. To-do list consolidado

Ordem = sequência lógica de dependências, não apenas prioridade. Item marcado `[BLOQUEADO]` não deve ser iniciado sem o gatilho indicado.

### Prioridade real desta sessão — único gate de pilot readiness ainda aberto

- [ ] **W3-06 — desenho do mecanismo de purga real de `USER_DOCUMENT`**: decisão de produto do Marcelo já tomada ("fazer agora", D-059 em `docs/architecture/decisions-log.md`) — o que falta é o **desenho do mecanismo em si**, que é uma decisão de arquitetura Type 1 (nível 5-6, `change-risk-scale.md`) e precisa do protocolo Claude↔Codex completo (`AGENTS.md` §4: mínimo 3 rodadas, nota cega, ambos ≥9.0 — **use o gate padrão de 9,0 a menos que o Marcelo peça um gate elevado como fez para o Test Engineering Standard**). Documentos hoje sem execução: `USER_DOCUMENT` (a classe que cobre documentos reais de usuário) tem um campo `purgeAfter` que parece implementar purga automática mas não aciona nada — não é o atributo TTL nativo do DynamoDB, e não há lifecycle rule no bucket S3 `clean`. Padrão de referência já provado neste projeto: `EXTRACTION_TRANSIENT` (worker explícito de purge + lifecycle S3 como rede de segurança — ver `src/modules/extraction/domain/retention.ts` + `infra/main.tf:1625-1642`). **W3-07 (cascata de deleção real para DSR) usa o mesmo mecanismo** — escopar os dois juntos é o caminho eficiente, mas não expandir further sem necessidade (`docs/engineering/principles.md` #1). Ao concluir o design (Claude↔Codex ≥9.0/10), implementar seguindo o mesmo rigor de evidência real (Camada 3 quando aplicável) que a Wave 2 usou.
- [ ] **Registrar formalmente em `docs/architecture/decisions-log.md`** o desenho do mecanismo de W3-06 como entrada D-0xx nova (última é D-060).

### Drills remanescentes — itens abertos da Wave 2, não bloqueantes para pilot readiness estreito

Confirmar escopo/custo com o Marcelo antes de rodar (mesma disciplina da sessão anterior — envolvem mudança de comportamento real contra `dev` compartilhado). **Use o Test Engineering Standard (§0.6 acima) para declarar a pergunta/blast radius por escrito ANTES de executar desta vez.**

- [ ] **W2-06 — RPO real** (não medido na sessão anterior): escrever um item sentinela na tabela real com timestamp conhecido, aguardar, restaurar para um ponto ANTES do sentinela via PITR, confirmar sua ausência na tabela restaurada — só assim RPO vira medição real, não suposição (`use-latest-restorable-time` sozinho não prova RPO, só maximiza frescor).
- [ ] **W2-05 — replay-safety mais ampla**: a claim provada na sessão anterior foi estreita (`occurrenceId` inexistente → `SKIPPED_NOT_CLAIMED`). Fica em aberto reprocessar uma mensagem que JÁ tivesse produzido efeito real antes (dedupe pós-commit) para provar a claim mais ampla "replay nunca duplica side effect em geral".
- [ ] **W2-08 — metade credential-compromise**: nunca exercitada. Simular comprometimento de credencial (sem expor credencial real) e confirmar que os alarmes/controles de segurança relevantes disparam.
- [ ] **W2-07 — capacidade via HTTP real**: o load test da sessão anterior invocou Lambdas diretamente, contornando API Gateway/BFF. Item aberto: repetir com requisições HTTP reais autenticadas para validar a superfície completa.

### `[BLOQUEADO]` — não iniciar sem o gatilho indicado

- [ ] **Wave 1 — reconciliação do Design System com o protótipo standalone**: aguardando o Marcelo atualizar formalmente o Design System a partir do protótipo standalone. **Gatilho**: Marcelo sinalizar que a reconciliação do protótipo está pronta/aprovada.
- [ ] **User Validation**: suspensa a pedido explícito do Marcelo. **Gatilho**: sinal explícito e novo do Marcelo, não inferência.
- [ ] **M12 (billing) / M13 (Organization/RBAC/platform admin) / W4-02 / W4-03**: bloqueados por decisão de fornecedor de pagamento (D-052) e por gatilho comercial real (primeira venda B2B) que não disparou. **Gatilho**: decisão de fornecedor + venda B2B real.
- [ ] **Elaboração formal de RIPD**: gatilho (IA processando documento real de titular de dados) não disparou — `extraction_pipeline_enabled` continua `false`. **Gatilho**: flag ligada para cliente real.
- [ ] **Mitigação CloudFront/WAF para acesso direto ao `execute-api`**: débito real e registrado, mas gated em tráfego de produção pública, não em pilot controlado. **Gatilho**: decisão de ir a produção pública.

---

## 2. Decisões do Marcelo já tomadas (não perguntar de novo)

| Item | Decisão |
|---|---|
| W2-01 | Auto-confirm escreve `dueDate` automaticamente — **implementado**, commit `e9f2439`, D-058. |
| W3-06 | Priorizar implementação do purge real de `USER_DOCUMENT` agora, usando o padrão do `EXTRACTION_TRANSIENT` — **decisão de produto tomada, desenho do mecanismo ainda pendente** (ver §1 acima). |
| W5-01 | GTR-01 implementado — nome do tenant/empresa, opcional, fallback genérico "Solicitante não identificado" — **implementado**, commit `7dacbac`, D-060. |
| Test Engineering Standard | Gate de aceitação elevado a 9,5/10 (acima do padrão 9,0 do projeto) — **aplicado, documento APPROVED** em 9,62/9,9. Não se aplica a decisões futuras a menos que o Marcelo peça de novo explicitamente — o padrão default do projeto continua 9,0. |

Se ao iniciar a sessão qualquer um destes já estiver implementado e commitado, apenas confirme e siga — não reimplemente.

## 3. O que fazer se este prompt e o estado real divergirem

Este arquivo é um plano, não a fonte de verdade. Se `NEXT_SESSION_PROMPT.md`, `docs/engineering/pilot-readiness-program.md` ou o código real mostrarem algo diferente do que está registrado aqui (item já feito, decisão mudada, novo bloqueio descoberto), **confie no estado real**, registre a divergência brevemente na atualização de `NEXT_SESSION_PROMPT.md` ao final da sessão, e prossiga pela lógica da situação real — não trave esperando reconciliação externa antes de agir.
