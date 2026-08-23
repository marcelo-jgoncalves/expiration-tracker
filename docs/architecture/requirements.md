# Requirements — Plataforma de Controle de Vencimentos

Status: **FASE 1 APPROVED** — consenso Claude ↔ Codex após 4 rodadas de debate + avaliação independente pela fitness function (Claude 9.16 / Codex 9.03, ambos ≥ 9.0, nenhum gate violado).
Base: `docs/00-prompt-mestre.md` (seções 4–8, 16), `quality-criteria.md`, `fitness-function.md`.

## Histórico do debate (Fase 1)
- **Rodada 1** — Claude produziu proposta inicial completa (FR/NFR/SEC/PRIV/COST/SCALE/OPS/Future/Constraints/Assumptions/Unknowns/Non-goals). Codex criticou de forma independente: 10 problemas acionáveis (método de nota ausente, G4/G5/G6 sem critérios objetivos, precedência de gates não formalizada, rastreabilidade quebrada, contradição em SEC-010, requisitos de segurança faltando, termos não mensuráveis, cobertura de idempotência insuficiente).
- **Rodada 2** — Claude incorporou os 10 pontos: FR-043/FR-044 reescritos com fail-closed objetivo e trilha de auditoria; SCALE-004 com definição objetiva de tenant e gatilho não circular para G5; COST-004/COST-005 com critérios de aceite verificáveis para G6; nova seção 13 com rubrica de nota e precedência de gates; SEC-010 sem exceção de "plano de mitigação"; SEC-003/SEC-003a/SEC-007 reforçados; termos vagos (idle, presigned, reconciliação) substituídos por definições operacionais ou remetidos a artefato futuro obrigatório; NFR-002/FR-014 com cobertura ampliada de idempotência/atomicidade; Future Requirements com IDs (FUT-xxx); mapeamento de rastreabilidade corrigido.
- **Rodada 3** — Codex validou 9 dos 10 pontos como RESOLVIDO; apontou uma contradição textual remanescente em FR-014 (permitir entrega vs. proibir dado obsoleto). Claude corrigiu FR-014: cancelamento é a política padrão sempre que houver tempo hábil; entrega já efetivada externamente antes da mudança gera notificação corretiva automática — nunca entrega silenciosa de dado obsoleto sem tentativa de cancelamento.
- **Avaliação independente (gate de Fase, exigido pelo usuário)** — Claude: Overall 9.16 (nota própria, registrada antes de ver a do Codex). Codex, às cegas: Overall 8.7 (pontos fracos identificados: PRIV sem prazos concretos, custo/escalabilidade sem números — esperado nesta fase —, governança de IA sem métricas de precisão/recall/calibração exigidas, extensibilidade sem teste de contrato exigido, manutenibilidade sem versionamento explícito de contratos). **STATUS: NOT APPROVED** (Codex < 9.0) — nova rodada obrigatória, conforme regra do usuário de não avançar de fase sem nota mínima 9.0 de ambos.
- **Rodada 4** — Claude fechou as lacunas acionáveis apontadas pelo Codex: PRIV-003/004/005/006 com prazos e artefatos concretos; FR-042 com exigência de métricas de precisão/recall/calibração por tipo documental; FR-033 com exigência de contract test por adapter/provider; NFR-033 (novo) exigindo versionamento explícito de contratos/schemas com política de depreciação. Codex reavaliou às cegas: **Overall 9.03**, nenhum gate violado, sugerindo apenas dois ajustes de baixo custo (teto numérico em PRIV-003 e PRIV-006). Claude aplicou ambos (30 dias corridos para atendimento efetivo do titular; teto de 90 dias para propagação de exclusão a backups).
- **Resultado final** — Claude: Overall 9.16 (nota própria da Rodada 2, mantida — os ajustes da Rodada 4 só reforçam critérios já pontuados alto). Codex: Overall 9.03 (Rodada 4, após ajustes finais que só aumentam a nota). Ambos ≥ 9.0, nenhum gate G1–G6 violado. **STATUS: FASE 1 APPROVED.** Próxima ação obrigatória: Fase 2 (`capacity-model.md`).

## Divergências mantidas explicitamente (nenhuma)
Todas as divergências da Rodada 1 (10 pontos) e da Rodada 3 (contradição em FR-014) foram resolvidas por consenso, conforme resumo acima.

Convenção de IDs: `FR-xxx`, `NFR-xxx`, `SEC-xxx`, `PRIV-xxx`, `COST-xxx`, `SCALE-xxx`, `OPS-xxx`. Cada decisão futura (ADR, proposta de arquitetura) deve referenciar os IDs que satisfaz.

---

## 1. Functional Requirements (FR)

