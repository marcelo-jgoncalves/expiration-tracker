---
status: approved
owner: Marcelo
authority: decisão de arquitetura via protocolo Claude↔Codex completo (AGENTS.md §4) — fecha o gap real registrado em D-047, nível 5-6 da escala de risco (segurança/modelo de dados)
---

# Fecha D-047 — Entrega/reenvio do link de guest upload (rotação vs. secret cifrado)

Decisão nova, fora do escopo original de D-037 (cluster 2, guest upload) e D-039 (cluster 4,
automated chasing) — nenhum dos dois designs endereçava como o link/token chega ao destinatário
externo, nem no convite inicial nem no reenvio automático que chasing exige. Protocolo
Claude↔Codex completo via MCP, sandbox read-only, 3 rodadas reais.

**Nota final: Claude 9,2 / Codex 9,4 — gate ≥9,0 atingido por ambos os lados, sem arredondar.**

## Processo

- **Rodada 1**: convergência forte, cada lado chegando à mesma conclusão de forma independente
  (Claude formou sua posição antes de ler a resposta do Codex): rotacionar o token a cada envio
  automático em vez de persistir o `secret` cifrado. Codex respondeu com precisão técnica à
  pergunta real do Marcelo sobre chave KMS padrão, com fontes: AWS managed keys (`aws/...`) não
  são invocáveis diretamente por `kms:Encrypt`/`Decrypt` arbitrário de código de aplicação — só
  via `kms:ViaService` pelo serviço AWS integrado que as criou (confirmado contra a documentação
  AWS KMS). Como a rota escolhida (rotação) não usa KMS, a pergunta fica resolvida por
  eliminação — nenhuma chave, padrão ou nova, é necessária.
- **Rodada 2**: Claude trouxe 3 achados reais verificados no código (não especulação): (1) a
  tabela DynamoDB tem TTL nativo configurado no atributo `purgeAfterTtl`
  (`infra/modules/dynamo-table/main.tf`), mas `GuestTokenPointer`/`GuestTokenRateLimit` (cluster 2,
  já commitado) nunca setam esse atributo — são linhas permanentes hoje, bug operacional
  pré-existente que rotação para chasing multiplicaria; (2) o tier `EXPIRED` estava
  underspecified nas duas propostas — rotacionar depois do `deadline`/`tokenExpiresAt` reabriria
  implicitamente uma janela que o design já fechou deliberadamente; (3) automatizar o convite
  inicial (não decidido, mas mencionado como possível) seria a primeira vez que o sistema envia
  e-mail não-solicitado para um endereço externo arbitrário sem verificação de propriedade —
  vetor de abuso não avaliado em D-037. Codex concordou com os 3, corrigiu tecnicamente o fix de
  TTL (DynamoDB exige epoch seconds numérico, não a cópia direta do ISO string que a formulação
  inicial sugeria), e propôs `requestedByUserId` do `DocumentRequest` como alvo v1 do tier
  `EXPIRED` (não há campo de responsável em `RequirementAssignment` hoje, verificado no código).
- **Rodada 3**: Claude propôs separar isto em duas decisões com autorização distinta em vez de
  uma decisão só — Codex concordou e subiu a nota final (9,3→9,4) porque a separação resolve o
  próprio residual que tinha impedido uma nota maior na rodada 2.

## Decisão final

### Decisão A — CD-047-A: rotação de token para chasing — APROVADA, pronta para implementar

Nenhuma chave KMS, nenhum secret cifrado persistido. Semântica completa:

- A cada disparo de chasing (T-7/T-3, antes do deadline), o worker de dispatch/delivery chama
  `issueGuestToken()` (já existente, `domain/guest-token.ts`) e, na MESMA transação: cria um novo
  `GuestTokenPointer` (Put) e atualiza `DocumentRequest.tokenSelectorHash`/`tokenVersion += 1`/
  `tokenExpiresAt = min(now+14d, deadline)` (mesma fórmula já usada na criação, D-037). O `secret`
  novo só existe em memória entre a geração e o envio SES — nunca persistido, mesmo padrão já
  correto do cluster 2.
- **Rotação acontece no worker de dispatch/delivery, imediatamente antes do envio SES** — nunca
  no materializer/producer (que só decide QUANDO, não gera segredo).
- Pointers antigos **não são revogados ativamente** — argumento decisivo do Codex: revogar antes
  de confirmação de entrega criaria uma falha ruim (SES falha/fica `UNKNOWN` e o link antigo já
  foi invalidado, sem um novo confirmado). Expiram pela própria `expiresAt`/`deadline` (já
  verificado por `resolveToken()`, defesa em profundidade dupla desde a correção de segurança do
  cluster 2). **Overlap de múltiplos links válidos é aceito, mas só até o `deadline`/status
  terminal** — depois disso, overlap seria reabertura implícita, não aceito.
- **Tier `EXPIRED` nunca rotaciona nem envia link externo funcional** (o `deadline` já passou,
  por design) — em vez disso, notifica o usuário interno via `DocumentRequest.requestedByUserId`
  (não existe campo de responsável em `RequirementAssignment` hoje — verificado no código,
  `requestedByUserId` é o fallback v1 real).
- **Pré-requisito de implementação, não bloqueador da decisão**: corrigir o bug de TTL físico
  faltante em `GuestTokenPointer`/`GuestTokenRateLimit` antes de implementar rotação (rotação sem
  esse fix multiplica o acúmulo de linhas mortas por até 3× por `DocumentRequest`) — feito nesta
  mesma sessão, ver commit seguinte a este documento.
- Templates (`email-templates.ts`, extensão do mecanismo já existente, nunca motor novo, per
  D-039): `document-request-chasing` v1, reaproveitando o SES adapter existente sem modificá-lo.

### Decisão B — automatizar o convite inicial do cluster 2 (hoje manual) — NÃO APROVADA NESTE DOCUMENTO, exige decisão explícita do Marcelo antes de implementar

**Atualização (2026-08-23): Marcelo delegou esta decisão ao protocolo Claude↔Codex — APROVADA
separadamente em `14-document-request-initial-invite-design.md` (D-049).** O texto original desta
seção permanece abaixo como histórico do raciocínio que levou a não aprovar unilateralmente.

Mesmo com o mesmo padrão técnico seguro (rotação, sem secret persistido) e mesmo atrás de um kill
switch `default=false` (análogo a `extraction_pipeline_enabled` do M7), esta é uma decisão de
**comportamento de produto/comunicação externa**, não de mecanismo — o sistema passaria a enviar
e-mail não-solicitado a um endereço que o tenant não precisa comprovar que controla, em nome do
tenant. Um tenant pode ter razão deliberada para preferir entrega manual (compliance, tom de voz,
controle da própria comunicação com o fornecedor) — só o Marcelo pode avaliar isso. Requisito
arquitetural mínimo já registrado para quando/se for aprovada: mesmo padrão de rotação/sem secret
persistido, mesmo SES/templates versionados, rate limit e trilha de auditoria por tenant, kill
switch. **Nenhum código desta decisão B foi ou deve ser escrito sem essa confirmação.**

## Próxima ação

Decisão A libera a implementação real de cluster 4 (automated chasing) seguindo o design já
aprovado em D-039 + esta decisão de entrega. Decisão B fica registrada como pendência de produto,
não de engenharia — perguntar ao Marcelo quando ele estiver disponível, sem bloquear cluster 4.
