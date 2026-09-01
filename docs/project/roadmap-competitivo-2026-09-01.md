# Expiration Tracker — Roadmap Competitivo de Funcionalidades

**Data:** 1 de setembro de 2026  
**Objetivo:** definir a ordem de evolução funcional necessária para entrar no mercado em boas condições de competir em funcionalidades e preço, sem transformar o Expiration Tracker em uma suíte contábil ou GED genérico.

---

# 1. Princípio estratégico

O objetivo do roadmap não é competir por quantidade absoluta de funcionalidades.

A prioridade é:

> **eliminar lacunas que possam fazer um cliente escolher um concorrente por falta de uma capacidade básica ou claramente relevante.**

A estratégia deve preservar o foco do produto:

```text
Requirement
    ↓
Document Request
    ↓
Guest Upload
    ↓
AI Extraction
    ↓
Human Verification
    ↓
Document Version
    ↓
Validity
    ↓
Responsible
    ↓
Alerts / Chasing
    ↓
Renewal
    ↓
New Version
    ↓
Audit History
```

Esse ciclo completo deve ser o principal diferencial funcional do Expiration Tracker.

---

# 2. Decisão de sequência de desenvolvimento

O frontend completo do novo domínio documental **não será finalizado imediatamente**.

A estratégia passa a ser:

```text
Funcionalidades P0 de domínio/backend/integrations
        ↓
todas funcionando de forma coerente
        ↓
escopo funcional estabilizado
        ↓
frontend completo e integrado
        ↓
polimento
        ↓
lançamento comercial
```

## Motivo

Finalizar agora toda a interface enquanto funcionalidades P0 ainda estão entrando aumentaria o risco de:

- retrabalho de fluxos;
- telas redesenhadas várias vezes;
- componentes temporários;
- inconsistência entre backend e UX;
- decisões prematuras de navegação;
- necessidade de revalidar jornadas repetidamente.

Portanto:

> **construir primeiro o conjunto P0 funcionalmente completo e, em seguida, consolidar o frontend como uma única etapa coerente de productização.**

Isso não significa ignorar UX durante o desenvolvimento.

Cada feature deve continuar sendo implementada com seus contratos, estados e necessidades de interface conhecidos, mas a consolidação final do frontend ocorrerá depois que o conjunto P0 estiver fechado.

---

# 3. Roadmap competitivo geral

| Ordem | Funcionalidade | Prioridade | Motivo |
|---:|---|---|---|
| 1 | Requirement Templates | P0 | Templates/checklists aparecem repetidamente nos concorrentes e aceleram onboarding e padronização |
| 2 | Bulk onboarding / importação em massa | P0 | Remove enorme barreira de migração para clientes com centenas de documentos |
| 3 | WhatsApp operacional | P0 | Muito relevante para o mercado brasileiro e já oferecido por concorrentes baratos |
| 4 | IA/OCR integrada ao novo Document Lifecycle | P0 | Transforma upload em classificação + extração + validação humana |
| 5 | Busca e filtros documentais sólidos | P0 | Necessários para operar acervos reais em escala |
| 6 | Dashboard operacional / compliance básico | P0 | Dá visão rápida de risco, pendências, vencimentos e requisitos |
| 7 | Relatórios + exportação + audit trail utilizável | P0 | Necessário para gestão, auditoria e percepção de valor B2B |
| 8 | Document Types configuráveis | P0 | Base para templates, IA, classificação e organização |
| 9 | Consolidar Guest Upload + Requests + Review + Recurrence como produto completo | P0 | Backend já avançado; precisa funcionar como ciclo único e coerente |
| 10 | Consolidar Storage + Versioning + Renewal | P0 | Núcleo documental precisa estar funcionalmente fechado antes do frontend final |
| 11 | Frontend completo do conjunto P0 | P0 — fechamento | Productização final após estabilização das capacidades acima |
| 12 | Reminder sequences configuráveis | P1 | Automação avançada e bom diferencial Premium |
| 13 | Escalation / múltiplos destinatários | P1 | Importante em equipes maiores e operações críticas |
| 14 | Busca OCR/full-text | P1 | Valor crescente conforme o acervo documental aumenta |
| 15 | Relatórios agendados | P1 | Conveniência relevante para gestores |
| 16 | Dossiê documental PDF/Excel | P1 | Facilita auditorias, compliance e compartilhamento |
| 17 | Bulk actions | P1 | Importante para operação em escala |
| 18 | Metadata configurável por Document Type | P1 | Flexibilidade controlada sem cair em custom fields irrestritos |
| 19 | Compartilhamento externo seguro | P1 | Link temporário, controle de acesso e futura governança |
| 20 | Assinatura eletrônica | P2 | Diferencial Premium estratégico |
| 21 | API pública | P2 | Integração com clientes maduros |
| 22 | Webhooks | P2 | Automação com sistemas externos |
| 23 | Calendar integrations | P2 | Conveniência, não core |
| 24 | Compliance score avançado | P2 | Só depois de termos métrica simples, explicável e validada |
| 25 | Portal completo do cliente | Futuro | Não obrigatório; Guest Flow pode ser mais simples e eficaz |
| 26 | SSO / SCIM / controles enterprise | Futuro | Só com evidência comercial real |

