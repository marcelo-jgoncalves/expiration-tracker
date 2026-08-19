# MCP Readiness — Expiration Tracker

Status: proposta do Claude — seção 48 do prompt mestre ("não é obrigatório implementar MCP agora, mas avaliar domain API suitability, tool boundaries, auth scopes, structured outputs, audit, tenant context, rate limits").
Base: `docs/architecture/architecture-fase3-consolidada.md`, `docs/architecture/data-model.md`.

## Adequação do domínio a ferramentas MCP
As entidades já modeladas (`data-model.md`) mapeiam naturalmente para operações MCP-friendly: `ExpirationItem` (CRUD), `Document` (upload/consulta), `NotificationIntent` (consulta de status) são candidatos naturais a tools como `list_expiring_items`, `get_item_status`, `create_reminder_policy`. Isso é uma propriedade emergente de um domínio bem modelado, não algo desenhado especificamente para MCP.

## Fronteiras de tool (tool boundaries)
Cada tool MCP futura deveria mapear 1:1 a uma operação já exposta pela API HTTP (não um atalho direto ao banco) — a camada de autorização (SEC-007, verificação por requisição) já vive no domínio, então uma tool MCP herdaria a mesma verificação automaticamente se implementada como cliente da API interna, não como acesso direto a dados.

## Escopos de autenticação
Cognito (já decidido, §4) suporta OAuth scopes — um cliente MCP futuro seria tratado como mais um client OAuth com escopos próprios (ex.: `items:read`, `items:write`, `documents:upload`), reutilizando a infraestrutura de auth já aprovada, sem necessidade de um sistema de autenticação paralelo.

## Saídas estruturadas
`ExtractedField`/`ExpirationItem` já são schemas estruturados com tipos definidos (`data-model.md`) — adequados a retorno de tool MCP sem tradução adicional. A exigência de FR-043 (fail-closed, `PENDING_CONFIRMATION`) se estenderia naturalmente: uma tool MCP que tentasse "confirmar" um campo de baixo confidence passaria pelo mesmo gate G4, não um caminho separado menos seguro.

## Auditoria
`AuditEvent` (já append-only, `data-model.md`) registraria ações originadas via MCP da mesma forma que ações via UI — o `actorUserId`/`correlationId` já existentes seriam suficientes para diferenciar origem (UI vs. agente) se um campo `origin` for adicionado no futuro (mudança aditiva, não estrutural).

## Contexto de tenant (correção da revisão do Codex — reduzir excesso de confiança)
`tenantId` obrigatório em toda chave (SCALE-004) é **necessário, não suficiente** para isolamento via MCP: uma tool MCP precisa de vinculação segura explícita entre o token do cliente MCP, o `tenantId` autorizado e a autorização por objeto individual (não presumir que "toda query tem tenantId" implica "nenhuma fuga é possível" — um bug de implementação na tool ainda poderia aceitar `tenantId` como parâmetro do próprio agente em vez de derivá-lo do token). Requisito real: `tenantId` de uma tool MCP deve vir **exclusivamente** do token OAuth validado, nunca de input do agente/LLM, e cada tool deve reverificar autorização por objeto (não confiar apenas na query já filtrada por tenant).

## Rate limits
`TenantQuota` (`data-model.md`) é a estrutura que um endpoint MCP consumiria para aplicar limite — reuso do que já existe para a API HTTP. Falta explicitamente: limite **por tool** (não apenas por tenant agregado) — uma tool de escrita (`create_reminder_policy`) deveria ter budget menor que uma de leitura (`list_expiring_items`), a decidir na Fase de implementação MCP real, não aqui.

## Lacunas reconhecidas (correção da revisão do Codex — não fechadas nesta fase, registradas para quando MCP for implementado)
- Auditoria não distingue ainda agente/cliente MCP de usuário direto/delegado — `origin` como campo futuro é insuficiente sozinho; precisa também de `actingOnBehalfOf` (quando um agente age delegado por um usuário) e revogação de delegação.
- Mapeamento tool↔endpoint 1:1 é um ponto de partida rígido — tools reais provavelmente precisam de schemas próprios (não apenas o schema HTTP reaproveitado), paginação (listas grandes de `ExpirationItem`), formato de erro estruturado específico do protocolo MCP, e consentimento explícito do usuário antes de uma tool de escrita agir em seu nome.
- Nenhum desses pontos é decidido aqui — são **abertos conscientemente** para quando a implementação de MCP for de fato priorizada (não bloqueiam a conclusão abaixo, que é sobre a arquitetura de domínio não bloquear essa evolução, não sobre já ter as tools especificadas).

## Conclusão
A arquitetura de domínio (Fase 3 + Data Model) não impõe nenhum obstáculo estrutural a uma futura camada MCP — mas "não bloquear" é diferente de "estar pronta para implementar", distinção que a versão anterior deste documento borrava. **Não implementar MCP agora** (seção 48, FUT-007); este documento serve para confirmar ausência de bloqueio arquitetural e registrar as lacunas de design de tool que precisarão ser resolvidas quando a implementação for priorizada.
