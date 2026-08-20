# Inventário de Terceiros e Fornecedores

Status: normativo atual (registro vivo). Criado no full-audit round1, eixo Governança Jurídica, Contratual e de Terceiros (2026-08-20), critério "Inventário, Due Diligence & Monitoramento de Terceiros" — formaliza como inventário versionado a lista de fornecedores já citada em prosa em `docs/architecture/privacy-lgpd.md` §5, sem duplicar o conteúdo de privacidade (aqui é due diligence/contratual; lá é base legal/dados pessoais).

**Não constitui parecer jurídico ou due diligence formal já concluída** — colunas em branco ou "pendente" são lacunas reais, não omissão silenciosa.

| Fornecedor | Serviço | Dados tratados | Criticidade | Região | Certificação | Lock-in | Responsável | DPA |
|---|---|---|---|---|---|---|---|---|
| AWS (Cognito) | Identidade/autenticação | credenciais, e-mail, atributos de perfil | Crítico | não decidida (`privacy-lgpd.md:51`) | SOC 2, ISO 27001 (AWS geral) | Alto (migração de IdP é reescrita) | pendente (dono do projeto) | AWS DPA padrão (Data Processing Addendum), aplicável automaticamente aos serviços AWS |
| AWS (DynamoDB) | Armazenamento de dados de negócio | todas as entidades do domínio | Crítico | não decidida | SOC 2, ISO 27001 | Alto (single-table design) | pendente | AWS DPA padrão |
| AWS (S3) | Armazenamento de documentos | documentos brutos do usuário | Crítico | não decidida | SOC 2, ISO 27001 | Médio (dado exportável) | pendente | AWS DPA padrão |
| AWS (Backup, KMS, Lambda, SQS/EventBridge, CloudWatch) | Infraestrutura operacional | variável por serviço | Alto | não decidida | SOC 2, ISO 27001 | Alto (arquitetura serverless acoplada à AWS) | pendente | AWS DPA padrão |
| AWS Bedrock | IA/LLM sobre documento do usuário | conteúdo extraído de documento | Alto | não decidida, pode processar fora do Brasil (`privacy-lgpd.md:51`) | pendente de verificação | Médio (troca de modelo é possível, troca de provider de IA é retrabalho) | pendente | AWS DPA padrão; **confirmar contratualmente que não usa dado para treinar modelo — pendente** |
| AWS Textract | OCR sobre documento do usuário | conteúdo bruto do documento | Alto | não decidida | pendente de verificação | Médio | pendente | AWS DPA padrão |
| Provedor de e-mail (não escolhido) | Envio de lembretes | e-mail, conteúdo da notificação | Médio | não decidido | não aplicável ainda | Baixo-Médio (múltiplos providers compatíveis com o Channel Adapter) | pendente | não aplicável — fornecedor não contratado |
| BSP WhatsApp (não escolhido) | Envio de lembretes | telefone, conteúdo da notificação | Médio | não decidido | não aplicável ainda | Médio-Alto (pricing/quotas específicos por BSP, `architecture-fase3-consolidada.md:102` item #6) | pendente | não aplicável — fornecedor não contratado |
| Telegram (Bot API) | Envio de lembretes | chat ID, conteúdo da notificação | Baixo | não decidido | não aplicável | Baixo | pendente | Telegram Bot API Terms — revisão pendente |

## Como manter atualizado

Toda vez que um novo fornecedor for efetivamente contratado/habilitado (não apenas cogitado em design), adicionar uma linha aqui antes de habilitar o fluxo em produção — mesmo gatilho de disciplina já usado no RIPD (`docs/architecture/privacy-lgpd.md` §6): registrar a decisão em `docs/engineering/decisions-log.md`, mesmo que a conclusão seja "segue sem DPA assinado, risco aceito temporariamente com prazo de revisão".

## Lacunas conhecidas (não corrigíveis por edição de documento)

- Região AWS de processamento não decidida — bloqueia preencher a coluna "Região" com valor real para todos os fornecedores AWS (`privacy-lgpd.md:51`).
- Nenhum DPA além do padrão AWS foi de fato assinado — não há fornecedor de e-mail/WhatsApp contratado ainda.
- Certificações de Bedrock/Textract especificamente (não apenas AWS geral) não foram verificadas nesta sessão.