---

# 4. P0 — Funcionalidades necessárias antes do lançamento

## P0.1 — Requirement Templates

Permitir reutilizar conjuntos de requisitos documentais.

Exemplo:

```text
Template: Regularidade básica da empresa

- CND Federal
- CND Estadual
- CND Municipal
- Alvará de Funcionamento
- Contrato Social
```

Deve incluir criação, edição, duplicação, arquivamento, preview e aplicação a Subjects com prevenção de duplicidade óbvia.

---

## P0.2 — Bulk Onboarding / Importação em Massa

Objetivo: permitir que um novo cliente migre rapidamente para o Expiration Tracker.

Evolução desejada:

```text
CSV / dados
+
Subjects
+
Documents
+
Requirements
+
mapeamento
+
preview
+
dedupe
+
resume
```

Depois, processamento em lote de documentos com OCR/IA.

---

## P0.3 — WhatsApp Operacional

Usos:

- alerta de vencimento;
- pedido de documento;
- cobrança automática;
- lembrete de renovação;
- aviso ao responsável.

Email continua padrão. WhatsApp pode ser limitado por franquia/plano e monetizado conforme custo real.

---

## P0.4 — IA/OCR integrada ao Document Lifecycle

```text
DocumentVersion
        ↓
upload
        ↓
OCR
        ↓
AI extraction
        ↓
tipo documental
emissão
validade
identificador
Subject
        ↓
confidence
        ↓
human review
        ↓
accepted
```

Regra:

```text
SUGGESTED != CONFIRMED
```

---

## P0.5 — Busca e filtros documentais

Busca básica:

- nome;
- Subject;
- Document Type;
- responsável;
- tags.

Filtros:

- válido;
- vencendo;
- vencido;
- permanente;
- aguardando revisão;
- responsável;
- categoria;
- origem;
- arquivado.

---

## P0.6 — Dashboard Operacional / Compliance Básico

Exemplo:

```text
12 vencidos
18 vencendo em 30 dias
7 aguardando cliente
5 aguardando revisão
9 requisitos ausentes
6 renovações abertas
```

Por Subject:

```text
20 requisitos
17 satisfeitos
2 vencendo
1 ausente

Compliance documental: 85%
```

O percentual deve ser inicialmente simples e explicável.

---

## P0.7 — Relatórios, Exportação e Audit Trail

Relatórios:

- documentos vencidos;
- vencendo;
- Requirements ausentes;
- documentos por Subject;
- documentos por responsável;
- solicitações pendentes;
- renovações.

Audit trail deve ser legível para negócio:

```text
quem
fez o quê
quando
```

---

## P0.8 — Document Types Configuráveis

Exemplos:

```text
Alvará de Funcionamento
CND Federal
Contrato Social
Apólice
Procuração
Certificado
```

