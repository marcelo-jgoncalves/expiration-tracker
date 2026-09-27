# Planos e Preços — OmniVence (2026-09-27)

**Pedido por:** Marcelo, 2026-09-27, na sequência direta de D-345 (multi-org gated por plano) e D-346 (pesquisa de concorrência). Objetivo: definir planos, funcionalidades por plano e valores concretos, com vantagem de preço e de funcionalidades sobre a concorrência.

**Isto é uma PROPOSTA (Rodada 1 do protocolo Claude↔Codex) — não uma decisão. Marcelo decide.**

---

## 1. Grounding — o que já está decidido/pesquisado antes desta proposta

Não é uma decisão do zero. Três fontes internas já existentes restringem o desenho:

1. **`docs/architecture/roadmap-evolution/02-market-research.md`** (pesquisa de mercado anterior, arquitetura): o eixo de billing dominante do mercado inteiro é **fornecedor/item rastreado (`TrackedSubject`), nunca usuário/assento** — "nenhum concorrente pesquisado cobra flat fee ou só por usuário". Já parcialmente implementado: `src/modules/subject/domain/entitlement.ts` tem `activeTrackedSubjectsLimit` com default 25 (citando o precedente real da bcs, "25 vendors grátis, sem cartão").
2. **`docs/architecture/reviews/storage-quota-scoping/market-research-storage-limits-2026-09-09.md`** (pesquisa de mercado dedicada a storage): produtos estruturalmente parecidos com o OmniVence (compliance por fornecedor, não lembrete simples) tratam storage como **não-diferencial, frequentemente ilimitado** — o valor cobrado está no volume de fornecedores rastreados, nunca em bytes. O default técnico já implementado (`DEFAULT_STORAGE_QUOTA_BYTES`, `src/modules/document-archive/domain/storage-quota.ts`) é 8GB, flat, sem variação por plano.
3. **D-345/D-346** (`decisions-log.md`, `docs/project/pesquisa-concorrencia-2026-09-27.md`): multi-organização por dono, gated por plano (decidido, não implementado); pricing atual já ~2,5-10x mais barato que qualquer concorrente comparável em BRL; Remindax é o precedente mais próximo de "número de organizações como alavanca de tier" (1/2/2/3 empresas por tier pago) e de "compra avulsa de organização extra sem subir de tier inteiro" — mecânica de pagador/downgrade/transferência ainda não resolvida tecnicamente (D-346 seção 5.3), registrada aqui de novo como pendência, não fingida como resolvida.

**Consequência de desenho**: os planos abaixo diferenciam por **fornecedores ativos incluídos + organizações incluídas + funcionalidades**, nunca por número de usuários (sem cobrança por assento) e sem tratar storage como eixo de venda (mantido generoso e relativamente uniforme entre tiers pagos).

## 2. O que está realmente implementado hoje (baseline, roadmap §18.2/§18.3)

Todo plano pago inclui o núcleo já entregue: cadastro com vencimento + lembretes por e-mail/Telegram (WhatsApp gated por E-019, jurídico, independente do plano), Requirement Templates, importação em massa, IA/OCR com verificação humana obrigatória, busca/filtros, dashboard de compliance, relatórios/export/audit trail, Document Types configuráveis, Guest Upload/Requests/Review/Recorrência, Storage/Versioning/Renewal, ações em massa, compartilhamento externo seguro (`ExternalShareLink`). **Isto não é diferencial de tier — é o produto.** O que diferencia tiers é: limites (fornecedores/organizações) e as poucas funcionalidades ainda não construídas (roadmap §18.4/§18.5: e-signature, API/webhooks, calendário, score de compliance, portal completo, SSO).

## 3. Proposta de planos

