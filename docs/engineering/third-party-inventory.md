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
| AWS SES v2 | Envio de lembretes/notificações por e-mail — **canal real, implementado desde M4** (`src/modules/notification/providers/ses-email-adapter.ts`, `infra/modules/ses-notifications/main.tf`), substitui a linha anterior "Provedor de e-mail (não escolhido)" que ficou desatualizada | destinatário (e-mail), conteúdo da notificação, metadados de bounce/complaint (callback SNS) | Alto (canal de notificação real em produção) | não decidida | pendente de verificação | Baixo (é o próprio AWS DPA já coberto pelas outras linhas AWS) | pendente | AWS DPA padrão |
| BSP WhatsApp (não escolhido) | Envio de lembretes | telefone, conteúdo da notificação | Médio | não decidido | não aplicável ainda | Médio-Alto (pricing/quotas específicos por BSP, `architecture-fase3-consolidada.md:102` item #6) | pendente | não aplicável — fornecedor não contratado |
| Telegram (Bot API) | Envio de lembretes | chat ID, conteúdo da notificação | Baixo | não decidido | não aplicável | Baixo | pendente | Telegram Bot API Terms — revisão pendente |

## Como manter atualizado

Toda vez que um novo fornecedor for efetivamente contratado/habilitado (não apenas cogitado em design), adicionar uma linha aqui antes de habilitar o fluxo em produção — mesmo gatilho de disciplina já usado no RIPD (`docs/architecture/privacy-lgpd.md` §6): registrar a decisão em `docs/engineering/decisions-log.md`, mesmo que a conclusão seja "segue sem DPA assinado, risco aceito temporariamente com prazo de revisão".

## Lacunas conhecidas (não corrigíveis por edição de documento)

- Região AWS de processamento não decidida — bloqueia preencher a coluna "Região" com valor real para todos os fornecedores AWS (`privacy-lgpd.md:51`). Precisão (auditoria W3-08, `docs/engineering/pilot-readiness-program.md`): o único ambiente que existe hoje (`dev`) já deploya para `us-east-1`, exceção explicitamente não-vinculante — não é a decisão de produção, que segue aberta. `bedrock_region` é uma variável Terraform separada, independentemente configurável da região do resto do stack — uma segunda decisão de residência de dados, não dobrada na escolha geral de região.
- Nenhum DPA além do padrão AWS foi de fato assinado — não há fornecedor de WhatsApp/Telegram contratado ainda (e-mail já usa AWS SES, sob o mesmo DPA padrão AWS das demais linhas).
- Certificações de Bedrock/Textract especificamente (não apenas AWS geral) não foram verificadas nesta sessão.
- WhatsApp já tem um kill switch provisionado em AppConfig (`infra/modules/feature-flags`, flag `WHATSAPP`, default `false`) mesmo sem o canal existir — é prontidão de infra para um fornecedor futuro, não uma relação de subprocessador ativa; não confundir "flag existe" com "mudança de configuração ligaria o canal" (falta todo o adapter/BSP).
