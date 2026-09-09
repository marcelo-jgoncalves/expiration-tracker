# Round 1 — Codex blind independent proposal (verbatim, translated header only)

Codex ran this BEFORE seeing Claude's Round 1 proposal (`round1-claude-proposal.md`), per the anchoring-bias discipline in `AGENTS.md` §4. Invoked via `codex exec --skip-git-repo-check - < codex-round1-prompt.txt` (prompt in this session's scratch history, not persisted separately — same convention as D-184's estado-final-consolidado.md).

---

## Rodada 1 — parecer independente

**Pesquisa externa considerada: SIM PARCIAL** — consultada em **2026-09-08**.

A parte externa cobre evolução compatível de APIs e padrões de upload por convidados. A decisão sobre eliminar o fallback para `requirementId` depende principalmente do modelo interno do repositório.

### Evidência externa

Fontes oficiais convergem em um ponto: tornar obrigatório um campo antes opcional é, formalmente, uma breaking change.

- O [Google AIP-180](https://google.aip.dev/180) considera compatível adicionar um campo de request somente quando clientes que o omitem continuam recebendo o comportamento anterior.
- A [política de breaking changes do LinkedIn](https://learn.microsoft.com/en-us/linkedin/shared/breaking-change-policy) classifica expressamente como breaking change adicionar campo obrigatório sem default e introduzir validação nova.
- A [política da API REST do GitHub](https://docs.github.com/en/rest/about-the-rest-api/breaking-changes) também classifica como breaking tanto tornar obrigatório um parâmetro opcional quanto adicionar nova validação; para sua API pública madura, usa nova versão e aviso prévio.

Essas fontes são representativas para compatibilidade de contratos HTTP: Google, GitHub e LinkedIn operam APIs públicas grandes e independentes de seus clientes. Elas determinam a classificação da mudança, mas não obrigam um produto ainda sem consumidores a sustentar indefinidamente um contrato defeituoso.

Quanto a precedentes específicos:

- A documentação oficial encontrada do [PandaDoc Collect Files](https://developers.pandadoc.com/changelog/editor-20-attachments-and-collect-file-fields) mostra upload pelo destinatário contextualizado por um campo configurado e atribuído ao recipient.
- O [Adobe Acrobat Sign](https://developer.adobe.com/acrobat-sign/docs/overview/developer_guide/apiusage) associa documentos a identificadores gerados pelo sistema dentro do workflow.
- **Não encontrei documentação oficial suficientemente específica de DocuSign, Dropbox Sign/HelloSign ou PandaDoc que demonstre uma migração de "tipo documental opcional" para "ID obrigatório" em upload anônimo.** Portanto, não alego que exista esse precedente.

### Sub-rubrica E-014 v1

| Peso | Critério | Atende | Não atende |
|---:|---|---|---|
| 30% | Integridade semântica | Todo `Document.documentTypeId` referencia um `DocumentType` real e `ACTIVE` no momento da criação | Persiste `requirementId` ou texto livre em atributo denominado `documentTypeId` |
| 20% | Descoberta e recuperabilidade guest | O guest consegue listar opções válidas e recebe erro estável para ID inválido/deprecated | O contrato exige um ID que o guest não consegue obter ou corrigir |
| 20% | Compatibilidade proporcional à evidência | A estratégia considera consumidores reais, telemetria e estágio do produto | Presume tráfego inexistente ou ignora consumidores comprovados |
| 15% | Consistência transacional | Catálogo, tenant, status e criação permanecem protegidos na mesma transação | Há TOCTOU entre descoberta/validação e persistência |
| 15% | Cutover verificável | Schema, handler, serviço, testes, documentação e ambiente `dev` mudam juntos; ausência do campo falha claramente | Mantém dois significados ou um fallback silencioso sem prazo |

### Recomendação: obrigatório agora

Adotar imediatamente `documentTypeId` obrigatório e remover `documentType` livre e o fallback para `requirementId`.

Razões: (1) o bloqueador funcional anterior (falta de descoberta) foi removido; (2) o fallback grava `requirementId` num atributo chamado `documentTypeId` sem integridade referencial — corrupção de significado tolerada, não um default válido; (3) manter opcional perpetua dois contratos incompatíveis; (4) uma janela de depreciação só tem valor quando existe alguém a migrar, e não há evidência de cliente externo real dependente da omissão hoje; (5) o projeto ainda não possui usuários reais nem produção — este é o momento de absorver a mudança e chegar ao lançamento com um contrato único e correto.

Tratada como **breaking change formal, mas cutover imediato operacionalmente justificável**. Condições concretas do cutover: `required:["fileName","documentTypeId","idempotencyKey"]`; remover `documentType` por completo; validar pertencimento ao tenant + `ACTIVE` na mesma transação; remover o fallback; atualizar testes de contrato/aplicação/idempotência; **definir política explícita de replay quando a mesma `idempotencyKey` reaparece com um `documentTypeId` diferente** (não retorno silencioso ambíguo); antes do deploy, checar objetivamente logs/telemetria disponíveis — se revelarem consumidor real omitindo o campo, essa evidência nova reabre a escolha; na ausência dela, cortar agora.

### Notas desta rodada (auto-avaliação do Codex)

- **Rigor de pesquisa/evidência E-014: 9,2/10**
- **Solidez da decisão: 9,5/10**
