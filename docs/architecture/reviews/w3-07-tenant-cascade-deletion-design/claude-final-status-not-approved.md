# W3-07 — Status final: REPROVADO, NÃO IMPLEMENTADO (2026-08-28)

> D-062 em `docs/architecture/decisions-log.md`. Este documento resume o resultado das 4
> rodadas para quem retomar este trabalho no futuro — não reabrir o protocolo do zero sem ler
> isto primeiro.

## Resultado

4 rodadas Claude↔Codex, notas **3,4 → 5,1 → 4,7 / 10** — nunca atingiu o gate de 9,0. Reprovado
por decisão do Marcelo, seguindo recomendação convergente e independente de Claude e Codex
(pedida explicitamente após a Rodada 3): **não implementar agora**, registrar os achados como
pesquisa.

## Por que não convergiu (o achado central)

Toda tentativa de fechar "COMPLETED" com garantia real de não-ressurreição (um dado do tenant
sendo recriado depois de uma exclusão já declarada concluída) esbarrou na mesma parede: o
sistema tem **três classes de escritor** que uma pré-condição simples (ex.: desativar login no
Cognito) não fecha:

1. HTTP autenticado (fechável via Cognito).
2. **Superfície pública de guest upload** (`GuestSubmissionService` — nunca passa por
   `RequestContext`/Cognito, autentica só por token opaco).
3. **Workers assíncronos** já enfileirados ou agendados independentemente de qualquer sessão de
   usuário (`reminder-materialization-trigger`, `reminder-reconciliation`,
   `document-chasing-dispatch`, outbox relay/sweeper, callback SES, reconciliação de
   upload/malware, import, extração/OCR via Step Functions).

Fechar as três de verdade exige um fence de `TenantStatus` consultado por **todo** esses
caminhos — não é mais "o mecanismo de descoberta+exclusão", é a mesma feature de "bloqueio
imediato" que a decisão de escopo original desta sessão já tinha deixado de fora
deliberadamente. As duas decisões de escopo (mecanismo pequeno vs. sem bloqueio imediato) são
mutuamente incompatíveis com uma garantia forte — não dá para ter as duas.

## Por que não foi aceito um "best-effort documentado" como meio-termo

Recomendação explícita do Codex, aceita: implementar um mecanismo que alega apagar
fisicamente mas não sustenta essa garantia é uma capacidade **pior que não ter nenhuma** — pode
ser lido operacionalmente como "DSR atendido" mesmo com uma ressalva no `decisions-log.md`, e
ainda geraria código que precisaria ser redesenhado quando a garantia real for exigida de
verdade.

## O que sobrevive desta pesquisa (reusar, não redescobrir)

- **Inventário verificado dos 40 `entityType` reais** do sistema (`src/modules/**`), com
  classificação por presença de `version`/`tenantId` — ver Rodada 3/4
  (`claude-proposal-round3.md`/`round4.md`) para a tabela completa e as correções feitas em
  cima da própria Rodada 2 (que também errou o inventário na primeira tentativa — dois erros
  reais de levantamento em rodadas diferentes, lição: sempre grep exaustivo, nunca amostra).
- **Bug real descoberto, não corrigido ainda**: `tenantId` (MVP `tenantId=userId`) não é o
  Cognito `sub`/`Username` — `IdentityMapping.cognitoSub`/`User.identitySubject` são os campos
  certos. Qualquer ação administrativa futura no Cognito por tenant precisa resolver isso
  primeiro.
- **Achado estrutural**: `Session`/`LoginAttempt`/`DeviceSession` vivem em
  `bff-session-table`, uma tabela DynamoDB física separada — nenhum mecanismo de descoberta
  tenant-wide pode assumir uma única tabela.
- **Correção mecânica pendente, independente**: `PolicyRef` (`reminder-policy.ts:69-72`) não
  carrega `tenantId` — pequena, real, trivial de corrigir numa sessão futura sem depender de
  W3-07.
- **Reuso já decidido para quando retomar**: `Document` continua a única categoria com efeito
  colateral S3 real — reusar o `DocumentPurgeWorker`/GSI6 já aprovado (D-061), nunca duplicar.

## Gatilho para retomar

Requisito real de DSR (idealmente decidido antes do primeiro cliente B2B que dependa disso).
Quando retomado, o fence de `TenantStatus` em todo write path (HTTP + guest + workers) deve
entrar no escopo do **primeiro** desenho, não ser descoberto de novo rodada a rodada como
aconteceu aqui.