| | **Free** | **Essencial** | **Profissional** | **Premium** |
|---|---:|---:|---:|---:|
| **Preço/mês** | R$0 | R$59,90 | R$99,90 | R$149,90 |
| **Organizações incluídas** (D-345) | 1 | 1 | até 2 | até 5 |
| **Fornecedores ativos incluídos** (`TrackedSubject`) | 25 | 100 | 500 | 2.000 |
| **Usuários incluídos** (nunca cobrado por assento) | 2 | 5 | 15 | Ilimitado |
| **Armazenamento** | 8 GB | 8 GB | 20 GB | 50 GB |
| **Canais de lembrete** | E-mail | E-mail + Telegram + WhatsApp¹ | Idem | Idem |
| **Módulo Fornecedores (Requisitos/Guest Upload/IA-OCR)** | ❌ | ✅ | ✅ | ✅ |
| **Templates de requisito, import em massa, relatórios básicos** | Parcial (sem templates) | ✅ | ✅ | ✅ |
| **Relatórios agendados, dossiê PDF/Excel** | ❌ | ❌ | ✅ | ✅ |
| **Busca full-text** (quando implementada, D-202) | ❌ | ❌ | ✅ | ✅ |
| **Score de compliance** (quando implementado) | ❌ | ❌ | ✅ | ✅ |
| **Assinatura eletrônica, API/webhooks, calendário** (quando implementados) | ❌ | ❌ | ❌ | ✅ |
| **Portal completo do fornecedor, SSO** (quando implementados) | ❌ | ❌ | ❌ | ❌ (Futuro, fora de todo tier por ora) |
| **Suporte** | Comunidade/e-mail | E-mail | E-mail prioritário | Prioritário + onboarding assistido |

¹ WhatsApp permanece gated por E-019 (parecer jurídico) independente do plano — listado no tier onde entraria assim que liberado, não uma promessa de disponibilidade imediata.

### 3.1 Por que Free não tem o módulo Fornecedores

Decisão de desenho, não limitação técnica: o módulo B2B (Requisitos documentais + Guest Upload + IA/OCR) é o diferencial competitivo mais forte encontrado em D-346 (nenhum concorrente combina isso com preço público acessível) — colocá-lo atrás do Free cria um motivo concreto de upgrade que não depende de "mais volume", apenas do valor central do produto B2B. O Free ainda cobre 100% do caso de uso pessoal/PME simples (controle de vencimentos próprios), que é diferente do caso de uso de fornecedores de terceiros.

### 3.2 Fornecedores ativos incluídos — de onde vêm os números

- Free = 25: mantém o default já codificado (`DEFAULT_ACTIVE_TRACKED_SUBJECTS_LIMIT`), que já cita o precedente real da bcs.
- Essencial/Profissional/Premium (100/500/2.000): **novos números propostos nesta rodada, sem precedente de mercado direto encontrado em D-346 ou em `02-market-research.md`** — a pesquisa de mercado validou o EIXO (cobrar por fornecedor), não os valores absolutos de cada faixa de preço nacional. Marcados aqui explicitamente como hipótese, não fato de mercado.

### 3.3 Armazenamento — por que quase uniforme entre tiers

Segue a recomendação explícita da pesquisa de 2026-09-09: produtos do nosso segmento (compliance por fornecedor, não lembrete simples) tratam storage como não-diferencial. Mantido em 8GB (mesmo do default técnico atual) nos 2 tiers de entrada, com um salto moderado em Profissional/Premium (20GB/50GB) só para acomodar o volume maior de fornecedores/documentos desses tiers — não para vender storage como feature.

### 3.4 Gating de multi-organização — reaproveita D-345/D-346, não reabre a mecânica pendente

Números (1/1/2/5) mantidos de D-346 seção 5.3. **A mecânica de pagador/downgrade/transferência de titularidade permanece um gap de design real, não resolvido aqui** — esta proposta só confirma os números de inclusão por tier, não a implementação. Compra de organização extra avulsa (precedente Remindax) fica como direção a explorar, preço avulso não definido nesta rodada.

## 4. Comparação direta com a concorrência (reaproveitando D-346)