### 1.1 Contas e acesso
- **FR-001** — Usuário deve poder se cadastrar com e-mail e senha (ou provedor externo, a decidir na Fase 3) e confirmar o e-mail antes de uso pleno.
- **FR-002** — Usuário deve poder autenticar-se e encerrar sessão.
- **FR-003** — Usuário deve poder recuperar acesso perdido (reset de senha) por fluxo seguro com expiração de token.
- **FR-004** — Usuário deve poder editar seu perfil individual (nome, e-mail, preferências de notificação, timezone).
- **FR-005** — O modelo de dados deve suportar, desde o Day 0, a futura associação de um usuário a uma Organização, sem exigir migração destrutiva (ver NFR-020, domínio `Organization`/`Membership` em `data-model.md`, a produzir na Fase 3+).

### 1.2 Itens de vencimento
- **FR-010** — Usuário deve poder criar um item de vencimento com, no mínimo: nome, categoria, data de vencimento; demais campos (descrição, emissão, periodicidade, emissor, nº documento, responsável, tags, prioridade, anexos, observações) são opcionais no MVP.
- **FR-011** — Usuário deve poder editar um item existente, incluindo alterar a data de vencimento.
- **FR-012** — Usuário deve poder arquivar ou excluir um item (soft delete; ver PRIV-006 para exclusão definitiva sob LGPD).
- **FR-013** — Usuário deve poder marcar um item como renovado, gerando novo ciclo de vencimento conforme periodicidade (quando aplicável).
- **FR-014** — Alterar a data de vencimento de um item com alertas já agendados deve reagendar ou cancelar os alertas obsoletos de forma consistente (ver cenário de red team #13, seção 58 do prompt mestre). Exclusão de documento durante processamento do pipeline de extração não pode deixar o item em estado inconsistente: extração em andamento deve ser cancelada ou seu resultado descartado de forma idempotente. Notificação em trânsito cujo dado de origem (ex.: data de vencimento) foi alterado ou cujo item foi arquivado/excluído **deve ser cancelada antes da entrega ao provedor de canal**, sempre que o cancelamento chegar a tempo; se a mensagem já tiver sido entregue ao provedor externo (fora do controle do sistema) no momento da mudança, o sistema deve emitir automaticamente uma notificação corretiva referenciando a anterior como obsoleta. Entrega proposital de dado obsoleto sem cancelamento tentado não é uma opção válida.
- **FR-015** — Sistema deve manter histórico de alterações relevantes de cada item (ver FR-060/FR-061 — auditoria).

### 1.3 Alertas / políticas de lembrete
- **FR-020** — Usuário deve poder associar a um item uma política de alertas com múltiplos gatilhos relativos ao vencimento (ex.: 30/15/7/1 dias antes, no dia, após).
- **FR-021** — Sistema deve permitir políticas de alerta reutilizáveis (template aplicável a múltiplos itens).
- **FR-022** — Sistema deve respeitar quiet hours e timezone do usuário/organização ao disparar notificações.
- **FR-023** — Sistema deve deduplicar disparos de um mesmo alerta lógico (ver idempotência, seção 41 do prompt mestre).
- **FR-024** — Usuário deve poder confirmar recebimento/ciência de um alerta.
- **FR-025** — Usuário deve poder fazer opt-out de um canal ou tipo de alerta.
- **FR-026** — Sistema deve suportar alertas recorrentes (ex.: repetir semanalmente após vencimento até confirmação).

### 1.4 Canais de notificação
- **FR-030** — Sistema deve suportar, no MVP, e-mail como canal de notificação.
- **FR-031** — Sistema deve suportar Telegram como canal de notificação (candidato a canal gratuito inicial).
- **FR-032** — Sistema deve suportar WhatsApp como canal de notificação (candidato a feature premium; regra comercial não deve ser codificada no adapter — ver seção 30).
- **FR-033** — A arquitetura deve expor uma abstração de canal (Channel Adapter) que permita adicionar push, SMS, Slack, Teams, webhooks sem alterar o domínio de Reminder/Notification (ver critério "Extensibilidade" em `quality-criteria.md`). Evidência de extensibilidade exigida na Fase 3+: teste de contrato (contract test) por adapter, validando que qualquer implementação de Channel Adapter e de LLM/OCR Provider satisfaz a mesma interface e pode ser trocada sem alteração do domínio — não apenas ausência de acoplamento observado informalmente.
- **FR-034** — Sistema deve registrar o status de entrega de cada tentativa de notificação (enviado, entregue, falhou, indeterminado).

### 1.5 Upload e extração de documentos
- **FR-040** — Usuário deve poder enviar um arquivo (PDF, imagem) associado a um item de vencimento.
- **FR-041** — Sistema deve tentar extrair campos estruturados do documento (tipo, título, número, emissor, data de emissão, data de validade) via pipeline determinístico + IA quando necessário.
- **FR-042** — Toda extração deve carregar confidence score e origem do campo (determinístico vs. IA vs. manual). Sistema deve manter, por tipo documental, métricas contínuas de precisão e recall da extração e calibração de confiança (confidence calibrado deve corresponder à taxa real de acerto observada) — artefato de avaliação obrigatório antes de qualquer aumento de autonomia do pipeline (ex.: reduzir a superfície de confirmação humana).
- **FR-043** — Fail-closed de campo crítico (em especial data de vencimento) é obrigatório sempre que ocorrer qualquer uma das condições a seguir: (a) confidence < threshold definido; (b) confidence ausente ou inválida; (c) timeout ou erro do provedor de extração; (d) tipo documental não reconhecido; (e) divergência entre extratores (determinístico vs. IA) acima de um limite de tolerância. Nessas condições o campo deve permanecer em estado `PENDING_CONFIRMATION`: o sistema não pode criar vencimento, alterar vencimento existente, agendar alerta com base nesse valor, nem sobrescrever um valor já confirmado por humano (gate G4, `fitness-function.md`).
- **FR-044** — Usuário deve poder corrigir manualmente qualquer campo extraído antes ou depois da confirmação. Toda confirmação/correção deve registrar: ator, valor anterior, valor proposto, valor final, timestamp e versão/execução do pipeline de extração que gerou a proposta — para permitir auditoria e teste negativo de FR-043.

### 1.6 Dashboard e visualização
- **FR-050** — Usuário deve visualizar lista de próximos vencimentos ordenada por proximidade.
- **FR-051** — Usuário deve visualizar itens vencidos, renovados, por categoria e por responsável.
- **FR-052** — Usuário deve visualizar itens/documentos pendentes de confirmação (ex.: extração de baixa confiança).
- **FR-053** — Sistema deve oferecer visão de calendário dos vencimentos.

### 1.7 Auditoria
- **FR-060** — Sistema deve registrar evento de auditoria para: criação, edição, exclusão/arquivamento de item; substituição de documento; renovação; agendamento de alerta; envio de alerta; falha de alerta; confirmação do usuário; alteração de responsável.
- **FR-061** — Eventos de auditoria devem ser imutáveis após gravação (append-only) e associados a ator, timestamp e item afetado.

### 1.8 TrackedSubject e Requisitos (M9 — evolução estratégica do roadmap, D-036/D-038/D-040, implementado em `develop`, ainda não deployado)
- **FR-070** — Usuário deve poder cadastrar um `TrackedSubject` (fornecedor, cliente, funcionário, ativo, local ou tipo customizado) como entidade própria do tenant, distinta de `Organization`/`User` (`roadmap-evolution/03-domain-model-tracked-subject-requirement.md`).
- **FR-071** — Usuário deve poder associar um ou mais requisitos (`RequirementAssignment`) a um `TrackedSubject`, cujo estado pode ser `MISSING` mesmo sem nenhum `ExpirationItem`/documento existir ainda — estado não representável hoje por `ExpirationItem` sozinho.
- **FR-072** — Um `RequirementAssignment` pode ser vinculado manualmente a um `ExpirationItem` já existente do tenant, marcando-o como satisfeito (`SATISFIED`); a validade exibida (`VALID`/`EXPIRING`/`EXPIRED`) deve ser sempre derivada do `ExpirationItem` linkado no momento da leitura, nunca persistida de forma concorrente em `RequirementAssignment` (evita fonte-dupla-de-verdade).
- **FR-073** — Sistema deve limitar o número de `TrackedSubject` ativos por tenant conforme o plano vigente (`TenantEntitlement`, default 25 no plano free — `roadmap-evolution/05-domain-model-organization-billing.md`), rejeitando a criação de forma fail-closed (nunca parcial) ao atingir o limite.
- **FR-074** — Usuário deve poder observar (`watch`) um `ExpirationItem` sem ser o responsável (`assigneeUserId`) primário, e deixar de observá-lo a qualquer momento — sem que isso altere a versão OCC do item observado (`roadmap-evolution/07-domain-model-escalation-watchers-digest.md`).

### 1.9 Guest Upload / Magic Link (M10 — evolução estratégica do roadmap, D-037/D-045, implementado em `develop`, ainda não deployado)
- **FR-075** — Usuário (tenant) deve poder emitir um `DocumentRequest` para um `RequirementAssignment`, gerando um link/token opaco enviado a um destinatário externo (`recipientEmail`) sem exigir que esse destinatário tenha conta no sistema (`roadmap-evolution/04-domain-model-guest-upload.md`).
- **FR-076** — O destinatário externo (convidado) deve poder consultar o `DocumentRequest` e submeter um documento usando somente o token — nunca por login/senha/JWT — e o sistema nunca deve distinguir, pela resposta observável, um token inexistente de um token existente mas com secret incorreto ou com quota de requisições excedida (anti-enumeração).
- **FR-077** — Um `DocumentRequest` deve expirar no primeiro entre 14 dias da emissão ou seu `deadline` opcional, o que ocorrer primeiro; após expirar, revogado ou já submetido, o token deixa de resolver.
- **FR-078** — O documento submetido por um convidado deve passar pelo mesmo pipeline de triagem de malware/quarentena já usado para uploads autenticados (M6), antes de avançar a `RequirementAssignment` associada.

### 1.10 Entrega automática de link e cobrança automatizada (M10 cluster 4 — D-047/D-048/D-049)
- **FR-079** — Sistema deve poder reenviar automaticamente um link de guest upload funcional em cada nível de cobrança (`DocumentChasingOccurrence`, antes do `deadline`) sem jamais persistir o `secret` do token em qualquer forma (nem cifrado) — cada reenvio gera um token novo via rotação (`D-048`), nunca reconstrói o token original.
- **FR-080** — Depois do `deadline`/expiração do token, o sistema não deve gerar nem enviar um novo link externo funcional; deve notificar o usuário interno que criou a solicitação (`DocumentRequest.requestedByUserId`) em vez do destinatário externo.
- **FR-081** — Usuário (tenant) deve poder optar, por preferência persistente (`DocumentRequestDeliveryPreference`, default `MANUAL`) ou por chamada individual, entre enviar automaticamente o e-mail de convite inicial do guest upload ou continuar entregando o link manualmente — automação nunca é o comportamento implícito sem essa escolha explícita, e fica sob um kill switch global desligado por padrão (`D-049`).
- **FR-082** — Todo envio automático de e-mail a um destinatário externo (convite inicial ou cobrança) deve respeitar um limite de taxa por tenant e por destinatário, verificado antes da criação do recurso quando o envio for solicitado — excedê-lo bloqueia a criação (não cria parcialmente) em vez de silenciosamente pular o envio.

---

## 2. Non-Functional Requirements (NFR)

- **NFR-001** — Nenhum vencimento monitorado pode ser "silenciosamente perdido" (nenhum alerta disparado) por falha do sistema, salvo indisponibilidade documentada de todos os canais configurados pelo usuário. Critério de evidência: reconciliação periódica (NFR-004) sem lacuna não explicada, validada por teste automatizado que injeta falha em cada etapa do pipeline de disparo. *(Deriva do critério "Correção/Confiabilidade", peso 14%, gate G3 < 7.0.)*
- **NFR-002** — As seguintes operações devem ser idempotentes (reexecução não duplica efeito observável pelo usuário), com chave de idempotência explícita e teste automatizado de reexecução: agendamento de lembrete, disparo de alerta, criação de notification intent, tentativa de envio por canal, recebimento de webhook de provedor externo, upload de documento, execução de extração, e renovação de item.
- **NFR-003** — Sistema deve implementar retry com backoff e Dead Letter Queue para falhas de entrega de notificação, com alarme quando a DLQ crescer além de um limiar e mecanismo de redrive.
- **NFR-004** — Sistema deve executar reconciliação automática, em cadência definida em `slo.md` (Fase posterior, nunca superior a 24h), entre itens com vencimento próximo/passado e alertas efetivamente disparados, para detectar lacunas (ver NFR-001).
- **NFR-005** — Cobertura de testes automatizados dos fluxos críticos (agendamento, disparo, extração com gate de confiança) ≥ 90%.
- **NFR-010** — API deve ter SLO de latência (percentil e valor) formalizado em `slo.md` como artefato obrigatório da Fase 2/3 — não fixar número aqui sem capacity model (ver UNK-001). `slo.md` é pré-requisito bloqueante antes da rodada de avaliação da fitness function em Fase 3.
- **NFR-011** — Sistema deve absorver picos de disparo (ex.: dezenas/centenas de milhares de itens vencendo no mesmo horário) sem perda de mensagens, via fila com concorrência controlada, batching e jitter (ver seção 42 do prompt mestre).
- **NFR-020** — Modelo de dados deve ser desenhado para permitir evolução para multi-tenant (Organização/Membership/RBAC) sem redesenho estrutural, mesmo que não implementado no MVP (readiness, não implementação).
- **NFR-021** — Canais de notificação e provedor de IA/OCR devem ser substituíveis sem alteração do domínio (ver FR-033 e critério "Extensibilidade").
- **NFR-030** — 100% da infraestrutura relevante deve ser reproduzível via Infrastructure as Code (ferramenta a decidir na Fase 3/seção 45).
- **NFR-033** — Contratos de API e schemas de eventos/mensagens (fila, notification intent, extraction output) devem ser versionados explicitamente (ex.: número de versão no payload ou no path); mudança incompatível exige nova versão coexistindo com a anterior por um período de depreciação documentado, nunca substituição in-place sem transição.
- **NFR-031** — Logs estruturados não devem conter conteúdo sensível/PII em texto livre (ver SEC-*, PRIV-*).
- **NFR-032** — Toda requisição relevante deve carregar correlation ID rastreável ponta a ponta (API → fila → adapter → provider).

---

## 3. Security Requirements (SEC)

- **SEC-001** — Autenticação deve resistir a ataques comuns de account takeover (rate limiting de login, proteção contra credential stuffing, MFA disponível ao menos como opção).
- **SEC-002** — Sessões devem ter expiração e mecanismo de revogação; tokens sensíveis não devem ser logados.
- **SEC-003** — Documentos enviados pelo usuário devem ser tratados como não confiáveis: validação de tipo/tamanho, isolamento de execução de qualquer parsing. Verificação antimalware é obrigatória por padrão em todo upload; uma exceção só é válida através de um processo formal de aceitação de risco (registrado em ADR, com aprovação explícita), nunca por omissão silenciosa.
- **SEC-003a** — Dados em trânsito devem usar TLS; dados em repouso (banco, storage de documentos, backups) devem ser criptografados com chaves geridas (KMS-equivalente) e rotação de chave definida.
- **SEC-004** — Conteúdo extraído de documentos (texto/OCR) é **dado**, nunca instrução, ao ser passado para qualquer componente de IA — arquitetura deve prevenir prompt injection alterando comportamento do agente/modelo (seção 34).
- **SEC-005** — URLs pré-assinadas (presigned) para upload/download devem ter expiração de minutos (não horas/dias) e escopo restrito a um único objeto/operação; valor exato a fixar em ADR na Fase 3+.
- **SEC-006** — Segredos (credenciais de provedores, chaves de API) devem residir em cofre gerenciado (Secrets Manager/KMS-equivalente), nunca em código ou variável de ambiente em texto plano no repositório.
- **SEC-007** — IAM/autorização deve seguir princípio de menor privilégio; escopos de acesso a documentos e itens devem ser verificados por requisição, não apenas por sessão. Evidência exigida na Fase 3+: revisão de políticas IAM documentada e teste automatizado de autorização negativa (tentativa de acesso fora de escopo deve falhar).
- **SEC-008** — Webhooks recebidos de provedores externos (WhatsApp, Telegram, e-mail) devem ser validados quanto à origem/assinatura para prevenir spoofing.
- **SEC-009** — Deve existir threat model documentado (`threat-model.md`, Fase posterior) cobrindo, no mínimo, os itens listados na seção 33 do prompt mestre.
- **SEC-010** — Nenhum finding crítico (OWASP Top 10/ASVS ou threat model) pode estar aberto no momento da avaliação do gate G1. Não há exceção por "plano de mitigação": um finding crítico aberto reprova G1 até ser corrigido ou formalmente reclassificado (com evidência) como não aplicável/mitigado.

---

## 4. Privacy Requirements (PRIV) — LGPD

- **PRIV-001** — Sistema deve mapear todos os dados pessoais tratados (identificação, contato, documentos, metadados de vencimento) com finalidade e base legal associadas — ver `privacy-lgpd.md` (Fase posterior).
- **PRIV-002** — Coleta de dados deve seguir minimização: apenas campos necessários à funcionalidade são obrigatórios.
- **PRIV-003** — Usuário deve poder exportar seus dados pessoais (portabilidade) e solicitar exclusão (direito ao esquecimento). Prazo de resposta a solicitações do titular: confirmação da existência de tratamento em até 15 dias (LGPD art. 19); atendimento efetivo do pedido de exportação/exclusão em até 30 dias corridos, prorrogável uma única vez por igual período mediante justificativa registrada — teto operacional definido nesta fase, sujeito a confirmação em `privacy-lgpd.md`/parecer jurídico (PRIV-008), nunca indefinido — respeitando retenção legal obrigatória quando aplicável.
- **PRIV-004** — Retenção de documentos e dados pessoais deve ter política definida por tipo de dado (prazo explícito ou evento de expiração de retenção), nunca indefinida por padrão. Tabela de retenção por tipo de dado é artefato obrigatório de `privacy-lgpd.md`.
- **PRIV-005** — Subprocessadores (provedores de e-mail, WhatsApp, Telegram, IA/OCR, cloud) devem ser mapeados e listados para fins de transparência, incluindo país de processamento (para efeito de PRIV-007).
- **PRIV-006** — Exclusão solicitada pelo usuário deve propagar para backups/réplicas em até um ciclo completo de rotação de backup, com teto operacional de 90 dias corridos nesta fase (valor final de rotação a confirmar em `disaster-recovery.md`, nunca superior a este teto sem nova decisão registrada em ADR).
- **PRIV-007** — Transferência internacional de dados (ex.: provedor de IA fora do Brasil) deve ser identificada e sinalizada explicitamente como ponto que requer validação jurídica (este documento não substitui parecer jurídico — seção 35).
- **PRIV-008** — Nenhum dos pontos acima dispensa parecer jurídico formal antes de lançamento comercial; este requirements.md registra apenas as implicações técnicas.

---

## 5. Cost Requirements (COST)

- **COST-001** — Custo de infraestrutura ocioso (idle) deve tender a zero nos estágios iniciais: definido como nenhum componente cobrado por capacidade provisionada e não utilizada (ex.: sem compute always-on, sem banco com custo fixo mínimo relevante) em Stage 0–1. Valor numérico de teto será fixado em `cost-model.md` (Fase posterior) a partir do capacity model.
- **COST-002** — Deve ser possível medir custo por unidade de negócio relevante: por usuário, por item monitorado, por documento processado, por notificação enviada, por extração de IA.
- **COST-003** — Sistema deve ter alarmes de orçamento (ex.: AWS Budgets) em 80% e 100% de um teto definido por ambiente.
- **COST-004** — Kill switch de operações caras (chamadas de IA, envio de WhatsApp, extração) deve ser: acionável por operação sem exigir novo deploy; restrito a papéis autorizados definidos; auditado (quem acionou, quando, motivo); fail-safe (ao acionar, nunca deixa item em estado inconsistente); testado periodicamente; e com regra explícita para o que acontece com trabalhos já enfileirados no momento do acionamento (drenar vs. descartar, a decidir por operação). Gate G6.
- **COST-005** — Critérios de aceite verificáveis do gate G6 (não apenas existência do mecanismo):
  - Quotas numéricas definidas por operação/plano/ambiente, com resposta (erro estruturado) e telemetria ao serem excedidas;
  - Limite de upload em bytes, nº de arquivos e concorrência; rate limit por usuário/IP/endpoint com unidade e janela definidas;
  - AWS Budgets (ou equivalente) com valores numéricos por ambiente, destinatários de alerta definidos e teste de disparo do alarme validado;
  - Anomaly detection com janela e sensibilidade definidas, associado a runbook de resposta;
  - Kill switch conforme COST-004.
  Ausência de qualquer um destes itens reprova o gate G6, independentemente do Overall.
- **COST-006** — Regra comercial (ex.: WhatsApp como feature paga) não deve ser codificada dentro do adapter de canal; deve ser resolvida em uma camada de política/entitlement (ver FR-033, seção 30).

---

## 6. Scale Requirements (SCALE)

- **SCALE-001** — Arquitetura deve suportar, sem redesenho estrutural, o crescimento descrito no capacity model de Stage 0 (desenvolvimento) até Stage 5 (1.000.000 de usuários) — dimensionamento exato fica para `capacity-model.md` (Fase 2).
- **SCALE-002** — Sistema deve suportar picos de disparo de alertas concentrados em uma janela curta (ex.: "100 mil itens vencem às 09:00 no mesmo dia") sem perda de mensagens (ver NFR-011, cenário de red team #2).
- **SCALE-003** — Limites conhecidos de serviços gerenciados relevantes (throughput de fila, limites de API de provedores de notificação, quotas de IA) devem ser identificados e monitorados antes de serem um gargalo real.
- **SCALE-004** — Isolamento multi-tenant é readiness no MVP (NFR-020). Definição objetiva de tenant: fronteira de autorização — usuário individual enquanto Organization/Membership não existir; organização a partir do momento em que esse domínio for habilitado. Gate G5 ativa-se, o que ocorrer primeiro: (a) antes do primeiro deploy que permita dois principals de fronteiras de autorização distintas compartilharem o mesmo datastore/índice/fila/bucket/cache lógico; ou (b) quando o domínio Organization/Membership for habilitado em produção. A partir da ativação, exige testes de isolamento cobrindo API, jobs assíncronos, objetos de storage, cache, busca, logs e backups — não apenas teste de acesso cruzado via API.

---

## 7. Operational Requirements (OPS)

- **OPS-001** — Sistema deve expor métricas mínimas: latência/erros de API, lag de disparo de lembrete, notificações solicitadas/entregues/falhadas/retentadas, tamanho e idade da DLQ, taxa de bounce de e-mail, falhas por canal, sucesso/confiança de extração, custo de IA, falhas de upload, custo por usuário (seção 38).
- **OPS-002** — Logs devem ser estruturados e correlacionáveis ponta a ponta (ver NFR-032).
- **OPS-003** — Devem existir dashboards e alertas baseados em sintomas/SLOs, não apenas em causas internas.
- **OPS-004** — Deploy e infraestrutura devem ser 100% reproduzíveis via IaC com pipeline de CI/CD incluindo lint, testes, scans de segurança/dependências, validação de IaC, plan/apply controlado, smoke test e rollback (seções 44–45).
- **OPS-005** — Deve existir definição de RPO/RTO e plano de disaster recovery para banco de dados, storage de documentos e reconstrução de infraestrutura via IaC (seção 43), sem adotar multi-region ativo-ativo sem justificativa aprovada.
- **OPS-006** — Runbooks devem existir para os fluxos críticos (falha de disparo, DLQ crescendo, provedor de notificação indisponível, IA indisponível).

---

## 8. Future Requirements

Não implementar agora, mas a arquitetura não deve bloquear (seção 7 do prompt mestre). Não são requisitos rastreáveis por ADR da mesma forma que FR/NFR — servem como restrição de design ("não fechar a porta"), não como funcionalidade a entregar:
- **FUT-001** — Multi-tenancy plena, organizações, equipes, RBAC, SSO, white-label.
- **FUT-002** — API pública versionada, webhooks de saída, integrações com parceiros.
- **FUT-003** — Verticais: contabilidade, advocacia, compliance, múltiplas unidades.
- **FUT-004** — Workflows/aprovações, relatórios avançados, calendários compartilhados.
- **FUT-005** — Integrações ERP/CRM.
- **FUT-006** — App mobile / PWA.
- **FUT-007** — MCP Server, agentes, automações sobre a API do produto.
- **FUT-008** — Armazenamento documental de longo prazo com trilhas de auditoria avançadas.
- **FUT-009** — Assinatura eletrônica.
- **FUT-010** — Planos corporativos; cobrança por assento, por item, por mensagem, por armazenamento.

---

## 9. Constraints

- **CON-001** — Priorizar AWS, serverless-first, managed services, pay-per-use (seção 8). Desvios exigem justificativa registrada em ADR.
- **CON-002** — Evitar, sem justificativa aprovada: EC2 permanente, Kubernetes/EKS, ECS always-on, bancos com alto custo fixo, multi-region ativo-ativo, microsserviços excessivos, event sourcing, CQRS complexo, service mesh, streaming pesado (seção 8).
- **CON-003** — Nenhuma escolha de serviço AWS antes de completar Fase 0 (feito), Fase 1 (este documento) e Fase 2 (capacity model) — regra absoluta, seção 9.
- **CON-004** — Toda decisão arquitetural relevante (seção 20) deve passar pelo protocolo de proposta → réplica → tréplica → consenso → nota independente Claude/Codex (seção 21).
- **CON-005** — IA deve sugerir, nunca decidir sozinha sobre dado crítico (data de vencimento) com baixa confiança — restrição de produto, não só técnica (seção 6.5, FR-043).

---

## 10. Assumptions

- **ASS-001** — O público inicial (PF, autônomos, MEIs, pequenas empresas/escritórios) implica volume inicial baixo e sensibilidade a custo alta — favorece arquitetura serverless pay-per-use desde o Day 0.
- **ASS-002** — E-mail é o canal "sempre disponível" (fallback); Telegram é gratuito; WhatsApp é candidato a paywall — a confirmar em `cost-model.md`.
- **ASS-003** — Volume de upload de documentos por item é baixo (poucos arquivos por item), não um sistema de gestão documental de alto volume — a confirmar no capacity model.
- **ASS-004** — A maioria dos vencimentos tem periodicidade previsível (anual, mensal) — recorrência simples cobre a maior parte dos casos; casos irregulares são exceção tratável manualmente.
- **ASS-005** — No MVP, o sistema é single-tenant do ponto de vista de isolamento de dados (cada usuário só vê os próprios itens); organização multiusuário é evolução futura, não requisito do MVP.

---

## 11. Unknowns

- **UNK-001** — SLOs numéricos de latência de API e frescor de lembrete ainda não definidos — dependem do capacity model (Fase 2) e serão formalizados em `slo.md`.
- **UNK-002** — Threshold de confiança que dispara o gate G4 (confirmação humana obrigatória) ainda não definido numericamente — depende de avaliação empírica do pipeline de OCR/IA escolhido na Fase 3+.
- **UNK-003** — Provedor(es) de IA/OCR e de WhatsApp Business ainda não escolhidos — pesquisa de pricing/quotas/termos pendente (seções 27, 30).
- **UNK-004** — Ferramenta de IaC (Terraform/OpenTofu/CDK/SAM) ainda não decidida — pendente de debate Claude↔Codex (seção 45).
- **UNK-005** — Momento exato em que multi-tenant deixa de ser "readiness" e passa a ser implementado (gatilho de negócio, não só técnico) — a ser refinado com o usuário/produto quando houver demanda real.
- **UNK-006** — Necessidade de MFA obrigatório vs. opcional no MVP — decisão de produto/segurança pendente de trade-off explícito.

---

## 12. Non-goals

- **NG-001** — Não implementar multi-tenancy, RBAC ou SSO no MVP (apenas readiness — ver NFR-020, ASS-005).
- **NG-002** — Não implementar app mobile nativo nesta fase.
- **NG-003** — Não implementar assinatura eletrônica, workflows de aprovação, ou integrações ERP/CRM no MVP.
- **NG-004** — Não adotar Kubernetes, microsserviços excessivos, event sourcing ou multi-region ativo-ativo sem justificativa aprovada (ver CON-002).
- **NG-005** — Este documento não decide nenhum serviço AWS específico (proibido pela seção 9 até completar a Fase 2).
- **NG-006** — Não substitui parecer jurídico sobre LGPD (ver PRIV-008).

---

## 13. Método de Avaliação e Evidências (resposta aos 5 pontos pendentes de `fitness-function.md`)

Formalizado por acordo Claude↔Codex nesta Fase 1, complementando (não substituindo) `fitness-function.md`.

### 13.1 Duas rubricas por estágio de maturidade (correção Fase 3, Rodada 3)

**Problema identificado e corrigido**: a rubrica original abaixo usava uma única escala 0–10 ancorada em "implementado e testado" para nota ≥7. Isso é correto para avaliar o **sistema construído**, mas produz uma contradição normativa quando aplicada aos checkpoints de **desenho conceitual** das seções 18–22 do prompt mestre (Architecture Round 1–3): o Implementation Blueprint só pode existir *depois* da arquitetura aprovada (seção 60), então nenhuma arquitetura conceitual jamais atingiria evidência de implementação antes de precisar da nota ≥9.0 para ser aprovada — um gate estruturalmente inalcançável. Resolvido por consenso Claude↔Codex: duas rubricas formais, aplicadas conforme o estágio do artefato sendo avaliado.

**(A) Design Maturity Score** — usada nos checkpoints conceituais (Architecture Round 1–3, seção 22; e nas Fases 1/2 deste documento/capacity model):
- **0–3 — Inexistente**: sem proposta nem justificativa.
- **4–6 — Desenho superficial**: proposta existe, mas sem justificativa quantitativa, sem trade-offs explícitos, ou com lacunas não registradas.
- **7–8 — Desenho coerente e rastreável**: decisão justificada por requisito/métrica do capacity model, trade-offs e alternativas rejeitadas explicitados, lacunas registradas como ADR pendente (não ausência de lacunas).
- **9–10 — Desenho documentalmente completo**: 9 exige, além do acima, que os ADRs classificados como *materialmente relevantes* (não todo item aberto, mas os que afetam corretude/segurança/custo de forma direta) estejam fechados, e que a arquitetura tenha passado pelo Architecture Red Team (seção 58) e por modelagem de carga (seção 59) sem lacuna crítica remanescente; 10 é reservado para depois de evidência operacional real (ver rubrica B).

**(B) Operational Evidence Score** — usada no Gate de Aprovação Final (seção 23) sobre o sistema **construído**, e em qualquer revisão pós-implementação:
- **0–3 — Inexistente**: sem design nem implementação.
- **4–6 — Apenas desenhado**: design/ADR existe, sem implementação ou teste que comprove.
- **7–8 — Implementado e testado**: implementado, com teste automatizado passando em condições normais.
- **9–10 — Validado sob falha/carga e operacionalizado**: testado sob condições adversas (falha de dependência, carga, red team operacional) e com runbook/observabilidade operacional associados.

Em ambas as rubricas: critério sem evidência disponível no momento da avaliação **não recebe nota neutra** — é registrado como "não avaliado" e bloqueia aprovação (equivalente a nota insuficiente para fins de gate), nunca tratado como média/default. Cada nota registrada deve citar o(s) artefato(s) que a sustentam (documento de design ou teste, conforme a rubrica aplicável) e referenciar a versão/commit do artefato avaliado (snapshot). Toda avaliação deve declarar explicitamente qual rubrica (A ou B) está sendo aplicada.

### 13.2 Precedência de gates (ordem de avaliação)
1. Determinar aplicabilidade dos gates condicionais (G4 sempre aplicável se houver IA/OCR criando ou alterando vencimento; G5 conforme SCALE-004).
2. Validar se há evidência suficiente para cada gate aplicável (13.1). Evidência insuficiente = gate não satisfeito.
3. Avaliar G1–G6. Qualquer gate violado ou sem evidência suficiente → `STATUS = NOT APPROVED`, independentemente do Overall ponderado. Nota alta em outros critérios não compensa gate violado.
4. Somente se todos os gates aplicáveis passarem, calcular e publicar o Overall ponderado e verificar `Claude_Overall >= 9.0 AND Codex_Overall >= 9.0`.
5. Se múltiplos gates falharem simultaneamente, todos devem ser registrados no relatório de avaliação — não interromper no primeiro encontrado.

### 13.3 Referência cruzada
G4 → ver definição objetiva de fail-closed em FR-043/FR-044. G5 → ver definição objetiva de tenant e gatilho em SCALE-004. G6 → ver critérios de aceite verificáveis em COST-004/COST-005.

---

## Rastreabilidade

Cada FR/NFR/SEC/PRIV/COST/SCALE/OPS acima deve ser referenciável a partir de ADRs e do `decisions-log.md` (Fase 3+). Gates G1–G6 de `fitness-function.md` mapeiam para: G1→SEC-010/SEC-003a/SEC-007, G2→PRIV-001..008, G3→NFR-001/NFR-002/NFR-004/NFR-005, G4→FR-043/FR-044/CON-005, G5→SCALE-004, G6→COST-004/COST-005.