Características iniciais:

- nome;
- categoria;
- possui validade normalmente?;
- descrição;
- integração futura com metadata/IA.

---

## P0.9 — Guest Collection completa

Consolidar:

```text
Requirement
    ↓
Document Request
    ↓
Guest link
    ↓
Upload
    ↓
Received
    ↓
Review
    ↓
Accept / Reject
```

Também:

- solicitações recorrentes;
- automated chasing;
- recusa com motivo;
- solicitar novamente;
- prazo opcional;
- histórico.

---

## P0.10 — Storage + Versioning + Renewal consolidados

```text
Document
    ↓
Version 1
    ↓
expiração
    ↓
Renewal
    ↓
Version 2
    ↓
Version 1 = SUPERSEDED
```

Garantir:

- versão atual;
- versões anteriores;
- arquivos complementares;
- preview;
- download;
- validade;
- histórico.

---

# 5. P0.11 — Frontend completo e productização

Esta passa a ser a **última grande etapa do P0**.

Quando as funcionalidades anteriores estiverem funcionalmente estáveis:

```text
backend/domínio completo
        ↓
contratos consolidados
        ↓
jornadas definitivas
        ↓
arquitetura de informação final
        ↓
frontend completo
```

Escopo:

- Documents Collection;
- Document Detail;
- Upload;
- New Version;
- Requirements;
- Templates;
- Requests;
- Guest experience;
- Review Queue;
- Renewal;
- Bulk onboarding;
- IA review;
- Compliance dashboard;
- reports;
- WhatsApp configuration;
- settings;
- mobile;
- responsive;
- accessibility;
- Design System.

---

# 6. Ordem prática de desenvolvimento revisada

```text
1. Requirement Templates
        ↓
2. Bulk Onboarding / Import
        ↓
3. WhatsApp
        ↓
4. IA/OCR integrada ao novo DocumentVersion
        ↓
5. Busca e filtros documentais
        ↓
6. Compliance Dashboard
        ↓
7. Relatórios / Export / Audit
        ↓
8. Document Types configuráveis
        ↓
9. Consolidar Guest / Requests / Review / Recurrence
        ↓
10. Consolidar Storage / Versioning / Renewal
        ↓
11. FRONTEND COMPLETO DO P0
        ↓
12. Hardening / validação / onboarding comercial
        ↓
LANÇAMENTO
```

---

# 7. Comentários sobre a ordem prática

## 7.1 Templates primeiro

Templates têm ótima relação esforço/valor e ajudam a estruturar Requirements, onboarding e verticalização.

## 7.2 Bulk onboarding muito cedo

Essa capacidade remove uma das maiores barreiras comerciais:

> “Gostei, mas vou ter que cadastrar tudo de novo?”

Pode impactar aquisição mais do que várias funcionalidades sofisticadas.

## 7.3 WhatsApp antes do frontend final

WhatsApp afeta settings, planos, quotas, reminder flow, requests, chasing e notification preferences. Melhor fechar esse comportamento antes da experiência final.

## 7.4 IA antes do frontend final

A IA muda diretamente upload, review, Document Detail, bulk onboarding e metadata. Consolidar a integração primeiro reduz retrabalho visual.

## 7.5 Busca antes da productização

O frontend final deve nascer já conhecendo filtros reais, campos pesquisáveis, sorting e volumes esperados.

## 7.6 Compliance Dashboard depois de Requirements

O dashboard depende de Requirement, Document, Validity, Request, Review e Renewal já semanticamente estáveis.

## 7.7 Frontend por último dentro do P0

Isso não significa deixar UX para o final.

Durante cada feature:

- definir jornada;
- definir estados;
- definir contratos;
- registrar necessidades de UI.

Mas o acabamento e a integração total devem ocorrer uma vez, contra um domínio estabilizado.

---

# 8. Critério de lançamento

Antes do lançamento comercial, o produto deve cobrir:

### Domínio funcional

- vencimentos;
- documentos;
- versões;
- storage;
- Requirements;
- templates;
- requests;
- guest upload;
- review;
- renewal;
- recurrence;
- automated chasing.