| | OmniVence Essencial | OmniVence Profissional | Remindax (mais próximo) | Expiration Reminder |
|---|---:|---:|---:|---:|
| Preço/mês | R$59,90 (~US$11) | R$99,90 (~US$19) | US$29-79 (~R$154-419) | US$49-179 (~R$260-949) |
| Fornecedores incluídos | 100 | 500 | 200-700 | 150-600 |
| Organizações incluídas | 1 | até 2 | 1-2 | 1 (workspace extra R$260/mês) |
| Guest upload + IA/OCR + verificação humana | ✅ | ✅ | Parcial (sem guest upload confirmado) | Parcial (sem guest upload confirmado) |
| WhatsApp + Telegram | ✅¹ | ✅¹ | WhatsApp só (Slack, não Telegram) | WhatsApp só |

**Vantagem de preço**: 3-6x mais barato que os concorrentes funcionalmente mais próximos, para um número de fornecedores incluídos na mesma ordem de grandeza. **Vantagem de funcionalidade**: nenhum concorrente identificado em D-346 combina guest upload sem conta + IA/OCR com verificação humana obrigatória + WhatsApp e Telegram no mesmo produto.

## 5. Checklist de critérios de nota (E-014)

**Declaração de pesquisa externa: SIM** — reaproveita 3 pesquisas já existentes (D-346, `02-market-research.md`, pesquisa de storage 2026-09-09), todas com fonte+data, mais uma pergunta nova (valores absolutos de fornecedores incluídos por tier) marcada honestamente como hipótese sem precedente direto.

| # | Critério | Peso | Atende | Não atende |
|---|---|---|---|---|
| 1 | **Reconciliação com pesquisa/decisões já existentes** — nenhum número ou funcionalidade proposta contradiz `02-market-research.md`, a pesquisa de storage, D-345 ou D-346 sem justificar a mudança | 25% | Cada eixo cita a fonte interna que o embasa | Número inventado sem citar por que diverge da pesquisa prévia |
| 2 | **Honestidade sobre o que é hipótese vs. precedente** — valores sem base de mercado direta (fornecedores por tier pago, cota de IA/OCR) são marcados como tal, não apresentados com a confiança de um dado de pesquisa | 20% | Toda hipótese nova rotulada explicitamente | Hipótese nova apresentada como fato de mercado |
| 3 | **Consistência com o estado real do produto** — funcionalidade listada como incluída em um tier só se já está implementada, ou marcada "quando implementada" se não está | 20% | Toda feature do roadmap P2/Futuro tem a ressalva | Feature não implementada listada como disponível hoje |
| 4 | **Vantagem competitiva defensável** — a comparação direta com concorrentes (seção 4) usa números já verificados em D-346, não novas alegações não verificadas | 15% | Toda comparação cita a linha correspondente de D-346 | Comparação usa número não verificado em D-346 |
| 5 | **Gap de multi-org não escondido** — a proposta não finge que a mecânica de pagador/downgrade (D-346 §5.3) está resolvida só porque os números de inclusão por tier foram definidos | 10% | Gap reafirmado explicitamente | Gap tratado como resolvido |
| 6 | **Coerência de billing** — nenhum eixo de cobrança proposto contradiz o achado validado 2x de "nunca cobrar por usuário/assento" | 10% | Usuários incluídos citados como soft-cap, nunca como unidade de cobrança | Qualquer menção a "preço por usuário" |

---

## 6. Limitações desta proposta

- Os números de fornecedores incluídos por tier pago (100/500/2.000) e a cota de IA/OCR mensal (não incluída na tabela — pendente de definição) não têm precedente de mercado direto, diferente do eixo em si (validado 2x).
- Não inclui cálculo de custo de servir por tier (OCR/IA, WhatsApp, storage têm custo variável real) — D-346 seção 5.2 já registrou isso como pré-requisito antes de fixar preço final, ainda não feito.
- Preço avulso de organização extra (Profissional/Premium) não definido.
