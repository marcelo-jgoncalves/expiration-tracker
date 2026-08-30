# Multi-User B2B — Wave B2B-5, Rodada 3 — Proposta Claude (fecha os 3 pontos da Rodada 2, Codex 8,6/10)

## 1. Cap transacional, não check-then-act

Aceito integralmente: a invariante "no máximo 1 `Membership` `ACTIVE`/`SUSPENDED`" virou fundação arquitetural do `RequestContextResolver` (mudança B da Rodada 2) — não pode ficar best-effort.

**Mecanismo**: `GlobalUser` (já existente, B2B-2/D-087) ganha um novo atributo `hasCreatedOrganization?: boolean`, atualizado na MESMA `TransactWriteItems` de `CreateOrganizationService` via um `Update` condicionado (`attribute_not_exists(hasCreatedOrganization)`), ao lado dos 4 `Put`s já existentes (`Organization`+`Membership`+`TenantLifecycleRecord`+`TenantEntitlement`) — 5 itens atômicos, não 4. Duas chamadas concorrentes da mesma requisição HTTP: a que perder a condição do `Update` cancela a transação inteira (mesma semântica de corrida que `TenantBootstrapService`/`IdentityMapping.findOrCreate` já usam em outro lugar do código — reaproveita um padrão já aprovado, não inventa um novo).

**Mudança de contrato em `CreateOrganizationService` (D-091)**: refatoração aditiva, não uma mudança de comportamento para os chamadores existentes — separa "montar as entradas da transação" de "executar", expondo um método (`buildCreateEntries(input)`) que o `createOrganization(input)` público já existente passa a usar internamente (chama build + `store.transactWrite`, comportamento idêntico a hoje para qualquer chamador que não precise do cap). O novo fluxo de B2B-5 (`POST /bff/organizations`) usa `buildCreateEntries()` e acrescenta o 5º entry (`Update` do `hasCreatedOrganization`) antes de executar sua própria `transactWrite`. `CreateOrganizationService.createOrganization()` em si continua sem cap embutido — a decisão de "este chamador quer o cap" é do chamador (a rota HTTP de onboarding), não do serviço genérico de criação, preservando o motivo original de D-091 ("nenhum chamador concorrente mira o MESMO recurso" continua verdadeiro para o serviço genérico; só o novo fluxo HTTP de B2B-5 tem esse requisito extra).

`POST /bff/organizations` deixa de chamar `OnboardingStateResolver.resolve()` como pré-check-then-act (Rodada 2, mudança C) — em vez disso, tenta a transação de 5 itens diretamente; se o `Update` do `hasCreatedOrganization` falhar (`TransactionCanceledException` com esse cancellation reason específico), mapeia para `409`. `OnboardingStateResolver` deixa de ser pré-condição de escrita aqui (papel que nunca foi seu, é um classificador de leitura) — continua sendo usado só onde já fazia sentido: `GET /bff/session`/`handleCallback` (leitura, ponto 3 abaixo).

## 2. Semântica realista de recovery entre a tabela principal e a tabela de sessão BFF

Aceito a crítica: "mesma operação" era impreciso. `Organization`/`Membership`/`hasCreatedOrganization` vivem na tabela principal; `Session` vive na tabela dedicada da BFF (D-053/D-054) — não existe `TransactWriteItems` cruzando as duas.

**Contrato explícito**: `POST /bff/organizations` executa, em ordem:
1. `TransactWriteItems` de 5 itens na tabela principal (fonte de verdade, atômica, ponto 1 acima).
2. Se (1) sucede: `Update` OCC (mesma disciplina de toda mutação de sessão já aprovada em D-053/D-054) da `Session` gravando `activeOrganizationId`. Best-effort — se falhar (conflito de versão, timeout), a resposta HTTP ainda é `201 Created` (a organização existe de verdade, é o fato que importa) mas SEM a garantia de que a sessão já reflete isso.

**A tabela principal é sempre a fonte de verdade; `Session.activeOrganizationId` é só um cache/hint de UX para a BFF, nunca usado para autorização** (autorização real continua sendo o `RequestContextResolver` do lado do recurso, que rederiva via `queryGsi4()` independente da sessão, mudança B da Rodada 2 — uma sessão desatualizada não pode causar escalação de privilégio, só um soluço de UX). Isso torna a falha do passo 2 inofensiva por construção, não um estado inconsistente perigoso — fechado por completo pelo self-heal do ponto 3.

## 3. `GET /bff/session` (e `handleCallback`) fazem self-heal

Contrato final:

```text
Se session.activeOrganizationId presente → retorna como está (fast path, sem nenhuma
  chamada extra) — é só um hint, nunca fonte de autorização, então não precisa
  revalidar a cada leitura.
Senão → chama OnboardingStateResolver.resolve(userId):
  HAS_USABLE_MEMBERSHIP → deriva a organizationId (mesma hidratação de Membership única
    de B2B-5.3) → retorna { activeOrganizationId, onboardingState: undefined } na resposta
    IMEDIATAMENTE (o cliente nunca vê um estado inconsistente) → tenta gravar de volta na
    sessão via Update OCC, best-effort, sem bloquear a resposta nem falhar a requisição se
    o Update perder a corrida (próxima leitura tenta de novo - idempotente).
  outro estado → retorna { activeOrganizationId: undefined, onboardingState: <estado> }.
```

Isto fecha exatamente o cenário que o Codex nomeou (sessão sem `activeOrganizationId` mas `Membership` `ACTIVE` real já existe, por corrida do passo 2 do ponto 2 acima, ou por login numa segunda sessão/dispositivo depois que a organização já existia) — nunca deixa o usuário preso vendo "crie uma organização" quando já tem uma.

`handleCallback` (login) aplica a mesma lógica no momento da criação da sessão (não só em leituras posteriores via `GET /bff/session`) — já é o comportamento descrito na Rodada 2, mudança E, sem alteração aqui, só confirmado que usa a MESMA função de derivação/self-heal, não uma duplicata.

## 4. Granularidade de B2B-5.4 (achado "não bloqueador" do Codex) — compromisso explícito

Mantido como um item de trabalho coeso (fluxo BFF de onboarding é uma unidade de revisão natural, per `definition-of-done.md` "diff atomicamente revisável"), mas a linha `DoD:` ao fechar lista cada subparte reconhecível separadamente, não uma linha genérica:

```text
DoD: item=B2B-5.4 BFF onboarding flow;
  subpartes=[sessão identity-only + handleCallback (E), POST /bff/organizations + cap
  transacional (1/2), GET /bff/session self-heal (3)];
  risco=5 (gate real de login); evidência=<por subparte>; lacunas=<...>
```

## O que fica igual desde a Rodada 2

Mudanças A (remove `select` de B2B-5), B (desvio faseado nomeado, resolução de Membership única em B2B-5.3), F (assert de `ADMIN`) — sem objeção do Codex na Rodada 2, mantidas sem alteração.
