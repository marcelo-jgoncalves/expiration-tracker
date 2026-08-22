---
status: active
owner: engineering
authority: evidence
---

# Camada 3 — teste de IAM negativo real (GSI3/GSI6), executado em 2026-08-21

Escopo: `docs/architecture/m3.5-runtime-design.md` §"Testes em 3 camadas" (Camada 3) e
`docs/engineering/quality-gate-tiers.md` Tier C — "teste negativo de IAM real (role tenant-facing
tentando `Query` em GSI3 e GSI6 → `AccessDenied` em ambos)". Executado contra a conta AWS `dev`
real (`975707451904`/`us-east-1`, perfil `claude-dev`), decisão do usuário de reusar a conta dev em
vez de provisionar conta nova (custo/complexidade desproporcional ao estágio do projeto).

## Método: `aws iam simulate-principal-policy`, não uma chamada real de API

Decisão deliberada: em vez de assumir de fato a role de uma função tenant-facing (o que exigiria
credenciais temporárias reais dessa role, inviável sem alterar código do handler para expor um
caminho de teste) e fazer uma chamada real de `Query`, usei o motor de avaliação de política IAM
real da AWS (`iam:SimulatePrincipalPolicy`) contra as políticas de fato anexadas a cada role.

Por que isso conta como "real" e não como fake/container: a API não simula a lógica de IAM — ela
chama o mesmo avaliador de política que a AWS usa para autorizar qualquer chamada real, contra o
documento de política real anexado à role real na conta real. A única diferença de uma chamada
real de `dynamodb:Query` é que nenhuma requisição chega ao DynamoDB de fato — não há efeito
colateral, nenhum recurso é criado, nada precisa ser limpo depois. Dado o objetivo do teste
(provar que a política de IAM nega o acesso, não que o SDK do DynamoDB retorna erro), isso é
evidência suficiente e estritamente mais seguro que a alternativa.

## Resultado real (positivo: `dynamodb:Query`, `GSI3` e `GSI6`)

| Role | GSI3 | GSI6 |
|---|---|---|
| `exptrk-dev-items-handler-role` (tenant-facing) | **implicitDeny** | **implicitDeny** |
| `exptrk-dev-reminders-handler-role` (tenant-facing) | **implicitDeny** | **implicitDeny** |
| `exptrk-dev-notifications-handler-role` (tenant-facing) | **implicitDeny** | **implicitDeny** |
| `exptrk-dev-test-ping-handler-role` (tenant-facing) | **implicitDeny** | **implicitDeny** |
| `exptrk-dev-reminder-dispatch-role` | **implicitDeny** | **implicitDeny** |
| `exptrk-dev-ses-callback-role` | **implicitDeny** | **implicitDeny** |
| `exptrk-dev-notification-router-role` | **implicitDeny** | **implicitDeny** |
| `exptrk-dev-dispatch-outbox-relay-role` | **implicitDeny** | **implicitDeny** |
| `exptrk-dev-email-delivery-role` | **implicitDeny** | **implicitDeny** |
| `exptrk-dev-notification-email-outbox-relay-role` | **implicitDeny** | **implicitDeny** |
| `exptrk-dev-reminder-producer-role` (privilegiada, só GSI3) | **allowed** | **implicitDeny** |
| `exptrk-dev-reminder-reconciliation-role` (privilegiada, só GSI6) | **implicitDeny** | **allowed** |
| `exptrk-dev-outbox-sweeper-reminder-dispatch-role` (privilegiada, só GSI6) | **implicitDeny** | **allowed** |

Exatamente o padrão desenhado em `m3.5-runtime-design.md`: as 10 roles não-privilegiadas negadas
nos dois índices; `reminder-producer` permitida só em GSI3; `reminder-reconciliation` e
`outbox-sweeper-reminder-dispatch` permitidas só em GSI6 (nenhuma das duas ganha GSI3). Nenhuma
role tem acesso às duas simultaneamente.

## Controle positivo (prova que a negação é real, não "role sem nenhuma permissão")

`exptrk-dev-items-handler-role` simulada para `dynamodb:Query`/`GetItem`/`UpdateItem` contra a
tabela base (`arn:.../table/exptrk-dev-table`, sem `/index/...`): **allowed** nas três ações. A
role tem acesso real de leitura/escrita à tabela — a negação em GSI3/GSI6 é uma restrição
específica desses dois índices, não um artefato de a role estar mal configurada ou sem
permissões.

## Comandos executados (reprodutíveis)

```
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::975707451904:role/<role> \
  --action-names dynamodb:Query \
  --resource-arns \
    arn:aws:dynamodb:us-east-1:975707451904:table/exptrk-dev-table/index/GSI3 \
    arn:aws:dynamodb:us-east-1:975707451904:table/exptrk-dev-table/index/GSI6
```

Nenhum recurso AWS foi criado ou modificado por este teste — nada a verificar quanto a exclusão.

## Limite explícito deste método (não fechar como "Camada 3 100% completa")

`simulate-principal-policy` avalia políticas IAM identity-based/resource-based anexadas, mas não
reproduz: policies de sessão/contexto de request real (ex. condições que dependem de
`aws:RequestedRegion` efetivo de uma chamada real), SCPs de AWS Organizations (não há Organization
neste projeto, então não se aplica aqui), nem qualquer comportamento de runtime do SDK além da
decisão de autorização. Para este projeto (sem SCPs, sem policies condicionais dependentes de
contexto de request), a simulação é uma prova fiel da decisão real de autorização — mas o achado
"Camada 3 pendente" nos eixos de Arquitetura/Segurança continua parcialmente aberto para os outros
casos de teste da Camada 3 ainda não executados: poison message → DLQ real → redrive real,
invocação manual do EventBridge Scheduler, teste de restore real (`disaster-recovery.md` §6).
