# Quarantine/Recovery Window + LGPD Retention Gaps — Round 1 (Claude proposal)

## Escopo da decisão

Duas perguntas irmãs, mesmo mecanismo subjacente, tratadas em uma rodada só (Marcelo, 2026-08-31):

1. **Janela de quarentena/recuperação antes de exclusão física irreversível** — cross-cutting, não
   só para `Organization`/tenant. Hoje `CloseOrganizationService`/W3-07 só tem `Wait(1800s)` entre
   `DELETING→QUIESCING` (`infra/state-machines/tenant-purge.asl.json`) — operacional (drenar
   requests em voo antes do fence apertar), não uma janela de arrependimento: não existe ação real
   de "cancelar exclusão", e `TenantLifecycleStatus` é forward-only por design (`ACTIVE` nunca é
   reentrada — `tenant-lifecycle-record.ts` linha 27).
2. **7 de 9 `retentionClass` sem purga física real** (`docs/architecture/privacy-lgpd.md` §4) —
   verificado por leitura de código, não só do doc: `USER_DOCUMENT` tem `DocumentPurgeWorker`
   (W3-06) e `EXTRACTION_TRANSIENT` tem lifecycle S3 de 24h; `TRANSIENT`/`InvitationTokenPointer`
   já tem `purgeAfterTtl` físico real (`invitation-token.ts`). `ACCOUNT_ACTIVE`/`CORE_USER_DATA` são
   varridas fisicamente hoje SÓ no caso de fechamento de tenant inteiro (`purgeTenant()`/W3-07) —
   **não há purga por idade dentro de um tenant `ACTIVE`** (ex.: um `DELIVERY_RECORD` individual não
   é apagado aos 180 dias enquanto a Organization segue aberta). `LEGAL_EVIDENCE`,
   `SECURITY_AUDIT`, `QUOTA_TELEMETRY` não têm nenhum worker de purga por idade. Confirmado por
   grep: nenhum cron/scheduler além de `tenant-purge-sweeper` (pós-`DELETED`) e o TTL nativo do
   DynamoDB usado só por `InvitationTokenPointer`.

**Fora de escopo desta rodada** (explícito, não implícito): (a) a duração/janela operacional de
1800s já `APPROVED` D-066 Rodada H — não redecidida; (b) implementação de todos os 7 workers de
purga por classe — esta rodada decide MECANISMO + PRIORIZAÇÃO, não entrega os 7; (c) a futura
feature de armazenamento de arquivos — ainda não escopada, esta rodada só garante que o mecanismo
de quarentena decidido é genérico o bastante para ela reusar depois, sem desenhar a feature em si.

## Pesquisa externa considerada: SIM

Padrão bem estabelecido fora deste projeto — janela de recuperação antes de exclusão física
definitiva é uma prática amplamente convergente em produtos B2B/SaaS:

- **GitHub** (`docs.github.com/en/repositories/creating-and-managing-repositories/restoring-a-deleted-repository`,
  acessado 2026-08-31): repositório deletado é restaurável por **90 dias**; após isso, apagado
  permanentemente, sem bypass self-service (só suporte, caso a caso). Restauração cobre org owners
  para repos da organização, não só o autor.
- **AWS** (`docs.aws.amazon.com/accounts/latest/reference/manage-acct-closing.html`, acessado
  2026-08-31): conta fechada entra em "post-closure period" de **90 dias**, reabrível nesse prazo;
  recursos remanescentes são apagados automaticamente só depois de decorridos os 90 dias.
- **Google Workspace** (`workspace.google.com/learn-more/security/security-whitepaper/data-recovery`,
  acessado 2026-08-31): usuário deletado é restaurável por administrador por **20 dias**; dados de
  Drive/Gmail especificamente por até 25 dias. Janela mais curta que GitHub/AWS, mesma família de
  padrão (ação administrativa explícita de restauração dentro de um prazo fixo, depois disso
  irrecuperável mesmo via suporte).
- **Slack** (`slack.com/help/articles/203457187-Customize-data-retention-in-Slack`, acessado
  2026-08-31): arquivos sem compartilhamento têm grace period de **30 dias** antes de apagados
  definitivamente — dado adicional convergente, não sobre exclusão de workspace inteiro.

