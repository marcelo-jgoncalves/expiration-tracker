# D-224 pending decision resolved: `documentTypeId` mandatory in guest submit-evidence schema (D-243)

**Status: APPROVED (design), NOT IMPLEMENTED.** Protocolo Claude↔Codex completo, 2 rodadas reais (`codex exec --skip-git-repo-check`), convergência na Rodada 2 (E-014 9,3/10, desenho 9,6/10, ambas ≥9,0 sem arredondar — Codex declarou `APROVADO`, Rodada 3 dispensada por acordo explícito).

## Contexto

D-173 (item 6, `estado-final-consolidado.md`) e D-184 nomearam esta questão como pendência de produto: `schemas/api/docarchive-guest-submit-evidence-request.v1.json` tem `documentType` (OPCIONAL, texto livre) — quando ausente, `submitEvidence()` (`guest-document-access-service.ts`) cai para `requirementId` sem validação nenhuma; D-184 rejeitou tornar obrigatório na época porque não existia mecanismo de descoberta para o guest saber qual `documentTypeId` era válido. D-224 construiu esse mecanismo: `GET /document-archive/guest/document-requests/{token}/document-types` (rota pública, lista só tipos `ACTIVE` do tenant do link), tornando a decisão estruturalmente viável nos dois sentidos e explicitamente NÃO decidindo-a. Marcelo delegou a decisão a este protocolo nesta sessão.

## Processo

- **Rodada 1 (blind, ambos os lados)**: Claude e Codex propuseram de forma independente, sem ver o parecer um do outro, per a disciplina anti-anchoring de `AGENTS.md` §4. Ver `round1-claude-proposal.md` e `round1-codex-blind-proposal.md`.
- **Rodada 2 (reconciliação)**: os dois pareceres foram revelados um ao outro; Codex criticou e sintetizou um desenho final conjunto. Ver `round2-reconciliation.md`.
- Ambos os lados convergiram **de forma independente e blind** na mesma recomendação final (obrigatório agora, corte único, sem coexistência) — o que é evidência forte de robustez da decisão, não coincidência de anchoring, já que nenhum dos dois viu o parecer do outro antes de propor.

## Declaração E-014 (pesquisa externa)

**SIM PARCIAL**, por ambos os lados, com fontes distintas e complementares:

- **Claude**: [Martin Fowler — Parallel Change](https://martinfowler.com/bliki/ParallelChange.html) (já citado por D-184, acesso 2026-09-02); [Speakeasy — Versioning Best Practices in REST API Design](https://www.speakeasy.com/api-design/versioning) (acesso 2026-09-08); [Aikido — Avoid breaking API contracts](https://www.aikido.dev/code-quality/rules/how-to-avoid-breaking-public-api-contracts-maintaining-backward-compatibility) (acesso 2026-09-08).
- **Codex**: [Google AIP-180 — Backwards compatibility](https://google.aip.dev/180) (acesso 2026-09-08); [LinkedIn — Breaking change policy](https://learn.microsoft.com/en-us/linkedin/shared/breaking-change-policy) (acesso 2026-09-08); [GitHub REST API — Breaking changes](https://docs.github.com/en/rest/about-the-rest-api/breaking-changes) (acesso 2026-09-08).
- Ambos os lados também pesquisaram precedente ESPECÍFICO de upload anônimo/guest (DocuSign, HelloSign/Dropbox Sign, PandaDoc) e **NENHUM encontrou documentação oficial mostrando uma migração real de "tipo documental opcional" para "ID obrigatório" nesses produtos** — Codex encontrou apenas material adjacente não equivalente ([PandaDoc Collect Files changelog](https://developers.pandadoc.com/changelog/editor-20-attachments-and-collect-file-fields), [Adobe Acrobat Sign developer guide](https://developer.adobe.com/acrobat-sign/docs/overview/developer_guide/apiusage)). **Registrado explicitamente como limitação real de pesquisa, não preenchido por analogia inventada** — mesma disciplina de D-225 (Box/Notion/Figma).
- Convergência das fontes gerais (Fowler, Speakeasy, Aikido, Google, LinkedIn, GitHub): tornar um campo opcional em obrigatório é formalmente uma breaking change, e o padrão estabelecido para APIs públicas maduras com consumidores reais é expand→contract com janela de depreciação. **Nenhuma dessas fontes trata do caso deste produto**: uma API sem consumidores de produção reais ainda.

## Decisão

**Opção (a): `documentTypeId` torna-se OBRIGATÓRIO agora, corte único, sem coexistência de campo, sem header de depreciação, sem janela de graça.**

### Por que agora, e por que corte único (não opção c/staged)

1. O bloqueador que impediu a decisão em D-184/D-175 (falta de mecanismo de descoberta) foi fechado por D-224 — o guest pode listar `documentTypeId`s `ACTIVE` do próprio tenant antes de submeter.
2. **Fato real confirmado por leitura direta do repositório, não presumido**: este produto não tem usuários reais nem ambiente de produção — `AGENTS.md` §1 declara isso canonicamente, `NEXT_SESSION_PROMPT.md` confirma estágio pré-lançamento, e não há nenhuma evidência em nenhum documento do projeto de um consumidor guest externo real dependendo do formato opcional atual hoje. O padrão de mercado (expand→contract com janela de meses) existe para proteger consumidores reais de uma mudança-surpresa; não há consumidor real a proteger aqui.
3. **Precedente direto já estabelecido neste mesmo repositório**: D-176 renomeou `Document.documentType`→`documentTypeId` ponta a ponta no caminho autenticado "sem coexistência de campo, sem shim de compat, per D-093" — mesma disciplina, mesmo módulo, aplicada agora ao único caminho (guest) que tinha sido deliberadamente deixado de fora por D-175/D-184 só por causa do gap de descoberta, gap esse que não existe mais.
4. O fallback atual (`input.documentType ?? requirementId`) grava um `requirementId` — identificador de uma entidade completamente diferente — no atributo físico `Document.documentTypeId`, sem nenhuma integridade referencial. Isso não é um "default razoável" a preservar; é uma corrupção de significado tolerada precisamente pela ausência histórica do mecanismo de descoberta, que D-224 já resolveu.
5. Cada dia que a decisão permanece aberta piora o cálculo de risco, nunca melhora: uma vez que links reais saiam para destinatários reais, uma futura obrigatoriedade deixaria de ser gratuita. Hoje ainda é.
6. Uma janela de depreciação (opção c) só tem valor real quando existe alguém de fato migrando — sem consumidor real, o mecanismo de aviso/sunset apenas adia uma decisão já madura e adiciona complexidade (headers `Deprecation`/`Sunset`, campo aceito nas duas formas por um período, lógica de fallback dupla) que este próprio repositório rejeita por princípio quando não há consumidor a proteger (D-093).

### Rejeitando (b) manter opcional

Perpetuaria permanentemente a mesma corrupção de significado do item 4 acima, e manteria o único caminho de escrita de `Document`/`DocumentTypeId` (guest) sem a integridade referencial que `createDocument()` (D-175) já impõe no caminho autenticado — uma assimetria sem justificativa técnica restante, já que o mecanismo de descoberta que a justificava (D-184's razão original) não existe mais.

## Desenho final aprovado (pronto para implementação futura, sem decisão adicional necessária)

Ver `round2-reconciliation.md` para o texto completo; resumo executável:

1. **Schema HTTP** (`schemas/api/docarchive-guest-submit-evidence-request.v1.json`): `documentTypeId` (renomeado de `documentType`) move para `required` (junto com `fileName`/`idempotencyKey`); `documentType` é removido por completo (rejeitado por `additionalProperties:false`). Arquivo continua `v1` — sem versão paralela, sem alias, sem período de aceitação dos dois nomes.
2. **Serviço** (`guest-document-access-service.ts`): `SubmitEvidenceInput.documentType` → `documentTypeId` (sem `?`); remover o fallback `?? requirementId` e o guard `documentTypeSupplied`; `ConditionCheck(DocumentType.status=ACTIVE)` (mesmo `buildExistenceConditionCheck`/`documentTypeKey` de D-175/D-184) passa a ser incondicional, sempre na posição `[0]` do array de `entries`; postura anti-enumeração preservada integralmente (mesmo `catch` genérico, `GuestAccessInvalidError` para tipo inexistente/`DEPRECATED`, TOCTOU-safe pela mesma transação).
3. **Política de replay (decisão nova, explícita)**: payload-agnostic, first-write-wins — preserva D-143 Decision 4/D-184 sem alteração; `idempotencyKey` identifica a operação lógica, um replay com `documentTypeId` diferente do original retorna o snapshot original sem revalidar nada.
4. **Testes**: checklist completo de 9 itens em `round2-reconciliation.md` §4 (HTTP 400 sem o campo, rejeição do nome antigo, sucesso com `ACTIVE`, rejeição uniforme para inexistente/`DEPRECATED`, G-V3 do `ConditionCheck`, 3 cenários de replay, remoção dos testes obsoletos do fallback antigo).
5. **Migração/rollout**: corte único, sem backfill de dados sintéticos de `dev`, sem reset automático no deploy; checagem de log/telemetria de `dev` recomendada como rede de segurança operacional, não como condição de aprovação.

## Notas finais do protocolo

| Rodada | Tipo | E-014 | Design | Resultado |
|---|---|---|---|---|
| 1 | Claude (blind) | 8,5/10 (auto) | 8,5/10 (auto) | Proposta independente registrada |
| 1 | Codex (blind) | 9,2/10 (auto) | 9,5/10 (auto) | Proposta independente registrada, convergiu com a de Claude sem tê-la visto |
| 2 | Reconciliação (Codex, com ambas as propostas reveladas) | **9,3/10** | **9,6/10** | **APROVADO — Rodada 3 dispensada por acordo explícito** |
| 2 | Claude (concorrência retrospectiva, após ler a Rodada 2 completa) | concorda | concorda, 9,4/10 retrospectivo | Nenhum ponto de discórdia remanescente |

Transcrições completas via `codex exec --skip-git-repo-check` no histórico de comandos desta sessão; prompts completos (Rodada 1 e Rodada 2) preservados no diretório de scratch da sessão, não persistidos como arquivo separado neste diretório (mesma prática de D-184: o design consolidado é a fonte única de verdade).

## Escopo desta sessão

Esta sessão fez **decisão + documentação apenas**. Nenhum código, schema ou infra foi alterado. A implementação do desenho acima (schema + serviço + testes) é a próxima fatia nomeada, nível 3-4 (implementação direta de decisão já `APPROVED`, protocolo Claude↔Codex dispensado por `AGENTS.md` §4) — não requer nova rodada de protocolo.
