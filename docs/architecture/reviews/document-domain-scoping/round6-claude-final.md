# Document Domain — Rodada 6 (Fechamento Claude)

Resposta ao único bloqueio restante da Rodada 5 (nota 8,8/10, REABRIR) — os outros 3 pontos foram confirmados fechados pelo próprio Codex (condição idempotente, lista de 10 ações, `materializeAttempt`).

## Retenção — sub-prazos assumidos explicitamente como decisão NOVA, não herança

Aceito integralmente: `privacy-lgpd.md` §4 atribui "runs falhos/descartados: 7 dias" a `ExtractionRun`, não a `DocumentVersion`/`DocumentFile`; e não existe texto normativo aplicável a `RequestAccessCredential`/`GuestSession` além do padrão genérico de `TRANSIENT` (7 dias). Corrigido, sem inventar herança:

| Entidade | Classe (`privacy-lgpd.md` §4, correta e mantida da Rodada 5) | Prazo |
|---|---|---|
| `Document`, `DocumentVersion`, `DocumentFile` — **`ACCEPTED`/`SUPERSEDED`** | `USER_DOCUMENT` | prazo geral da classe: exclusão/encerramento de tenant + 30 dias |
| `DocumentVersion`, `DocumentFile` — **`REJECTED`/`WITHDRAWN`** | `USER_DOCUMENT` | **decisão nova desta rodada** (não herdada de "runs falhos" — aceito o achado): 7 dias após `rejectedAt`/`withdrawnAt`, escolhido por analogia deliberada ao subprazo mais curto já existente na mesma classe para artefato descartado, e registrado aqui como extensão explícita a `privacy-lgpd.md` §4, não como algo "já existente" |
| `DocumentVersionEvent`, `DocumentRequestEvent` | `SECURITY_AUDIT` | prazo geral da classe: criação + 365 dias (sem mudança, já estava correto) |
| `RequestAccessCredential`, `GuestSession` | `TRANSIENT` | **decisão nova desta rodada**: prazo genérico literal da classe (7 dias após expiração/revogação) — abandonado o subprazo de 14 dias por analogia a `InvitationTokenPointer`, que o Codex corretamente apontou como extensão não fundamentada; usar o valor padrão já normativo da própria classe é mais simples e não exige nova justificativa |

Correção editorial: "5 classes já normativas" (Rodada 5) estava errado — `privacy-lgpd.md` §4 define **9** classes; esta proposta usa **3** delas (`USER_DOCUMENT`, `SECURITY_AUDIT`, `TRANSIENT`), todas com prazo geral aplicado sem modificação, exceto o único subprazo novo (`REJECTED`/`WITHDRAWN`→7 dias), nomeado como tal.

**Ação de implementação nomeada** (fora desta rodada de arquitetura, registrada para a sessão de implementação): `docs/architecture/privacy-lgpd.md` §4 precisa ganhar uma linha própria para esse subprazo novo de `USER_DOCUMENT` (`REJECTED`/`WITHDRAWN` de documento operacional: 7 dias), analogamente a como "runs falhos/descartados" já é um subprazo nomeado dentro da mesma classe — não é uma classe nova, é uma entrada nova dentro de uma classe existente, e o documento canônico deve refletir isso explicitamente quando a implementação real acontecer.

---

Nenhum outro ponto reaberto. Itens fora de escopo inalterados desde a Rodada 1.
