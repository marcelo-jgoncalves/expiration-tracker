# Eixos 5-9 — Proposta Claude (Rodada 1)

Fontes: DAMA-DMBOK (governança de dados), LGPD/ANPD (RIPD, bases legais, direitos do titular), Google SRE Book (SLO/error budget), ISO 22301/whitepaper AWS DR (RTO/RPO), ISO/IEC 42001 + NIST AI RMF (Govern/Map/Measure/Manage), SOC 2 Trust Services Criteria (gestão de terceiros), AWS Well-Architected SaaS Lens (onboarding/offboarding de tenant, crypto-shredding).

## Eixo 5: Privacidade e Governança de Dados

| # | Critério | Peso | Justificativa |
|---:|---|---:|---|
| 1 | Base Legal, Minimização & Finalidade | 16% | LGPD art. 6º/7º — cada fluxo de dado documentado com base legal e finalidade; nenhum dado coletado além do necessário |
| 2 | Classificação & Inventário de Dados | 14% | DAMA — saber o que existe, onde, e sua sensibilidade (PII, dado sensível LGPD art. 5º II) antes de proteger |
| 3 | Retenção, Exclusão & Direitos do Titular | 16% | LGPD direitos do titular (acesso/correção/exclusão/portabilidade) + soft delete já implementado (M2) — falta o fluxo de exclusão real end-to-end |
| 4 | Isolamento & Linhagem entre Tenants | 14% | Mesma preocupação do eixo Segurança, mas do ponto de vista de dado (não de acesso) — nenhum dado de um tenant deve aparecer em relatório/log/export de outro |
| 5 | Transferência Internacional & Localização de Dados | 12% | Região AWS de produção pendente exatamente por isso (LGPD art. 33) — critério existe para não deixar essa decisão pendente virar drift |
| 6 | RIPD & Avaliação de Impacto | 10% | ANPD exige RIPD para tratamento de alto risco — projeto ainda não tem um, deveria ter antes do primeiro dado real de produção |
| 7 | Trilha de Auditoria de Acesso a Dado Pessoal | 10% | Distinto do log de segurança geral — especificamente quem acessou/alterou dado pessoal, quando, por quê |
| 8 | Comunicação de Incidente & Resposta a Vazamento | 8% | Obrigação de notificação ANPD em prazo determinado — sem isso hoje, runbook não existe |

## Eixo 6: Operações, SRE e Continuidade de Negócio

| # | Critério | Peso | Justificativa |
|---:|---|---:|---|
| 1 | SLOs & Error Budget | 16% | `slo.md` já existe no design, mas nunca operacionalizado com dado real (sem deploy ainda) |
| 2 | Observabilidade & Runbooks Operacionais | 15% | `SecureLogger` maduro, mas runbooks de operação real (não só de design) ainda não existem |
| 3 | Backup, Restore & Teste Real de Recuperação | 18% | `disaster-recovery.md` §6 já define o gate, mas nunca foi exercitado — maior peso porque "documentado mas nunca testado" é o padrão de risco mais repetido deste projeto |
| 4 | RTO/RPO por Tier de Criticidade | 12% | Framework já existe (capacity-model.md/disaster-recovery.md), falta validação real |
| 5 | Gestão de Incidente & Postmortem | 12% | Sem histórico de incidente real ainda — critério existe para quando houver, não é lacuna hoje |
| 6 | Resiliência Regional & Blast Radius de Indisponibilidade AWS | 15% | Região única (Stage 0-2, decisão já registrada) — risco aceito conscientemente, não ignorado, mas precisa ficar visível neste eixo |
| 7 | Automação de Deploy & Rollback | 12% | Pipeline de deploy real (`deploy-dev.yml`) só criado nesta sessão, nunca executado |

## Eixo 7: Governança de IA e Controles Internos