Convergência real: 3 de 4 fontes (GitHub, AWS, e o precedente-irmão Slack-arquivo) usam algo entre
30-90 dias; Google Workspace é o outlier mais curto (20-25 dias), mas ainda na mesma ordem de
grandeza (dias-a-semanas, nunca minutos/horas, nunca ilimitado). Nenhuma fonte usa quarentena
medida em segundos/minutos para dado genuinamente persistido (todas usam o Wait(1800s) atual só
para o problema operacional distinto de drenar requests em voo).

## Checklist de critérios de nota (derivado da pesquisa)

```text
1. (peso 25%) Duração da quarentena escolhida cita a pesquisa real (não um número arbitrário) e cai
   dentro ou justifica desvio da faixa convergente (20-90 dias) — não pode ser um valor sem
   fundamento externo nem interno.
2. (peso 20%) Mecanismo é genuinamente cross-cutting (nomeado como política reusável por qualquer
   feature futura de "dado persistido + exclusão irreversível", não hardcoded só para
   Organization/W3-07) sem exigir reescrever o pipeline atual de W3-07 do zero.
3. (peso 20%) Ação real de "cancelar exclusão" é decidida explicitamente (existe ou não, e por
   quê) — não pode ficar ambíguo se um OWNER que erra tem como voltar atrás.
4. (peso 15%) Prioridade das 7 classes LGPD é justificada por sensibilidade/exposição real
   (dado pessoal identificável vs. telemetria agregada) e por sinal já registrado no próprio
   `privacy-lgpd.md` (ex. `LEGAL_EVIDENCE` tem trava jurídica adicional, não é "purge simples"),
   não por ordem alfabética/arbitrária.
5. (peso 10%) Não reabre nenhuma decisão já `APPROVED` (D-066/D-067 duração de 1800s, D-121/D-124
   mecanismo do orquestrador W3-07) — estende, não substitui.
6. (peso 10%) Escopo de implementação desta sessão é decidido explicitamente (design-only vs.
   tratável no mesmo dia) com critério objetivo, não "parece grande" sem justificativa.
```

## Proposta

### 1. Mecanismo de quarentena (cross-cutting)

**Novo estado `HELD_FOR_RECOVERY`, inserido entre `DELETING` e `QUIESCING`** no lifecycle de
qualquer entidade que declare "dado persistido + exclusão irreversível" — hoje só
`TenantLifecycleRecord`/W3-07 tem esse lifecycle real; o desenho é feito para ser o padrão que a
futura feature de arquivos (e qualquer feature seguinte da mesma classe) reusa sem reinventar.

- **Transição**: `ACTIVE → HELD_FOR_RECOVERY` (era `ACTIVE → DELETING` direto). `DELETING` passa a
  significar exclusividade "o operador confirmou, quarentena venceu, purga física em curso" — não
  mais o primeiro passo.
- **Duração**: **30 dias** — dentro da faixa convergente da pesquisa (20-90d), no ponto médio,
  consistente com o próprio `privacy-lgpd.md` §4 já usar "30 dias" como prazo padrão default em 2
  das 9 classes (`ACCOUNT_ACTIVE`, `CORE_USER_DATA`) — reuso de um número que já é norma interna do
  projeto, não um valor novo importado sem conexão com o resto do sistema.
- **Ação real de cancelamento**: **existe** — novo `CancelOrganizationClosureService`/ação
  `organization:cancel-close` (mesmo tier `OWNER_ROLES` de `organization:close`), transição
  `HELD_FOR_RECOVERY → ACTIVE` (única exceção ao "ACTIVE nunca é reentrada" documentado em
  `tenant-lifecycle-record.ts` — o comentário original previu certo o desenho pré-quarentena, esta
  rodada o substitui deliberadamente, não o contradiz por descuido). Sem essa ação real, a
  "quarentena" seria só um atraso, não uma janela de recuperação de fato — o próprio motivo que
  levou Marcelo a levantar o achado.
