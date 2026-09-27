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
| **Fornecedores ativos incluídos por organização** (`TrackedSubject` — entidade do módulo B2B/Requisitos) | 25 | 100 | 500 | 2.000 |
| **Vencimentos pessoais incluídos por organização** (`ExpirationItem` — entidade distinta, sem cota técnica hoje) | Sem limite técnico (ver 3.1) | Sem limite técnico | Sem limite técnico | Sem limite técnico |
| **Usuários incluídos por organização** (nunca cobrado por assento — acima do limite, upgrade de tier, nunca assento avulso pago) | 2 | 5 | 15 | Ilimitado |
| **Armazenamento por organização** | 8 GB | 8 GB | 20 GB | 50 GB |
| **Módulo Fornecedores (Requisitos/Guest Upload/IA-OCR)** | ✅ completo, até 25 fornecedores | ✅ completo | ✅ completo | ✅ completo |
| **Relatórios agendados, dossiê, export/audit trail** (já entregues) | ❌ | ✅ | ✅ | ✅ |
| **Busca full-text** (quando implementada, D-202) | ❌ | ❌ | ✅ | ✅ |
| **Score de compliance** (quando implementado) | ❌ | ❌ | ✅ | ✅ |
| **Assinatura eletrônica, API/webhooks, calendário** (quando implementados) | ❌ | ❌ | ❌ | ✅ |
| **Portal completo do fornecedor, SSO** (quando implementados) | ❌ | ❌ | ❌ | ❌ (Futuro, fora de todo tier por ora) |
| **Suporte** | Comunidade/e-mail | E-mail | E-mail prioritário | Prioritário + onboarding assistido |

**Nota sobre "por organização" (achado real do Codex — D-346 §5.3 já registrava que cotas são por-organização, sem compartilhamento entre as orgs do mesmo dono; a versão anterior desta proposta não deixava isso claro)**: um `OWNER` Premium com 5 organizações tem até 5×2.000 fornecedores e até 5×50GB = 250GB no agregado, não um total compartilhado de 2.000/50GB entre todas. Cada organização é uma conta B2B completa e independente.

### 3.1 Correção de modelo de domínio (achado real da Rodada 2): `TrackedSubject` ≠ `ExpirationItem`

A Rodada 2 tratava "25 fornecedores" e "vencimentos pessoais ilimitados" como o mesmo eixo, com um sub-limite artificial de "3 fornecedores" no meio — o Codex apontou corretamente que isso confundia duas entidades distintas do domínio real:
- **`TrackedSubject`** (fornecedor/parceiro) — a entidade do módulo B2B (Requisitos documentais, Guest Upload, IA/OCR). Já tem cota técnica real (`activeTrackedSubjectsLimit`, default 25 no free).
- **`ExpirationItem`** (vencimento pessoal — certidão, contrato, seguro, documento de veículo, etc., sem vínculo a um fornecedor) — entidade separada, **sem nenhuma cota técnica hoje** (não existe `activeItemsLimit` nem equivalente no código).

**Correção**: Free ganha acesso **completo** ao módulo Fornecedores (não mais "limitado"), dentro do teto já existente de 25 `TrackedSubject` — resolve o risco de funil de conversão cego (D-346/Rodada 1) sem inventar um sub-limite novo e confuso. `ExpirationItem` (vencimentos pessoais) fica sem cota técnica em nenhum tier — mecanismo não existe hoje, e criar um está fora do escopo desta proposta de preço (registrado como pendência técnica, seção 3.5).

**Comportamento ao atingir o teto de fornecedores** (achado da Rodada 2, não respondido antes): criação/ativação de um fornecedor além do limite do tier é bloqueada com mensagem explícita + CTA de upgrade; os fornecedores já ativos continuam funcionando normalmente. Arquivar um fornecedor libera a vaga (mesma semântica que `TrackedSubjectStatus` já usa para "ACTIVE").

### 3.2 Fornecedores ativos incluídos — de onde vêm os números

- Free = 25: mantém o default já codificado (`DEFAULT_ACTIVE_TRACKED_SUBJECTS_LIMIT`), que já cita o precedente real da bcs.
- Essencial/Profissional/Premium (100/500/2.000): **números propostos nesta rodada, sem precedente de mercado direto** — a pesquisa de mercado validou o EIXO (cobrar por fornecedor), não os valores absolutos de cada faixa de preço nacional. Marcados aqui explicitamente como hipótese, não fato de mercado.

### 3.3 Armazenamento — por que quase uniforme entre tiers

