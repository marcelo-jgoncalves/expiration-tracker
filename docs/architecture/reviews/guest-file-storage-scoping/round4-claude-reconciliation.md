# Rodada 4 — Reconciliação final Claude: race presign/TIMEOUT

Nota Rodada 3 (Codex, blind): 8,8/10 NEEDS FIXES — 8/9 achados fechados, 1 residual: um PUT que
começa perto do deadline (ou cujo evento S3 chega tarde) pode perder a corrida contra o worker de
reconciliação, que já terá marcado `TIMEOUT` por `GSI8SK < now`. Margem fixa de 5s reduz a
probabilidade mas não fecha a invariante.

## Correção: confirmação pós-PUT que estende o deadline, sem tocar no pipeline de scan

Novo método guest, mínimo e de escopo estreito: `confirmUploadInFlight(sessionToken, fileId,
idempotencyKey)`. Chamado pelo frontend IMEDIATAMENTE após o S3 responder 200 ao PUT — evidência
real de que os bytes chegaram, não uma suposição de tempo.

**O que faz (e o que deliberadamente NÃO faz)**: uma única `Update` transacional (OCC) no
`DocumentFile`, condicionada a `scanStatus = PENDING_UPLOAD AND deadlineExtended <> true`:
- Reseta `GSI8SK`/`dueAtIso` para `now + FILE_SCAN_TIMEOUT_SECONDS` (reaproveita
  `deriveDocumentFileMaintenanceDue({ scanStatus: "PENDING_UPLOAD", createdAt: now })` — a MESMA
  função pura, só chamada com um `createdAt` mais recente).
- Marca `deadlineExtended: true` — a condição `<> true` garante extensão NO MÁXIMO UMA VEZ por
  arquivo (fecha o vetor de abuso "guest chama isso em loop para manter reserva de quota presa
  para sempre").
- **Nunca** toca `scanStatus`, nunca chama `applyFileScanResult()`, nunca lê o S3. Não interage
  com o gate STARTER/PROMOTER (`document-archive-activation.ts`) porque não decide nem observa
  nada sobre o resultado do scan — só dá ao pipeline assíncrono (que já existe, independente desta
  mudança) tempo real adicional antes que o reconciliador possa declarar `TIMEOUT`. Se as flags
  continuarem desligadas, o comportamento é idêntico a hoje (arquivo eventualmente `TIMEOUT`,
  só que mais tarde) — não muda a decisão já tomada sobre a ativação.

**Por que isso fecha a race real**: o cenário do Codex (PUT inicia perto do deadline original, S3
valida a expiração só no início da requisição, o worker de reconciliação já rodou antes do evento
físico chegar) exige que o worker rode DEPOIS que o guest já tem confirmação de 200 do S3 mas
ANTES da chamada de `confirmUploadInFlight` chegar ao DynamoDB — uma janela de milissegundos
(network round-trip do próprio browser), não mais os ~600s inteiros do presign. A chamada é
disparada de imediato, sem esperar interação do usuário, e é idempotente (condição já cumprida =
sucesso silencioso, nunca erro).

**Se a condição falhar** (ou porque já passou de `TIMEOUT` antes da extensão chegar, ou porque já
foi estendido antes): resposta genérica "conflito, tente novamente" — mesmo colapso
anti-enumeração do resto do módulo, nunca vaza `scanStatus`.

**Consistência de resposta atualizada**: `submitEvidence()` retorna, além de `uploadUrl`/
`requiredHeaders`, `fileId` (necessário para o guest referenciar o ack — hoje ausente do contrato,
correção adicional desta rodada). Fluxo do frontend (G02): submit → (se `uploadUrl` presente) PUT
→ (se PUT retornar 2xx) `confirmUploadInFlight` → SÓ ENTÃO copy de sucesso. Se `confirmUploadInFlight`
falhar, mesma copy neutra de expiração já definida na Rodada 3 (nunca reafirma sucesso que não foi
confirmado).

## Escopo/infra desta correção

- Domínio: `document-file.ts` ganha `deadlineExtended?: boolean` no `DocumentFile` (campo esparso,
  ausente = `false`, mesma disciplina de campos opcionais já usada no arquivo).
- Serviço: novo método em `guest-document-access-service.ts`, mesma resolução de sessão de
  `submitEvidence()` (reaproveitada, não duplicada).
- HTTP: nova rota guest (`POST .../uploads/{fileId}/confirm` ou equivalente — nome exato decidido
  na implementação, seguindo a convenção de rota já usada pelas outras rotas guest deste módulo).
- **Nenhuma mudança de infraestrutura/IAM além do que as rodadas anteriores já cobrem** — esta
  correção é só DynamoDB (mesma tabela, mesma policy já concedida), nunca toca S3.

## Pedido final ao Codex

Reavalie com esta correção. Se ≥9,0, `APPROVED`. Se ainda houver uma janela residual real
(diferente de "teoricamente qualquer sistema distribuído tem uma janela"), diga o cenário concreto
específico que ainda quebra.