- **Implementação AWS**: reusa o mesmo Step Functions já existente (`tenant-purge.asl.json`) — o
  `Wait(1800s)` atual desloca de posição (passa a rodar DEPOIS de `HELD_FOR_RECOVERY→DELETING`,
  mantendo seu propósito operacional intacto) e um novo `Wait` de 30 dias (`Timestamp`/`Seconds:
  2592000` — Step Functions suporta waits de até 1 ano) entra antes. Nenhum novo serviço AWS.
- **Generalização**: o par de estados (`HELD_FOR_RECOVERY` + duração configurável + ação de cancel)
  é documentado como o padrão a seguir por qualquer lifecycle futuro de exclusão irreversível — não
  uma classe TypeScript compartilhada prematura (a feature de arquivos nem existe ainda para saber
  a forma real do reuso de código; documentar o PADRÃO agora, herdar a implementação depois, é
  proporcional ao que se sabe hoje — mesmo raciocínio já usado em B2B-3 para adiar
  `ownerCount`).

### 2. Priorização das 7 classes LGPD sem purga física real

Ordem de prioridade (maior exposição/sensibilidade primeiro), critério: dado pessoal
identificável diretamente exposto a um titular vs. dado agregado/técnico:

1. **`CORE_USER_DATA`** (itens/políticas/ocorrências dentro de tenant `ACTIVE`) — maior volume de
   dado pessoal do produto, sem purga por idade hoje fora do fechamento de tenant.
2. **`DELIVERY_RECORD`** (intents/attempts, 180 dias) — prazo já definido e vencendo continuamente
   desde o M10 (import) e M7 (extração) irem a produção; sem worker, o gap cresce todo dia.
3. **`SECURITY_AUDIT`** (AuditEvent/logs, 365 dias) — maior volume acumulado ao longo do tempo
   (evento por mutação sensível), mas exposição pessoal menor que 1/2 (metadado de auditoria, não
   o próprio dado de negócio).
4. **`LEGAL_EVIDENCE`** — sensibilidade alta, mas propositalmente a mais lenta de implementar
   (exige aprovação jurídica/KMS independente/Object Lock por design já `APPROVED`) — não é
   proporcional adiantar a implementação técnica antes da trava jurídica estar clara.
5. **`QUOTA_TELEMETRY`** — dado identificável mas de baixa sensibilidade (métrica de uso).
6. **`ACCOUNT_ACTIVE`** (fora do caso de fechamento de tenant) — na prática, "encerramento + 30
   dias" para `Membership`/`Invitation`/`Channel` individuais dentro de um tenant que segue ativo
   (ex. um convite expirado, um membro removido) é o gap real remanescente aqui, menor volume que
   os 5 acima.
7. **`TRANSIENT`** — a classe já tem um exemplo físico real (`InvitationTokenPointer`); os
   remanescentes (`WebhookInbox`, `UploadSlot`) são o menor risco (dado de trabalho de curtíssima
   vida, 7 dias/24h) — última prioridade porque a exposição residual é a mais baixa da lista.

### Escopo explícito de implementação desta rodada

**Mecanismo de quarentena**: candidato a implementação direta na mesma sessão se o design for
`APPROVED` — critério objetivo: reusa a máquina de estados/Lambdas já existentes do W3-07
(D-124), adiciona 1 estado + 1 `Wait` + 1 service novo (mesmo padrão de `CloseOrganizationService`)
+ 1 rota HTTP + 1 ação RBAC. Escopo comparável a D-125 (reatribuição), que foi implementado no
mesmo dia do design.

**7 workers de purga LGPD por classe**: **fora de escopo de implementação desta sessão** —
7 workers reais (scan/scheduler/lifecycle por classe) é ordem de grandeza maior que qualquer wave
anterior implementada em um único dia (compare com W3-06/`DocumentPurgeWorker`, que sozinho foi
uma wave dedicada). Esta rodada entrega design + priorização; implementação fica para sessões
futuras, uma classe por vez, na ordem acima — mesmo padrão usado para D-121→D-124 vs. deixar as 7
classes como trabalho futuro nomeado.
