# Planos e Preços — OmniVence (2026-09-27)

**Pedido por:** Marcelo, 2026-09-27, na sequência direta de D-345 (multi-org gated por plano) e D-346 (pesquisa de concorrência). Objetivo: definir planos, funcionalidades por plano e valores concretos, com vantagem de preço e de funcionalidades sobre a concorrência.

**Isto é uma PROPOSTA (Rodada 2 do protocolo Claude↔Codex, revisada após a crítica da Rodada 1 — seção 7) — não uma decisão. Marcelo decide.**

---

## 1. Grounding — o que já está decidido/pesquisado antes desta proposta

Não é uma decisão do zero. Três fontes internas já existentes restringem o desenho:

1. **`docs/architecture/roadmap-evolution/02-market-research.md`** (pesquisa de mercado anterior, arquitetura): o eixo de billing dominante do mercado inteiro é **fornecedor/item rastreado (`TrackedSubject`), nunca usuário/assento** — "nenhum concorrente pesquisado cobra flat fee ou só por usuário". Já parcialmente implementado: `src/modules/subject/domain/entitlement.ts` tem `activeTrackedSubjectsLimit` com default 25 (citando o precedente real da bcs, "25 vendors grátis, sem cartão").
2. **`docs/architecture/reviews/storage-quota-scoping/market-research-storage-limits-2026-09-09.md`** (pesquisa de mercado dedicada a storage): produtos estruturalmente parecidos com o OmniVence (compliance por fornecedor, não lembrete simples) tratam storage como **não-diferencial, frequentemente ilimitado** — o valor cobrado está no volume de fornecedores rastreados, nunca em bytes. O default técnico já implementado (`DEFAULT_STORAGE_QUOTA_BYTES`, `src/modules/document-archive/domain/storage-quota.ts`) é 8GB, flat, sem variação por plano.
3. **D-345/D-346** (`decisions-log.md`, `docs/project/pesquisa-concorrencia-2026-09-27.md`): multi-organização por dono, gated por plano (decidido, não implementado); pricing atual já ~2,5-10x mais barato que qualquer concorrente comparável em BRL; Remindax é o precedente mais próximo de "número de organizações como alavanca de tier" (1/2/2/3 empresas por tier pago) e de "compra avulsa de organização extra sem subir de tier inteiro" — mecânica de pagador/downgrade/transferência ainda não resolvida tecnicamente (D-346 seção 5.3), registrada aqui de novo como pendência, não fingida como resolvida.

**Consequência de desenho**: os planos abaixo diferenciam por **fornecedores ativos incluídos + organizações incluídas + funcionalidades**, nunca por número de usuários (sem cobrança por assento) e sem tratar storage como eixo de venda (mantido generoso e relativamente uniforme entre tiers pagos).

## 2. O que está realmente implementado hoje (baseline, roadmap §18.2/§18.3)

**Correção da Rodada 1 (achado real do Codex)**: "Telegram" foi removido da lista abaixo — nunca foi implementado (só planejado no design original de `ARCHITECTURE.md`; o schema real de notificação só aceita `EMAIL`/`WHATSAPP`). Erro que também estava em D-346, corrigido lá também.

Todo plano pago inclui o núcleo já entregue: cadastro com vencimento + lembretes por e-mail (WhatsApp gated por E-019, jurídico, independente do plano), Requirement Templates, importação em massa, IA/OCR com verificação humana obrigatória, busca/filtros, dashboard de compliance, **relatórios agendados, dossiê PDF/Excel, export/audit trail** (roadmap §18.3 — todos já entregues, **corrigido: a versão anterior desta proposta os reservava ao Profissional, contradizendo a própria regra desta seção de que funcionalidade entregue não é diferencial de tier**), Document Types configuráveis, Guest Upload/Requests/Review/Recorrência, Storage/Versioning/Renewal (ressalva: versionamento completo por documento, item-level, segue suspenso — D-313 cobre "baixar documento", não histórico completo), ações em massa, compartilhamento externo seguro (`ExternalShareLink`). **Isto não é diferencial de tier — é o produto.** O que diferencia tiers é: limites (fornecedores/organizações/usuários) e as poucas funcionalidades ainda não construídas (roadmap §18.4/§18.5: e-signature, API/webhooks, calendário, score de compliance, portal completo, SSO).

## 3. Proposta de planos