Segue a recomendação explícita da pesquisa de 2026-09-09: produtos do nosso segmento (compliance por fornecedor, não lembrete simples) tratam storage como não-diferencial. Mantido em 8GB (mesmo do default técnico atual) nos 2 tiers de entrada, com um salto moderado em Profissional/Premium (20GB/50GB, por organização) só para acomodar o volume maior de fornecedores/documentos desses tiers — não para vender storage como feature.

### 3.4 Gating de multi-organização — reaproveita D-345/D-346, não reabre a mecânica pendente

Números (1/1/2/5) mantidos de D-346 seção 5.3. **A mecânica de pagador/downgrade/transferência de titularidade permanece um gap de design real, não resolvido aqui** — esta proposta só confirma os números de inclusão por tier, não a implementação. Compra de organização extra avulsa (precedente Remindax) fica como direção a explorar, preço avulso não definido nesta rodada.

### 3.5 Cota de IA/OCR, política de excedente e estimativa de custo — parcialmente endereçado na Rodada 2

**Ainda não resolvido**: cota mensal explícita de chamadas de IA/OCR por tier e regra de excedente (bloquear? cobrar por unidade extra? degradar para fila?) — precisa de uma rodada dedicada com dados reais de consumo, não só de custo unitário.

**Estimativa de ordem de grandeza, nova nesta rodada (resposta parcial ao achado do Codex de que reconhecer a lacuna não é o mesmo que resolvê-la)** — números públicos de preço AWS (não um levantamento de custo real do produto, só uma primeira aproximação para checar se a faixa de preço é plausível antes de uma análise de custo real):
- Textract (OCR básico): ~US$1,50/1.000 páginas.
- Bedrock (fallback LLM em baixa confiança): ~US$0,01-0,02 por chamada típica de documento curto.
- WhatsApp Business API (quando E-019 liberar): ~R$0,10-0,15 por conversa iniciada, ordem de grandeza de mercado.
- S3/storage: ~US$0,023/GB/mês — irrelevante na escala de 8-50GB (<R$6/mês).
- Cenário Essencial (100 fornecedores, hipótese de ~10% precisando de nova verificação de documento/mês): ~10 chamadas IA/OCR/mês (~R$3) + ~200 lembretes WhatsApp/mês (~R$25) ≈ **R$30-35/mês de custo variável estimado**, contra R$59,90 de preço — margem bruta estimada de ~40-45% antes de custos fixos (suporte, infra base, e-mail). **Isto é uma estimativa ilustrativa de ordem de grandeza feita nesta rodada, não uma análise de custo real validada** — não usar para fixar preço final sem revalidar com dados de consumo real.
- Premium (até 2.000 fornecedores × até 5 organizações = até 10.000 fornecedores no agregado por R$149,90): a mesma proporção de custo variável escalaria para uma faixa muito mais alta que o preço cobre — **risco real de sustentabilidade não resolvido nesta estimativa**, sinalizado explicitamente para revisão antes de comprometer esse número publicamente.

## 4. Comparação direta com a concorrência

**Achado do Codex, Rodada 1**: os números de "fornecedores incluídos" da Remindax/Expiration Reminder na versão anterior desta seção não estavam registrados em D-346 (D-346 só registra preço, não volume de itens por tier) — eram alegações novas, não verificadas. Corrigido: números abaixo verificados de novo diretamente nas páginas oficiais nesta rodada, citados como tal (não como "já em D-346").

| | OmniVence Essencial | OmniVence Profissional | Remindax Basic (mais próximo em preço nominal) | Expiration Reminder Professional¹ |
|---|---:|---:|---:|---:|
| Preço/mês | R$59,90 (~US$11) | R$99,90 (~US$19) | US$29 (~R$154), 1 empresa | US$99 (~R$525), 1 empresa |
| Itens/fornecedores incluídos | 100 | 500 | 200 itens (não confirmado como "fornecedor" — unidade pode não ser equivalente, ver ressalva) | 600 registros (mesma ressalva) |
| Organizações incluídas | 1 | até 2 | 1 | 1 (workspace extra ~US$49/mês, ~R$260) |
| Guest upload sem conta | ✅ | ✅ | Não confirmado em D-346 | Não confirmado — "não identificado nas fontes" não é o mesmo que "comprovadamente ausente" |
| IA/OCR + verificação humana obrigatória | ✅ | ✅ | Não confirmado | Reivindica IA, sem verificação humana explícita |

¹ Corrigido nesta rodada: o Codex verificou que o plano US$99/600 registros da Expiration Reminder se chama "Professional" na página atual, não "Standard" como a versão anterior desta tabela dizia.