| # | Critério | Peso | Justificativa |
|---:|---|---:|---|
| 1 | Rastreabilidade de Decisão & Atribuição de Ação | 18% | Todo commit/PR/deploy feito por agente de IA precisa ser atribuível — já forte via git log + protocolo Claude↔Codex documentado |
| 2 | Independência Real de Revisão (não simulada) | 16% | Núcleo do protocolo `AGENTS.md` §4 — nota cega, evidência de arquivo:linha, não "a outra IA disse que está correto" |
| 3 | Limites de Autonomia & Supervisão Humana | 16% | Quando um agente pode agir sem confirmação (commit em `develop`) vs. quando precisa de aprovação humana (merge PR, deploy real, ação destrutiva) — já definido em `AGENTS.md` mas nunca auditado como eixo próprio |
| 4 | Prevenção de Alteração Indevida (accidental self-approval) | 14% | Um agente não pode ser o único avaliador de seu próprio trabalho em decisão Type 1 — é por isso que o protocolo exige duas IAs |
| 5 | Gestão de Risco de Modelo & Ferramenta de IA | 12% | Qual modelo/versão fez qual decisão, reprodutibilidade, mudança de comportamento entre versões do Codex/Claude |
| 6 | Segregação de Responsabilidade (mesmo em projeto solo) | 12% | Marcelo decide produto/arquitetura, agente implementa — já é a regra, mas nunca testada por auditoria formal |
| 7 | Conformidade com Padrões Emergentes de Governança de IA | 12% | ISO/IEC 42001 / NIST AI RMF ainda não mapeados formalmente contra o processo real deste projeto |

## Eixo 8: Governança Jurídica, Contratual e de Terceiros

| # | Critério | Peso | Justificativa |
|---:|---|---:|---|
| 1 | Licenciamento de Dependências Open Source | 18% | Nenhuma auditoria de licença rodou ainda (SBOM existe, mas não audita compatibilidade de licença) |
| 2 | Contratos com Subprocessadores (AWS, futuros provedores) | 16% | LGPD art. 39 exige isso formalmente — Cognito hoje, e-mail/WhatsApp amanhã |
| 3 | Termos de Uso & Política de Privacidade | 14% | Não existem ainda — produto não tem usuário real, mas é pré-requisito antes do primeiro |
| 4 | Responsabilidade Controlador-Operador | 14% | Marcelo/empresa como controlador, AWS como operador — papel não documentado formalmente |
| 5 | Propriedade Intelectual & Marca | 10% | Baixa prioridade neste estágio, mas existe |
| 6 | Risco de Fornecedor & SLA de Terceiro | 14% | O que acontece se Cognito/SES/WhatsApp Business API cair — dependência não auditada |
| 7 | Conformidade Regulatória Setorial (se aplicável) | 14% | Depende do setor do cliente final do micro-SaaS — não avaliado ainda |

## Eixo 9: Governança de Produto e Serviço Multi-tenant

| # | Critério | Peso | Justificativa |
|---:|---|---:|---|
| 1 | Onboarding & Provisionamento de Tenant | 16% | AWS SaaS Lens — hoje o "tenant" nasce implicitamente no primeiro login (MVP tenantId=userId), sem control plane dedicado |
| 2 | Offboarding & Exclusão Real de Tenant | 16% | Mesmo problema do eixo de Privacidade #3, lente de produto — "não conseguimos deletar um tenant" é falha de compliance, não só técnica |
| 3 | Quotas, Planos & Metering | 12% | `TenantQuota` já existe (M1), mas sem plano de billing real ainda |
| 4 | Clareza & Confiabilidade de Notificação | 14% | É o núcleo do produto — lembrete perdido/incorreto é a falha mais grave possível |
| 5 | Acessibilidade | 8% | Ainda não se aplica (sem frontend), mas entra no radar |
| 6 | Suporte Administrativo & Operação de Cliente | 10% | Sem ferramenta de suporte/admin ainda |
| 7 | Prevenção de Customização que Quebra o Modelo SaaS Unificado | 10% | Princípio AWS SaaS Lens — nenhuma feature deve criar um "fork" por tenant |
| 8 | Migração/Reshard sem Impacto ao Tenant | 14% | Já relevante — GSI3 já tem reshard versionado (`shardFnVersion`), critério existe para generalizar essa disciplina |

## Nota de confiança: 8.5/10 nos 5 eixos — mais incerteza que no eixo de Segurança porque menos grounded em código real existente (privacidade/jurídico/produto são majoritariamente greenfield neste projeto).