| | **Free** | **Essencial** | **Profissional** | **Premium** |
|---|---:|---:|---:|---:|
| **Preço/mês** | R$0 | R$59,90 | R$99,90 | R$149,90 |
| **Organizações incluídas** (D-345) | 1 | 1 | até 2 | até 5 |
| **Fornecedores ativos incluídos por organização** (`TrackedSubject`) | 25 | 100 | 500 | 2.000 |
| **Usuários incluídos por organização** (nunca cobrado por assento — acima do limite, upgrade de tier, nunca assento avulso pago) | 2 | 5 | 15 | Ilimitado |
| **Armazenamento por organização** | 8 GB | 8 GB | 20 GB | 50 GB |
| **Módulo Fornecedores (Requisitos/Guest Upload/IA-OCR)** | Limitado — até 3 fornecedores, sem templates/export (ver 3.1) | ✅ completo | ✅ completo | ✅ completo |
| **Relatórios agendados, dossiê, export/audit trail** (já entregues) | ❌ | ✅ | ✅ | ✅ |
| **Busca full-text** (quando implementada, D-202) | ❌ | ❌ | ✅ | ✅ |
| **Score de compliance** (quando implementado) | ❌ | ❌ | ✅ | ✅ |
| **Assinatura eletrônica, API/webhooks, calendário** (quando implementados) | ❌ | ❌ | ❌ | ✅ |
| **Portal completo do fornecedor, SSO** (quando implementados) | ❌ | ❌ | ❌ | ❌ (Futuro, fora de todo tier por ora) |
| **Suporte** | Comunidade/e-mail | E-mail | E-mail prioritário | Prioritário + onboarding assistido |

**Nota sobre "por organização" (achado real do Codex — D-346 §5.3 já registrava que cotas são por-organização, sem compartilhamento entre as orgs do mesmo dono; a versão anterior desta proposta não deixava isso claro)**: um `OWNER` Premium com 5 organizações tem até 5×2.000 fornecedores e até 5×50GB = 250GB no agregado, não um total compartilhado de 2.000/50GB entre todas. Cada organização é uma conta B2B completa e independente.

### 3.1 Por que Free tem o módulo Fornecedores limitado, não ausente

**Correção da Rodada 1 (risco real de negócio apontado pelo Codex)**: excluir o módulo B2B inteiramente do Free impede a pessoa experimentar o fluxo completo (solicitação → upload do fornecedor → revisão) antes de decidir pagar — o funil de conversão fica cego. Corrigido: Free inclui o módulo com um teto pequeno (3 fornecedores, sem templates/relatórios/dossiê), suficiente para demonstrar o valor central sem servir como substituto do plano pago. O restante do produto (vencimentos pessoais) continua sem essa limitação, dentro do teto geral de 25 `TrackedSubject`.

### 3.2 Fornecedores ativos incluídos — de onde vêm os números

- Free = 25 (geral) / 3 (módulo Fornecedores): 25 mantém o default já codificado (`DEFAULT_ACTIVE_TRACKED_SUBJECTS_LIMIT`), que já cita o precedente real da bcs; o sub-limite de 3 para o módulo B2B é novo, proposto nesta rodada.
- Essencial/Profissional/Premium (100/500/2.000): **números propostos nesta rodada, sem precedente de mercado direto** — a pesquisa de mercado validou o EIXO (cobrar por fornecedor), não os valores absolutos de cada faixa de preço nacional. Marcados aqui explicitamente como hipótese, não fato de mercado.

### 3.3 Armazenamento — por que quase uniforme entre tiers

Segue a recomendação explícita da pesquisa de 2026-09-09: produtos do nosso segmento (compliance por fornecedor, não lembrete simples) tratam storage como não-diferencial. Mantido em 8GB (mesmo do default técnico atual) nos 2 tiers de entrada, com um salto moderado em Profissional/Premium (20GB/50GB, por organização) só para acomodar o volume maior de fornecedores/documentos desses tiers — não para vender storage como feature.

### 3.4 Gating de multi-organização — reaproveita D-345/D-346, não reabre a mecânica pendente

Números (1/1/2/5) mantidos de D-346 seção 5.3. **A mecânica de pagador/downgrade/transferência de titularidade permanece um gap de design real, não resolvido aqui** — esta proposta só confirma os números de inclusão por tier, não a implementação. Compra de organização extra avulsa (precedente Remindax) fica como direção a explorar, preço avulso não definido nesta rodada.

### 3.5 Cota de IA/OCR e política de excedente — gap real, não resolvido nesta rodada