**Ressalva de unidade (achado real do Codex)**: "fornecedor rastreado" (nosso `TrackedSubject`, uma entidade que pode exigir vários documentos/requisitos) não é necessariamente equivalente a "item"/"registro" desses concorrentes (pode ser 1 documento = 1 item). Comparar capacidade nominal (100 vs. 200-600) sem esse cuidado é enganoso — mantido aqui só como referência de ordem de grandeza, não como prova de capacidade superior. **Também não há cenário de uso equivalente validado (mesmo achado, Rodada 2)** — "mais próximo em preço" descreve só a proximidade nominal de preço, não uma equivalência de capacidade real comprovada.

**Vantagem de preço**: Essencial custa R$59,90 contra o Remindax Basic (mais próximo em preço nominal) a ~R$154/mês — ~2,6x mais barato. Profissional (R$99,90) contra o Expiration Reminder Professional (~R$525) — ~5,3x mais barato. **Números específicos, não uma faixa genérica "3-6x"** — cada par declara sua própria razão. **Vantagem de funcionalidade**: guest upload sem conta + IA/OCR com verificação humana obrigatória no mesmo produto não foi confirmado em nenhum concorrente direto — tratado como diferencial provável, não comprovado, seguindo a mesma disciplina de linguagem de D-346.

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

## 7. Revisão Claude↔Codex — Rodada 2 (2026-09-27)

**Nota do Codex: proposta 6,25/10, régua 7,5/10 — pesos aceitos, régua ainda não estável.** Achados reais corrigidos nas seções acima:

1. **Erro de modelo de domínio**: `TrackedSubject` (fornecedor) e `ExpirationItem` (vencimento pessoal) são entidades distintas — a Rodada 2 confundia as duas com um sub-limite artificial de "3 fornecedores". Corrigido (seção 3.1): Free ganha o módulo Fornecedores completo dentro do teto já existente de 25 `TrackedSubject`, sem inventar um sub-limite novo.
2. Comportamento ao atingir o teto de fornecedores não estava definido — corrigido (bloqueio + CTA de upgrade, fornecedores ativos preservados, arquivar libera vaga).
3. Critério 1 do checklist (sustentabilidade econômica) premiava só reconhecer a lacuna, não endereçá-la — corrigido: a âncora "atende" agora exige estimativa de custo/margem, e uma estimativa de ordem de grandeza real foi adicionada (seção 3.5) usando preços públicos AWS (Textract/Bedrock/WhatsApp), com a ressalva explícita de que é ilustrativa, não uma análise de custo validada. **Risco real sinalizado, não escondido**: a matemática agregada do Premium (até 10.000 fornecedores no agregado de 5 organizações por R$149,90) não fecha com a mesma margem estimada do Essencial — registrado como pendência de revisão, não resolvido.
4. Remindax "Professional" não era o comparável mais justificado para o Essencial (Codex: Basic, US$29/200 itens, está mais perto em preço nominal) — corrigido, tabela agora usa Basic vs. Essencial.
5. Plano da Expiration Reminder renomeado de "Standard" para "Professional" (nome real atual, achado do Codex).
6. "Cada franquia declara comportamento de excedente" ainda não estava completo para storage/armazenamento — mantido como gap parcial, não fechado nesta rodada (ver seção 8).

**Status**: Rodada 2 completa, não convergida. Rodada 3 (correções acima) aguarda nova crítica do Codex (seção 8).

## 8. Revisão Claude↔Codex — Rodada 3 (pendente)

Aguardando resposta do Codex à proposta revisada (seções 3-4).

---

## 9. Limitações desta proposta

- Os números de fornecedores incluídos por tier pago (100/500/2.000) não têm precedente de mercado direto, diferente do eixo em si (validado 2x).
- Cota de IA/OCR mensal e política de excedente **ainda não definidas com precisão** — só uma estimativa de ordem de grandeza foi feita, não uma cota formal com regra de bloqueio/cobrança.
- Comportamento de excedente de armazenamento (storage) não definido explicitamente (só fornecedores e IA/OCR foram cobertos).
- O cálculo de custo de servir por tier (seção 3.5) é uma estimativa de ordem de grandeza com preços públicos AWS, não uma análise de consumo real validada — D-346 seção 5.2 já registrou o cálculo real como pré-requisito antes de fixar preço final; ainda pendente.
- Preço avulso de organização extra (Profissional/Premium) não definido.
- Comparação da seção 4 usa "itens/registros" dos concorrentes como proxy de "fornecedores" nosso — unidades podem não ser equivalentes, ressalva já registrada, mas não eliminada.