### Produtividade

- bulk onboarding;
- busca;
- filtros;
- dashboard;
- relatórios;
- exportação.

### Automação

- OCR/IA;
- email;
- WhatsApp.

### Plataforma

- Organization;
- Membership;
- RBAC;
- audit trail;
- privacy/LGPD;
- quotas;
- entitlements básicos.

### Experiência

- frontend completo;
- mobile;
- acessibilidade;
- onboarding;
- error/recovery states;
- Design System consistente.

---

# 9. P1 — Evolução logo após o lançamento

- Reminder sequences configuráveis;
- Escalation;
- OCR full-text search;
- Relatórios agendados;
- Dossiê documental;
- Bulk actions;
- Metadata por Document Type;
- Compartilhamento externo seguro.

---

# 10. P2 — Diferenciação Premium

- Assinatura eletrônica;
- API pública;
- Webhooks;
- Calendar integrations;
- Compliance score avançado.

---

# 11. Funcionalidades deliberadamente fora do lançamento

- portal completo do cliente;
- native mobile app;
- SSO;
- SCIM;
- BPM;
- editor colaborativo;
- drive desktop;
- pastas infinitas;
- ACL por pasta;
- CRM;
- financeiro;
- ERP;
- chat completo;
- gestão fiscal completa.

Só entram com evidência comercial clara.

---

# 12. Estratégia inicial de preços

| Plano | Preço | Posicionamento |
|---|---:|---|
| Free | R$0 | Experimentação e geração de leads |
| Essencial | R$59,90/mês | Núcleo documental + vencimentos |
| Profissional | R$99,90/mês | Automação + IA + WhatsApp + compliance |
| Premium | R$149,90/mês | Automação avançada, relatórios e inteligência |

---

# 13. Estratégia de limites

Evitar depender principalmente da quantidade de empresas.

Preferir limites ligados a custo real:

```text
storage
+
IA/OCR
+
WhatsApp
+
usuários
```

Subjects e documentos podem ter limites generosos.

---

# 14. Posição competitiva desejada no lançamento

O produto não deve ser percebido como:

> “mais um lembrete de vencimentos.”

Mas como:

> **uma plataforma leve para manter obrigações documentais sob controle durante todo o ciclo de vida.**

```text
O que precisa existir?
        ↓
Requirement

Está faltando?
        ↓
Request

Cliente precisa enviar?
        ↓
Guest Upload

Chegou?
        ↓
Review

O que o documento diz?
        ↓
AI/OCR

Está válido?
        ↓
Validity

Quem cuida disso?
        ↓
Responsible

Vai vencer?
        ↓
Alerts / Chasing

Renovou?
        ↓
New Version

O que aconteceu?
        ↓
History / Audit
```

---

# 15. Resumo executivo

## Antes do lançamento

1. Requirement Templates
2. Bulk onboarding
3. WhatsApp
4. IA/OCR integrada ao novo domínio documental
5. Busca/filtros
6. Compliance dashboard
7. Relatórios/export/audit
8. Document Types
9. Consolidar Guest/Requests/Review/Recurrence
10. Consolidar Storage/Versioning/Renewal
11. Frontend completo
12. Hardening e onboarding

## Depois do lançamento

- reminder sequences;
- escalation;
- full-text search;
- scheduled reports;
- dossiês;
- bulk actions;
- metadata configurável;
- secure sharing.

## Premium futuro

- assinatura eletrônica;
- API;
- webhooks;
- integrations;
- advanced compliance.

---

# 16. Decisão estratégica final

> **O frontend completo será consolidado somente depois que as funcionalidades P0 estiverem funcionalmente prontas.**

Durante a construção do P0, UX e requisitos de tela continuam sendo definidos e registrados.

Assim:

```text
engenharia funcional P0
        ↓
escopo estável
        ↓
frontend integrado
        ↓
validação
        ↓
lançamento
```

Essa passa a ser a sequência recomendada para o Expiration Tracker.