**Achado do Codex, Rodada 1**: fornecedores incluídos não limitam páginas de OCR, reprocessamentos ou mensagens enviadas — sem uma cota mensal de chamadas de IA/OCR e uma regra clara de excedente (bloquear? cobrar por unidade extra? degradar para fila?), o custo de servir cada tier é indeterminado. **Não resolvido nesta proposta** — precisa de uma rodada dedicada com dados reais de custo de Textract/Bedrock por documento (nenhum dado de custo real foi levantado nesta pesquisa), antes de qualquer preço final ser considerado fechado.

## 4. Comparação direta com a concorrência

**Achado do Codex, Rodada 1**: os números de "fornecedores incluídos" da Remindax/Expiration Reminder na versão anterior desta seção não estavam registrados em D-346 (D-346 só registra preço, não volume de itens por tier) — eram alegações novas, não verificadas. Corrigido: números abaixo verificados de novo diretamente nas páginas oficiais nesta rodada, citados como tal (não como "já em D-346").

| | OmniVence Essencial | OmniVence Profissional | Remindax Professional (mais próximo em preço) | Expiration Reminder Standard |
|---|---:|---:|---:|---:|
| Preço/mês | R$59,90 (~US$11) | R$99,90 (~US$19) | US$79 (~R$419), 2 empresas | US$99 (~R$525), 1 empresa |
| Itens/fornecedores incluídos | 100 | 500 | 700 itens (não confirmado como "fornecedor" — unidade pode não ser equivalente, ver ressalva) | 600 registros (mesma ressalva) |
| Organizações incluídas | 1 | até 2 | 2 | 1 (workspace extra ~US$49/mês, ~R$260) |
| Guest upload sem conta | ✅ | ✅ | Não confirmado em D-346 | Não confirmado — "não identificado nas fontes" não é o mesmo que "comprovadamente ausente" |
| IA/OCR + verificação humana obrigatória | ✅ | ✅ | Não confirmado | Reivindica IA, sem verificação humana explícita |

**Ressalva de unidade (achado real do Codex)**: "fornecedor rastreado" (nosso `TrackedSubject`, uma entidade que pode exigir vários documentos/requisitos) não é necessariamente equivalente a "item"/"registro" desses concorrentes (pode ser 1 documento = 1 item). Comparar capacidade nominal (100 vs. 700) sem esse cuidado é enganoso — mantido aqui só como referência de ordem de grandeza, não como prova de capacidade superior.

**Vantagem de preço, recalculada com cuidado**: Essencial é ~7x mais barato que o Remindax Professional mais próximo em capacidade nominal (R$59,90 vs. R$419); Profissional é ~4,2x mais barato que o mesmo comparável em preço absoluto. **Não alego "3-6x" genérico como a versão anterior fazia — cada par de comparação tem sua própria razão, declarada aqui.** **Vantagem de funcionalidade**: guest upload sem conta + IA/OCR com verificação humana obrigatória no mesmo produto não foi confirmado em nenhum concorrente direto — tratado como diferencial provável, não comprovado, seguindo a mesma disciplina de linguagem de D-346.

## 5. Checklist de critérios de nota (E-014)

**Declaração de pesquisa externa: SIM** — reaproveita 3 pesquisas já existentes (D-346, `02-market-research.md`, pesquisa de storage 2026-09-09) mais verificação pontual nova (seção 4), todas com fonte+data, e várias hipóteses novas (fornecedores por tier pago, sub-limite do Free, cota de IA/OCR) marcadas honestamente como tal.

**Reponderado na Rodada 2 por sugestão do Codex** (a versão original premiava só documentação correta, sem cobrir viabilidade econômica nem coerência comercial):

