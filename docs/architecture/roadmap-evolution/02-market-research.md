---
status: draft
owner: Marcelo
authority: informativo (insumo de análise, não normativo)
---

# Evolução Estratégica do Roadmap — Fase 2a: Pesquisa de mercado externa

Continuação de `01-gap-analysis.md`. Pesquisa real (WebSearch/WebFetch) sobre os concorrentes
citados no prompt estratégico + categoria mais ampla, item 48 do prompt. Objetivo: confirmar ou
refutar cada capacidade proposta com evidência de mercado real, não preferência estética.

## Concorrentes investigados

| Produto | Status | Achado central |
|---|---|---|
| Remindax | Real, confirmado | Self-serve, 5 tiers ($0-$239/mês), RBAC/multi-workspace já existe, canais múltiplos (e-mail/SMS/WhatsApp/Slack) com sequências customizáveis. **Sem guest upload documentado.** |
| Doc Warden | **Não identificado** | Duas buscas (nome exato + variações) não retornaram produto correspondente — nome do prompt original pode estar incorreto/desatualizado. Não forçar correspondência. |
| SubCompliant | Real, nicho (construção civil UK) | **Implementa magic link literalmente**: link único, sem conta, e o sistema renova/reenvia automaticamente antes do vencimento. 2 destinatários por evento (contratante + subcontratado), não fan-out arbitrário. Custom document types suportados. Self-serve, "live em 10 minutos". |
| VendorJot | Real, nicho | "No-login vendor portal" — mesma mecânica de convidado, nome diferente. Free tier real, escala por vendor/workspace. |
| TrustLayer | Real, mercado maduro (298K+ empresas na rede) | Free até 50 vendors, sem cartão. Upload sem login do fornecedor, cobrança automática antes do vencimento (chasing automatizado real). IA para classificação/extração de COI. **Billing por "vendor" = `TrackedSubject` literal.** |
| Certificial | Real, mercado maduro, patenteado | Modelo diferente: verificação via integração direta com >25K agências de seguro (dado vivo de apólice), não upload de documento pelo vendor — não serve para "qualquer documento de qualquer terceiro" (caso genérico do Expiration Tracker). Free até 5 vendors, mesmo billing por sujeito. |
| Categoria ampla (myCOI, bcs, CertFocus, illumend, VComply, SmartCompliance, NetVendor, TrackMyVendor, Docutrax, TrackSurePro) | Confirmados | Pricing dominante: **por vendor/subject rastreado** (US$0,95-30/vendor/mês ou ano), nunca por usuário ou flat fee. Onboarding misto (bcs 100% self-serve prova que funciona; myCOI é sales-led com implementação paga). Free tier limitado por contagem de vendor, não por tempo (padrão diferente do "14 dias grátis" genérico de SaaS). |

## Confirmação ou refutação de cada capacidade (item 49 do prompt — tentativa de refutar)

| Capacidade | Veredito de mercado | Evidência |
|---|---|---|
| `TrackedSubject` | **Fortemente validada — é o átomo comercial do mercado, não abstração especulativa** | TrustLayer e Certificial cobram literalmente por "vendor" rastreado; toda a categoria ampla usa esse eixo de pricing, nunca por usuário |
| Guest upload / magic link | **Fortemente validada, com padrão de implementação específico a copiar** | SubCompliant, VendorJot e TrustLayer implementam a mesma mecânica (3 produtos independentes convergindo); SubCompliant renova o link automaticamente antes do vencimento — padrão específico a adotar, não genérico |
| Automated Document Chasing | **Validada** | TrustLayer e SubCompliant fazem "reach out automaticamente antes do vencimento" como parte central do produto |
| Confirmação humana obrigatória no OCR/IA (M7) | **Validada como diferencial, não cautela excessiva** | Reclamação recorrente entre múltiplos produtos (myCOI e outros) é justamente "OCR não confiável em documento não-padronizado" — o design já aprovado de M7 (human-in-the-loop) mitiga exatamente essa dor conhecida de mercado |
| Custom fields | **Valiosa, mas com risco real documentado** | myCOI tem reclamação específica de que complexidade de config cresce muito com "requisitos customizados por vendor" — reforça o próprio aviso do prompt (§23, "evite construir um Airtable"): útil, mas exige desenho simples |
| Billing por unidade de `TrackedSubject` (não por usuário/assento) | **Validado como modelo de mercado dominante** | Nenhum concorrente pesquisado cobra flat fee ou só por usuário — todos escalam por vendor/subject. Achado direto para o desenho futuro de `Plan`/`Entitlement` (item 28 do prompt) |
| Multi-canal (WhatsApp incluso) | **Parcialmente validada** | Remindax já oferece e-mail/SMS/WhatsApp/Slack com sequências customizáveis — não é overkill, mas também não é o diferencial central de nenhum concorrente pesquisado (nenhum vende WhatsApp como feature-carro-chefe) |
| Múltiplos destinatários / escalation | **Validada em forma limitada, não genérica** | SubCompliant notifica 2 partes fixas (contratante+subcontratado) por evento — evidência aponta para "papéis fixos conhecidos" (ex. ASSIGNEE + EXTERNAL_CONTACT), não necessariamente um sistema de fan-out arbitrário de N destinatários configuráveis |
| Digest (IMMEDIATE/DAILY/WEEKLY) | **Sem evidência de mercado, nem a favor nem contra** | Nenhum dos 6 produtos pesquisados menciona digest — pode ser um não-problema nesta categoria (volume de vendors por cliente é baixo o suficiente para não gerar fadiga), ou só não é destacado em marketing. Permanece questão aberta, não decidida por esta pesquisa |
| RBAC/Organization | **Confirmada como table stakes, não diferencial** | Remindax já tem; é esperado pelo mercado, mas nenhum concorrente vende isso como vantagem competitiva central |
| Onboarding self-serve para 10-30 clientes iniciais | **Validado como viável nesta categoria** | bcs prova que self-serve puro funciona no segmento de entrada; myCOI prova que sales-led/alto-toque também coexiste para contas maiores — a tese comercial do Expiration Tracker (poucos clientes, alto padrão de engenharia) é compatível com self-serve |

## Achado transversal mais importante para a Fase 2b (modelagem de domínio)

O modelo de billing de mercado inteiro converge em **cobrar por sujeito rastreado**, não por usuário.
Isso não é só validação de `TrackedSubject` como conceito de domínio — é argumento direto de que
`TrackedSubject` deve ser desenhado desde já como a unidade que o futuro `Plan`/`Entitlement`/
`UsageQuota` vai referenciar, para não exigir retrabalho quando billing (item 28) for desenhado.

O padrão SubCompliant (magic link com renovação automática antes do vencimento) é o benchmark de
UX mais direto a copiar para `DocumentRequest`/guest upload — mais específico e testado em produto
real do que qualquer alternativa hipotética que fosse desenhada do zero.

## Próxima ação

Fase 2b: modelagem de domínio propriamente dita (nomes de entidade, agregados, decisões de
persistência) para os clusters de decisão identificados, seguida das rodadas do protocolo
Claude↔Codex por tema. Primeiro cluster: `TrackedSubject` + `Requirement`/`RequirementAssignment`
(base de dependência de tudo mais, conforme DAG do prompt estratégico §36).