| # | Critério | Peso | Atende | Não atende |
|---|---|---|---|---|
| 1 | **Sustentabilidade econômica** — a proposta reconhece explicitamente onde falta cálculo de custo de servir (IA/OCR, storage, WhatsApp) antes de qualquer preço ser considerado final | 25% | Gap de custo nomeado explicitamente (seção 3.5), nunca escondido | Preço apresentado como decidido sem essa ressalva |
| 2 | **Adequação ao público-alvo / conversão** — o tier Free permite experimentar o valor central do produto (módulo B2B) antes de pagar, sem servir de substituto do pago | 20% | Free tem alguma exposição ao módulo B2B com teto real | Free exclui o diferencial central inteiramente, ou não tem teto nenhum |
| 3 | **Coerência das franquias e regras comerciais** — toda franquia (fornecedores/storage/usuários) declara se é por-organização ou agregada, e o que acontece ao ultrapassar (upgrade, bloqueio, cobrança) | 20% | Cada franquia tem escopo e comportamento de excedente explícitos | Franquia ambígua ou sem regra de excedente |
| 4 | **Comparação competitiva normalizada** — preços/capacidades comparados na mesma unidade, mesmo período, mesma moeda convertida, com ressalva quando a unidade não é equivalente | 15% | Toda comparação declara unidade/período/câmbio e ressalva de equivalência | Comparação mistura unidades sem ressalva |
| 5 | **Disponibilidade real** — nenhuma funcionalidade não implementada é listada como disponível hoje, e nenhuma alegação sobre o produto (não só sobre concorrentes) é feita sem verificar contra o código real | 10% | Toda feature futura marcada "quando implementada"; alegações sobre o próprio produto verificadas no código | Feature futura sem ressalva, ou alegação sobre o produto não verificada (ex. Telegram, R1) |
| 6 | **Rastreabilidade e reconciliação** — todo número cita a fonte interna ou externa que o embasa, e nenhuma proposta contradiz uma decisão/pesquisa já registrada sem justificar | 10% | Cada eixo cita a fonte | Número sem fonte, ou contradição não justificada |

---

## 6. Revisão Claude↔Codex — Rodada 1 (2026-09-27)

**Nota do Codex: proposta 5,0/10, régua 6,0/10 — régua contestada.** Achados reais, todos corrigidos nas seções acima:

1. **Erro grave sobre o próprio produto**: "Telegram" listado como canal implementado — nunca foi construído (só design). Achado que também exigiu correção em D-346 (6 rodadas anteriores não pegaram isso).
2. Free excluía o módulo Fornecedores inteiramente — risco real de funil de conversão cego, corrigido para incluir com teto de 3.
3. Relatórios agendados/dossiê (já entregues, roadmap §18.3) estavam reservados ao Profissional, contradizendo a própria regra da seção 2 — corrigido, movidos para todos os tiers pagos.
4. Ambiguidade sobre se fornecedores/storage/usuários são por-organização ou agregados entre as organizações do dono — esclarecido: por-organização, sem compartilhamento (D-346 §5.3 já registrava isso, não estava explícito aqui).
5. Comparação com concorrentes (seção 4) usava números de volume ("200-700", "150-600" fornecedores) que não estavam registrados em D-346 — corrigido, números reverificados diretamente e citados como verificação desta rodada, não de D-346.
6. "Fornecedor" comparado diretamente com "item"/"registro" dos concorrentes sem reconhecer que as unidades podem não ser equivalentes — ressalva adicionada.
7. "3-6x mais barato" genérico sem base clara — substituído por razões calculadas par a par, declaradas.
8. Cota de IA/OCR e regra de excedente não definidas — gap real, registrado explicitamente na nova seção 3.5, não resolvido (precisa de dados de custo real).
9. Checklist reponderado (o Codex apontou que a versão original premiava só documentação, não viabilidade econômica/comercial) — nova distribuição: sustentabilidade econômica 25%, adequação/conversão 20%, coerência de franquias 20%, comparação normalizada 15%, disponibilidade real 10%, rastreabilidade 10%.

**Status**: Rodada 1 completa, não convergida. Rodada 2 (correções acima) aguarda nova crítica do Codex (seção 7).

## 7. Revisão Claude↔Codex — Rodada 2 (pendente)

Aguardando resposta do Codex à proposta revisada (seções 2-5).

---

## 8. Limitações desta proposta

- Os números de fornecedores incluídos por tier pago (100/500/2.000, mais o sub-limite de 3 no Free) não têm precedente de mercado direto, diferente do eixo em si (validado 2x).
- Cota de IA/OCR mensal e política de excedente **não definidas** — gap real, seção 3.5.
- Não inclui cálculo de custo de servir por tier (OCR/IA, WhatsApp, storage têm custo variável real) — D-346 seção 5.2 já registrou isso como pré-requisito antes de fixar preço final, ainda não feito.
- Preço avulso de organização extra (Profissional/Premium) não definido.
- Comparação da seção 4 usa "itens/registros" dos concorrentes como proxy de "fornecedores" nosso — unidades podem não ser equivalentes, ressalva já registrada, mas não eliminada.
