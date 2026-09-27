# Planos e Preços — OmniVence (2026-09-27)

**Pedido por:** Marcelo, 2026-09-27, na sequência direta de D-345 (multi-org gated por plano) e D-346 (pesquisa de concorrência). Objetivo: definir planos, funcionalidades por plano e valores concretos, com vantagem de preço e de funcionalidades sobre a concorrência.

**Isto é uma PROPOSTA (Rodada 2 do protocolo Claude↔Codex, revisada após a crítica da Rodada 1 — seção 7) — não uma decisão. Marcelo decide.**

---

## 1. Grounding — o que já está decidido/pesquisado antes desta proposta

Não é uma decisão do zero. Três fontes internas já existentes restringem o desenho:

1. **`docs/architecture/roadmap-evolution/02-market-research.md`** (pesquisa de mercado anterior, arquitetura): o eixo de billing dominante do mercado inteiro é **fornecedor/item rastreado (`TrackedSubject`)**, nunca cobrança por assento avulso — "nenhum concorrente pesquisado cobra flat fee ou só por usuário" (isto não significa "nunca incluir números diferentes de usuário por tier", só "nunca vender assento avulso como unidade de cobrança" — ver a qualificação completa na seção 1 abaixo, achado do Codex, Rodada 3/4). Já parcialmente implementado: `src/modules/subject/domain/entitlement.ts` tem `activeTrackedSubjectsLimit` com default 25 (citando o precedente real da bcs, "25 vendors grátis, sem cartão").
2. **`docs/architecture/reviews/storage-quota-scoping/market-research-storage-limits-2026-09-09.md`** (pesquisa de mercado dedicada a storage): produtos estruturalmente parecidos com o OmniVence (compliance por fornecedor, não lembrete simples) tratam storage como **não-diferencial, frequentemente ilimitado** — o valor cobrado está no volume de fornecedores rastreados, nunca em bytes. O default técnico já implementado (`DEFAULT_STORAGE_QUOTA_BYTES`, `src/modules/document-archive/domain/storage-quota.ts`) é 8GB, flat, sem variação por plano.
3. **D-345/D-346** (`decisions-log.md`, `docs/project/pesquisa-concorrencia-2026-09-27.md`): multi-organização por dono, gated por plano (decidido, não implementado); pricing atual já ~2,5-10x mais barato que qualquer concorrente comparável em BRL; Remindax é o precedente mais próximo de "número de organizações como alavanca de tier" (1/2/2/3 empresas por tier pago) e de "compra avulsa de organização extra sem subir de tier inteiro" — mecânica de pagador/downgrade/transferência ainda não resolvida tecnicamente (D-346 seção 5.3), registrada aqui de novo como pendência, não fingida como resolvida.

**Consequência de desenho**: os planos abaixo diferenciam por **fornecedores ativos incluídos + organizações incluídas + funcionalidades**, e também incluem um número diferente de usuários por tier (achado do Codex, Rodada 3: "nunca por número de usuários" era impreciso — a tabela claramente diferencia 2/5/15/ilimitado; o que a pesquisa validou é especificamente **nunca cobrar por assento avulso**, não "nunca diferenciar por contagem de usuários" — as duas coisas são diferentes e a frase original as confundia). Storage não é tratado como eixo de venda (mantido generoso e relativamente uniforme entre tiers pagos).

## 2. O que está realmente implementado hoje (baseline, roadmap §18.2/§18.3)

**Correção da Rodada 1 (achado real do Codex)**: "Telegram" foi removido da lista abaixo — nunca foi implementado (só planejado no design original de `ARCHITECTURE.md`; o schema real de notificação só aceita `EMAIL`/`WHATSAPP`). Erro que também estava em D-346, corrigido lá também.

Todo plano pago inclui o núcleo já entregue: cadastro com vencimento + lembretes por e-mail (WhatsApp gated por E-019, jurídico, independente do plano), Requirement Templates, importação em massa, IA/OCR com verificação humana obrigatória, busca/filtros, dashboard de compliance, **relatórios agendados, dossiê PDF/Excel, export/audit trail** (roadmap §18.3 — todos já entregues, **corrigido: a versão anterior desta proposta os reservava ao Profissional, contradizendo a própria regra desta seção de que funcionalidade entregue não é diferencial de tier**), Document Types configuráveis, Guest Upload/Requests/Review/Recorrência, Storage/Versioning/Renewal (ressalva: versionamento completo por documento, item-level, segue suspenso — D-313 cobre "baixar documento", não histórico completo), ações em massa, compartilhamento externo seguro (`ExternalShareLink`). **Isto não é diferencial de tier — é o produto.** O que diferencia tiers é: limites (fornecedores/organizações/usuários) e as poucas funcionalidades ainda não construídas (roadmap §18.4/§18.5: e-signature, API/webhooks, calendário, score de compliance, portal completo, SSO).

## 3. Proposta de planos

| | **Free** | **Essencial** | **Profissional** | **Premium** |
|---|---:|---:|---:|---:|
| **Preço/mês** | R$0 | R$59,90 | R$99,90 | R$149,90 |
| **Organizações incluídas** (D-345) | 1 | 1 | até 2 | até 5 |
| **Fornecedores ativos incluídos por organização** (`TrackedSubject` — entidade do módulo B2B/Requisitos) | 25 | 100 | 500 | 2.000 |
| **Itens com vencimento sem fornecedor associado, por organização** (`ExpirationItem` — entidade distinta, sem cota técnica hoje) | Sem limite técnico (ver 3.1) | Sem limite técnico | Sem limite técnico | Sem limite técnico |
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
- **`ExpirationItem`** (item com vencimento — certidão, contrato, seguro, documento de veículo, etc., sem vínculo a um fornecedor) — entidade separada, **sem nenhuma cota técnica hoje** (não existe `activeItemsLimit` nem equivalente no código). **Correção de linguagem (achado do Codex, Rodada 3)**: chamar isso de "vencimento pessoal" é impreciso — o item pertence à organização (tenant), não a um usuário individual, e pode ter um responsável atribuído. "Pessoal" aqui descreve o caso de uso (item sem fornecedor associado), não uma propriedade técnica de posse individual.

**Correção**: Free ganha acesso **completo** ao módulo Fornecedores (não mais "limitado"), dentro do teto já existente de 25 `TrackedSubject` — resolve o risco de funil de conversão cego (D-346/Rodada 1) sem inventar um sub-limite novo e confuso. `ExpirationItem` (vencimentos pessoais) fica sem cota técnica em nenhum tier — mecanismo não existe hoje, e criar um está fora do escopo desta proposta de preço (registrado como pendência técnica, seção 3.6).

**Comportamento ao atingir o teto de fornecedores** (achado da Rodada 2, não respondido antes): criação/ativação de um fornecedor além do limite do tier é bloqueada com mensagem explícita + CTA de upgrade; os fornecedores já ativos continuam funcionando normalmente. Arquivar um fornecedor libera a vaga (mesma semântica que `TrackedSubjectStatus` já usa para "ACTIVE").

### 3.2 Fornecedores ativos incluídos — de onde vêm os números

- Free = 25: mantém o default já codificado (`DEFAULT_ACTIVE_TRACKED_SUBJECTS_LIMIT`), que já cita o precedente real da bcs.
- Essencial/Profissional/Premium (100/500/2.000): **números propostos nesta rodada, sem precedente de mercado direto** — a pesquisa de mercado validou o EIXO (cobrar por fornecedor), não os valores absolutos de cada faixa de preço nacional. Marcados aqui explicitamente como hipótese, não fato de mercado.

### 3.3 Armazenamento — por que quase uniforme entre tiers

Segue a recomendação explícita da pesquisa de 2026-09-09: produtos do nosso segmento (compliance por fornecedor, não lembrete simples) tratam storage como não-diferencial. Mantido em 8GB (mesmo do default técnico atual) nos 2 tiers de entrada, com um salto moderado em Profissional/Premium (20GB/50GB, por organização) só para acomodar o volume maior de fornecedores/documentos desses tiers — não para vender storage como feature.

### 3.4 Gating de multi-organização — reaproveita D-345/D-346, não reabre a mecânica pendente

Números (1/1/2/5) mantidos de D-346 seção 5.3. **A mecânica de pagador/downgrade/transferência de titularidade permanece um gap de design real, não resolvido aqui** — esta proposta só confirma os números de inclusão por tier, não a implementação. Compra de organização extra avulsa (precedente Remindax) fica como direção a explorar, preço avulso não definido nesta rodada.

### 3.5 Solução ao problema de custo do WhatsApp: digest na camada de entrega, não cota de mensagens

**Decisão de Marcelo (2026-09-27)**: não limitar quantidade de mensagens — a informação completa sempre chega ao cliente. A causa raiz do problema de margem (seções 3.5-antiga/Rodadas 4-5) não é "WhatsApp é caro", é **3 mensagens separadas por requisito** (lembretes 30/15/7 dias) multiplicadas por milhares de fornecedores.

**Isto já era uma questão em aberto documentada** (achado do Codex, Rodada 6: a citação original dizia que o gatilho de reavaliação já estava "satisfeito" — impreciso, corrigido): `docs/architecture/roadmap-evolution/07-domain-model-escalation-watchers-digest.md` (Fase 2b, cluster 5) cogitou digest e adiou deliberadamente, registrando um gatilho de reavaliação específico — "evidência real de volume observado em uso real, não especulação". Esta pesquisa de custo é uma análise pré-lançamento, não evidência de uso real em produção — **justifica reabrir a decisão para desenho agora**, não é literalmente o mesmo gatilho que o documento original previa. O mesmo documento já especifica a forma correta: **agregação na camada de entrega** (`DigestEntry` por intent elegível, agrupado por `tenantId+recipient+channel+window`) — atenção: **por destinatário, não só por organização** (achado do Codex, Rodada 6, corrigido abaixo) — nunca no domínio do evento original: `NotificationIntent` continua 1-por-evento (cada prazo é registrado e rastreado individualmente, nada é perdido); só o WhatsApp de SAÍDA é consolidado. Vencidos/escalonamento crítico fazem bypass do digest (mensagem imediata) — **e essas mensagens de bypass SOMAM ao custo do digest, não são gratuitas** (achado do Codex, corrigido na estimativa abaixo).

**Mecânica concreta proposta, corrigida na Rodada 6**: no máximo **1 mensagem WhatsApp por destinatário (não por organização) por dia**, consolidando todos os requisitos que cruzaram um limiar de lembrete (30/15/7 dias) naquele dia para aquele destinatário específico — "3 fornecedores com documento vencendo em 15 dias: X, Y, Z" numa mensagem só, em vez de 3 mensagens separadas. Item vencido ou escalonamento crítico continua imediato, fora do digest (nunca atrasa uma notificação urgente) — **mas esse imediato soma ao custo total, não é descontado do teto do digest**. **Nenhuma informação é omitida ou limitada** — o volume de eventos rastreados não muda, só a forma de entrega consolidada. Isto também é uma melhoria real de produto (menos spam para o cliente), não só uma correção de custo.

**Efeito no custo, honestamente mais limitado do que a versão anterior desta seção alegava**: o teto por destinatário passa a ser **dias do mês × destinatários por organização** (não mais fornecedores × 3) — reduz o custo significativamente quando há poucos destinatários por organização, mas **não elimina o risco se uma organização tiver muitos usuários recebendo notificação** (uma organização Premium com, por exemplo, 10 destinatários ativos multiplica o teto por 10). Isto é uma lacuna real que a estimativa da seção 3.6 ainda não modela com precisão — tratado como sensibilidade explícita abaixo, não escondido.

### 3.6 Cota de IA/OCR, política de excedente e estimativa de custo — recalculada com o digest da seção 3.5

**Ainda não resolvido**: cota mensal formal de chamadas de IA/OCR por tier e regra de excedente, e — achado real da Rodada 6 — o número de documentos/requisitos por fornecedor e de destinatários por organização, ambos variáveis reais do produto que mudam a conclusão de margem (ver "Limites reais do modelo" ao final desta seção). Precisa de uma rodada dedicada com dados reais de consumo/uso, não só de custo unitário. A estimativa abaixo serve só para checar plausibilidade da faixa de preço sob as premissas declaradas, não substitui essa rodada.

**Premissas explícitas, recalculadas com cuidado na Rodada 4 (achado real do Codex, Rodada 4: a versão anterior tinha erro aritmético — o cenário típico do Essencial deveria dar ~R$0,27+R$2,00, não R$0,70+R$12-18; refeito passo a passo abaixo, verificável)**:
- Verificações/mês = (fornecedores incluídos × % ativos) ÷ 6 — cenário típico assume 40% ativos, renovação a cada 6 meses. Cenário de uso elevado assume 100% ativos renovando no mesmo mês (pico de fim de período).
- Custo por verificação = Textract (2 páginas × US$1,50/1.000 = US$0,003) + Bedrock fallback esperado (30% × US$0,015 = US$0,0045) = **US$0,0075/verificação**.
- WhatsApp: **com digest (seção 3.5)**, no máximo 1 mensagem/organização/dia, R$0,10/mensagem entregue. Dias ativos/mês (dias com pelo menos 1 requisito cruzando um limiar) estimados por faixa de fornecedores: Free/Essencial (25-100 fornecedores) ~15-20 dias/mês no elevado, menos no típico; Profissional/Premium (500-2.000 fornecedores) praticamente todo dia tem algo a reportar dado o volume — usado o teto de 30 dias/mês como estimativa conservadora (pior caso realista, não o pior caso absoluto).
- Câmbio de referência: US$1 = R$5,30 (mesma taxa ilustrativa de D-346, seção 6). Storage: US$0,023/GB/mês.
- E-mail (SES) tem custo desprezível (~US$0,10/1.000) e não entra no total.
- **Storage na tabela abaixo permanece uma lacuna real, não resolvida (achado do Codex, Rodada 5)**: os valores de storage usados nas linhas de "uso elevado" abaixo assumem a cota CHEIA do tier (pior caso, não uma ocupação realista) — nenhuma premissa de ocupação típica real foi declarada. Isto significa que o storage nas linhas "típico" está subestimado (tratado como ~R$0) sem justificativa, e o impacto real pode ser maior do que a tabela sugere. Não corrigido nesta rodada — registrado explicitamente como pendência, não escondido atrás de uma premissa nova não verificada.
- **Decisão de desenho nova, fechando um gap real**: Free (R$0 de receita) usa **só e-mail**, nunca WhatsApp — evita expor custo variável de mensagem numa assinatura sem receita nenhuma. Não estava explícito antes.
- **Correção da Rodada 10 (achado real, apontado pelo próprio Marcelo)**: as Rodadas 6-9 usaram uma "margem-alvo de ≥60%" como se fosse um requisito de Marcelo — não era. Marcelo nunca pediu uma margem específica, só que a margem **nunca fique negativa** (evitar prejuízo), com visibilidade/monitoramento antes de chegar lá (seção 3.8). Reservar 60% do preço como orçamento (só 40% disponível para custo) foi uma escolha arbitrária deste relatório, não uma instrução real — e tornou o problema bem mais difícil do que ele é de verdade. **A restrição real, usada a partir daqui, é margem ≥0% (evitar prejuízo), não ≥60%.**

| Tier | Cenário | Fornecedores | Verif./mês | IA/OCR | WhatsApp (com digest) | Storage | Total | Preço | Margem |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Free | Típico (40% ativos) | 25 | 1,7 | R$0,07 | R$0 (sem WhatsApp) | ~R$0 | R$0,07 | R$0 | Custo puro (loss-leader por desenho) |
| Free | Elevado (100% ativos) | 25 | 25 | R$1,00 | R$0 | ~R$0 | R$1,00 | R$0 | Custo puro (loss-leader por desenho) |
| Essencial | Típico (40% ativos, ~15 dias ativos/mês) | 100 | 6,7 | R$0,27 | R$1,50 | ~R$0 | R$1,77 | R$59,90 | **~97%** |
| Essencial | Elevado (100% ativos, ~20 dias ativos/mês, cota cheia 8GB) | 100 | 100 | R$3,98 | R$2,00 | ~R$0,98 | R$6,96 | R$59,90 | **~88%** |
| Profissional | Típico, 1 org (~25 dias ativos/mês) | 500 | 33,3 | R$1,32 | R$2,50 | ~R$0 | R$3,82 | R$99,90 | **~96%** |
| Profissional | Elevado, 1 org (~30 dias ativos/mês, cota cheia 20GB) | 500 | 500 | R$19,88 | R$3,00 | ~R$2,44 | R$25,32 | R$99,90 | **~75%** |
| Profissional | Típico, agregado 2 orgs | 1.000 | 66,7 | R$2,65 | R$5,00 | ~R$0 | R$7,65 | R$99,90 | **~92%** |
| Profissional | Elevado, agregado 2 orgs (cota cheia, 40GB) | 1.000 | 1.000 | R$39,75 | R$6,00 | ~R$4,88 | R$50,63 | R$99,90 | **~49%** |
| Premium | Típico, 1 org (~30 dias ativos/mês, teto já atingido dado o volume) | 2.000 | 133,3 | R$5,30 | R$3,00 | ~R$0,32 | R$8,62 | R$149,90 | **~94%** |
| Premium | Elevado, 1 org (30 dias/mês, teto do digest) | 2.000 | 2.000 | R$79,50 | R$3,00 | ~R$6,10 (50GB) | R$88,60 | R$149,90 | **~41%** |
| Premium | Típico, agregado 5 orgs | 4.000 | 666,7 | R$26,50 | R$15,00 | ~R$1,60 | R$43,10 | R$149,90 | **~71%** |
| Premium | Elevado, agregado 5 orgs (cenário sintético extremo — ver achado abaixo) | 10.000 | 10.000 | R$397,50 | R$15,00 | ~R$30,48 (250GB) | R$442,98 | R$149,90 | **Negativa (~-196%)** |

**Nota importante sobre esta tabela (correção da Rodada 12, achado real do Codex)**: a coluna "Margem" acima é calculada assumindo consumo **sem nenhuma proteção** (todas as verificações do cenário processadas, sem cota nem orçamento em tempo real) — por isso a linha "Elevado, agregado 5 orgs" mostra -196%, um número que **não vai acontecer na prática** porque o mecanismo de orçamento em tempo real (seções 3.7-3.8) para de processar automaticamente antes de o custo chegar lá. **Esta tabela serve só para mostrar a ordem de grandeza da exposição bruta de custo** — a seção 3.8 tem o cálculo correto de margem esperada COM o mecanismo de proteção real aplicado, e é essa, não esta, a referência para decisão de preço final. Achado real, atualizado na Rodada 6: com o digest da seção 3.5 aplicado (assumindo 1 destinatário por organização), o pior caso real de então (Premium típico agregado de 5 organizações) melhorou de -52% para ~71% nesta tabela sem proteção — a seção 3.8 refina esse número ainda mais, considerando a proteção em tempo real.

**Limites reais do modelo, honestamente ainda não fechados (achado do Codex, Rodada 6 — a versão anterior desta seção tratava o problema como praticamente resolvido, o que era prematuro)**:
1. **Múltiplos destinatários por organização multiplicam o teto**: o desenho do digest (seção 3.5) agrega por destinatário, não por organização — a tabela acima assume 1 destinatário recebendo lembretes por organização. Uma organização Premium com, por exemplo, 10 destinatários ativos (`ASSIGNEE`/`WATCHER`/`MANAGER`) multiplicaria o custo de WhatsApp por 10 (R$15→R$150/mês no agregado de 5 orgs) — não modelado com precisão aqui, depende de quantos destinatários por organização o produto realmente tem em uso real.
2. **Mensagens de bypass (vencido/escalonamento crítico) somam ao custo**, não são absorvidas pelo teto do digest — não quantificadas nesta estimativa.
3. **O modelo assume 1 documento/verificação por fornecedor por ciclo** — se um fornecedor tem, na prática, vários requisitos/documentos diferentes (certidão + apólice + contrato, por exemplo), o volume real de IA/OCR é maior. Com 5 documentos/fornecedor em vez de 1 (achado do Codex, Rodada 6), o Premium agregado de 5 orgs no cenário TÍPICO já se aproxima do breakeven em IA/OCR sozinho (~R$149 de 10.000 verificações/mês, quase toda a receita de R$149,90) — **isto significa que o resíduo negativo NÃO está isolado ao cenário sintético extremo de 100% renovando junto, como a versão anterior desta seção alegava**. O número real de documentos/requisitos por fornecedor não foi levantado nesta pesquisa e é uma variável real do produto (não uma constante de mercado) — precisa ser medido ou decidido antes de tratar qualquer margem como garantida.

**Conclusão honesta desta rodada**: o digest é uma correção real e válida da causa estrutural identificada (3 mensagens × fornecedores) e deve ser implementado de qualquer forma — reduz custo e melhora a experiência do cliente. Mas **não é, sozinho, prova suficiente de que Profissional/Premium têm margem garantida** — falta saber (a) quantos destinatários por organização o produto real vai ter, e (b) quantos documentos/requisitos por fornecedor são típicos. Sem esses dois números, tratar os preços atuais como economicamente validados seria repetir o mesmo excesso de confiança que rodadas anteriores já cometeram duas vezes (erros aritméticos declarados como resolvidos antes da hora).

### 3.7 Orçamento de custo real (não cota pré-calculada por média) — desenho reconstruído na Rodada 9

**Achado grave do Codex, Rodada 8, que invalida a "garantia matemática" da Rodada 8**: R$0,03975 é o custo médio ESPERADO por verificação (Bedrock em 30% dos casos) — não o máximo. Se a proporção real de casos que precisam de Bedrock for maior (ex. 100% num mês ruim), o custo real por verificação sobe para R$0,0954, e a mesma cota de 364 verificações custaria R$80,23, não R$14,46 — margem real ~46%, não 60%. **Uma cota fixa baseada em média nunca é uma garantia, só uma estimativa com risco não quantificado.** Também confirmado: o teto de WhatsApp "R$3/organização" não é hard de verdade — o digest agrega por destinatário (Premium tem usuários ilimitados, múltiplos destinatários multiplicam o custo) e mensagens de bypass somam por cima, sem teto.

**Correção de fundo: trocar cota pré-calculada por orçamento de custo REAL, debitado em tempo real** — o mesmo padrão que `TenantQuotaService`/`quota.consume()` já implementa hoje em `start-ocr.ts`/`run-bedrock-extraction.ts` (reserva de cota por operação, não estimativa mensal). Mecânica:

1. **Orçamento mensal por assinatura** = Preço (100% — corrigido na seção 3.8, a restrição real é margem ≥0%, nunca foi ≥60%) — sem depender do número de organizações na fórmula: o gasto real de cada canal já escala naturalmente com o uso real, não precisa ser pré-multiplicado por N.
2. **WhatsApp nunca é bloqueado** (diretriz de Marcelo) — cada mensagem de digest ou bypass é enviada normalmente e debita seu custo REAL (R$0,10) do orçamento da assinatura, mesmo que o saldo fique negativo.
3. **Textract roda sempre no caso comum** (custo fixo baixo, R$0,0159/documento, aceito como parte do custo base do produto) — **correção da Rodada 12: isso NÃO é absoluto**, a válvula secundária do passo 5 abaixo PODE adiá-lo em casos extremos de saldo esgotado. "Nunca gated" descrevia só o caso comum, não uma regra sem exceção — a válvula do passo 5 tem precedência sobre esta frase quando o saldo aperta.
**Saldo único da assinatura (achado do Codex, Rodadas 9-11: as duas válvulas abaixo precisam ler exatamente a mesma conta, não versões parciais diferentes — corrigido nesta rodada)**:

```
Saldo(momento T) = Preço − gasto REAL acumulado desde o início do ciclo, em TODOS os componentes:
                    WhatsApp (digest+bypass) + Storage + Textract + Bedrock
```

4. **Bedrock é a válvula de segurança primária**: no momento em que `needsBedrock()` retorna verdadeiro, o sistema checa o Saldo (acima, sempre a mesma fórmula completa) contra o custo REAL de uma chamada (R$0,0795, não a média). Se insuficiente, a chamada é pulada — o campo cai em `PENDING_CONFIRMATION` (candidato do parser determinístico, se houver, continua sendo sugerido; só a etapa de LLM é que não roda).
5. **Válvula de segurança secundária (rara, só em extremos)**: antes de iniciar o Textract de um novo documento, o sistema checa o mesmo Saldo contra o custo REAL do Textract (R$0,0159). Se insuficiente, a extração automática (Textract e, por consequência, Bedrock) é adiada para o próximo ciclo — nunca um bloqueio de upload, só um adiamento da automação.

**Correção real sobre quando o saldo pode ficar negativo (achado do Codex, Rodada 11)**: a afirmação anterior de que "só fica negativo se WhatsApp+storage, SOZINHOS, excederem o preço" estava errada — porque WhatsApp nunca é bloqueado, ele continua debitando o Saldo mesmo depois de Bedrock e Textract já terem sido pausados por falta de orçamento. Exemplo real: se IA/OCR já consumiu R$100 do orçamento no início do mês (dentro do previsto) e depois chega um pico de WhatsApp de R$60 no fim do mês, o total (R$160) passa o preço do Premium (R$149,90) mesmo sem WhatsApp+storage terem excedido nada sozinhos. **A condição real e honesta é**: o saldo fica negativo sempre que o gasto acumulado total do mês (WhatsApp, nunca interrompido, mais o que IA/OCR e storage já gastaram antes de suas próprias válvulas atuarem) ultrapassa o preço — o mecanismo minimiza isso ao máximo (IA/OCR para de gastar assim que o saldo aperta), mas não pode retroagir sobre gasto de WhatsApp já ocorrido nem sobre mensagens de WhatsApp que ainda vão chegar depois do saldo zerar. **Isto não é mais alegado como garantia — é risco residual real, presente enquanto WhatsApp for irrestrito, do tamanho que a seção 3.8 tenta quantificar (sem dados reais de distribuição de uso, só ordem de grandeza).**

**Mitigação de UX real, resposta ao achado do Codex de que perder OCR/IA é degradação perceptível, não invisível**: quando o orçamento estiver apertado, priorizar automação pelos requisitos com vencimento mais próximo primeiro — o cliente sente o mínimo de fricção manual exatamente onde o produto mais precisa acertar (prazo perto de vencer), e mais fricção manual só em itens com folga de tempo maior.

**Implicação para os números do Premium, sem alegar mais do que o modelo sustenta**: os 2.000 fornecedores/5 organizações continuam como oferta (D-346: combinação sem equivalente direto entre os concorrentes pesquisados) — mas, ao contrário da Rodada 8, **não alegamos que a experiência de automação fica "intacta"**: em uso agressivo, uma fração real dos documentos vai exigir preenchimento manual (o orçamento de custo real vai sinalizar isso objetivamente, mês a mês, em vez de uma cota fixa arbitrária). Isso é comunicado como tradeoff consciente — capacidade rastreada nunca cai, mas a promessa de "toda leitura é automática" não se sustenta em uso extremo, e não deveria ser prometida dessa forma no marketing.

**Exceção explícita do Free (achado real do Codex, R8/R9)**: com orçamento = Preço, o Free (R$0) teria orçamento zero por definição, o que zeraria toda automação mesmo no uso mínimo (25 fornecedores) — não é a intenção. Free usa uma cota fixa e pequena, subsidiada conscientemente (ex. mesma ordem de grandeza da seção 3.6, ~R$1/mês de custo aceito como investimento de aquisição), não a fórmula de orçamento por preço.

**Pendência de implementação explícita**: a reserva precisa ser atômica (evitar corrida entre operações concorrentes), e falta decidir se o "orçamento" reseta mensalmente de forma dura ou acumula saldo residual — decisão de produto, não fechada aqui.

### 3.8 Correção da Rodada 10: a meta de 60% nunca foi pedida por Marcelo — recálculo com a restrição real

**Achado do próprio Marcelo, não do Codex**: as fórmulas das Rodadas 6-9 usaram `Preço × 0,40` como orçamento disponível — ou seja, reservavam 60% do preço como "margem-alvo" antes de gastar qualquer coisa. **Marcelo nunca pediu isso.** O pedido real, desde o início desta frente, foi só: **nunca ficar com margem negativa (evitar prejuízo)**, com visibilidade regular para agir antes de chegar lá (a mesma lógica dos limiares de breakeven já definidos antes nesta conversa). Reservar 60% de colchão foi uma escolha arbitrária deste relatório, nunca comunicada como tal até agora — e tornou o problema bem mais severo do que ele é de verdade, ao ponto de gerar o "achado estrutural" da Rodada 9 (WhatsApp sozinho consumindo o orçamento inteiro), que só acontecia porque o orçamento disponível tinha sido artificialmente reduzido a 40% do preço.

**Fórmula corrigida** — restrição real é margem ≥0%, não ≥60%:

```
Orçamento(mês) = Preço (100%, não 40%) − gasto real de WhatsApp do mês − gasto real de storage do mês
```

A cota de verificações automáticas (seção 3.7) consome o que sobrar desse orçamento, exatamente como já desenhado — só a base de cálculo muda, de 40% do preço para 100% do preço.

**Correção da Rodada 10 sobre o próprio cenário "extremo" (achado real do Codex — a versão anterior desta seção confundiu dois cenários diferentes)**: "5 documentos/fornecedor" com a taxa de renovação típica (÷6) é o cenário TÍPICO-com-mais-documentos, não o extremo. O extremo real é 100% dos fornecedores ativos renovando 5 documentos cada NO MESMO MÊS — para o Premium agregado de 5 organizações (10.000 fornecedores), isso são **50.000 verificações/mês**, não 3.333.

**Recálculo do Premium (5 organizações, o caso mais apertado) com a restrição real** — **ressalva de ordem, achado do Codex, Rodada 12**: esta tabela assume WhatsApp+storage do mês inteiro conhecidos primeiro, com a cota de IA/OCR consumindo o que sobra — é uma simulação de cenário completo, não uma garantia de que o mecanismo em produção respeitará essa mesma ordem. Na prática, o Saldo (seção 3.7) é debitado na ordem real de chegada dos eventos: se muitas verificações de IA/OCR acontecerem cedo no mês (antes de qualquer gasto de WhatsApp), elas podem consumir o Saldo primeiro, e um pico de WhatsApp mais tarde no mesmo mês pode então levar o total além do preço mesmo com a cobertura de IA/OCR "dentro do esperado" por esta tabela — exatamente o mecanismo descrito na correção da seção 3.7 acima. Esta tabela mostra a ordem de grandeza esperada em uso normal, não uma garantia de sequência:

| Cenário | WhatsApp | Storage | Cota de IA/OCR disponível | Cobertura | Resultado |
|---|---:|---:|---:|---:|---:|
| Típico (1 doc/fornecedor), 1 destinatário/org | R$15,00 | R$30,50 | 2.626 verif. (orçamento R$104,40) | 666,7 necessárias — **100% cobertas** | **Margem ~52%** |
| Típico (1 doc/fornecedor), 5 destinatários/org | R$75,00 | R$30,50 | 1.117 verif. (orçamento R$44,40) | 666,7 necessárias — **100% cobertas** | **Margem ~12%, positiva** |
| Típico com 5 docs/fornecedor, 1 destinatário/org | R$15,00 | R$30,50 | 2.626 verif. | 3.333 necessárias — **~79% cobertas** | Margem ~0% (mecanismo para antes de negativar) |
| Típico com 5 docs/fornecedor, 5 destinatários/org | R$75,00 | R$30,50 | 1.117 verif. | 3.333 necessárias — **~34% cobertas** | Margem ~0% (mecanismo para antes de negativar) |
| **Extremo real** (100% ativos × 5 docs, tudo no mesmo mês), 1 destinatário/org | R$15,00 | R$30,50 | 2.626 verif. | 50.000 necessárias — **~5% cobertas** | Margem ~0% (mecanismo para bem antes, quase tudo manual naquele mês) |
| **Extremo real**, 5 destinatários/org | R$75,00 | R$30,50 | 1.117 verif. | 50.000 necessárias — **~2% cobertas** | Margem ~0% (idem, cobertura automática mínima) |

**Conclusão corrigida, sem alegar "garantia" (achado do Codex: aumentar o orçamento de 40%→100% do preço reduz drasticamente o risco, mas não torna um custo sem teto genuinamente limitado)**: **só o cenário típico com 1 documento/fornecedor tem folga real de margem (~12-52%)** — o típico com 5 documentos/fornecedor já opera perto de 0% (achado do Codex, Rodada 11, corrigindo a versão anterior desta frase que alegava folga "com ou sem múltiplos documentos", contradizendo a própria tabela acima). No cenário extremo sintético, a cota de IA/OCR em tempo real reduz drasticamente o gasto de IA/OCR — mas isso significa que, nesse mês, a esmagadora maioria dos documentos (95-98%) cairia em preenchimento manual, um custo de experiência real, não hipotético. **O "achado estrutural" da Rodada 9 não desaparece por completo, e a condição exata para ele acontecer é mais ampla do que "WhatsApp+storage sozinhos excedendo o preço"** — como a seção 3.7 corrige acima, WhatsApp que chega DEPOIS de IA/OCR já ter gastado boa parte do orçamento também pode empurrar o total para negativo, mesmo que WhatsApp+storage isolados não excedessem nada. A referência de "~8+ destinatários/organização" citada em rodadas anteriores é só uma ordem de grandeza ilustrativa (não conta bypass nem timing de gasto), não um limiar medido ou garantido — não há dados reais de distribuição de uso ainda para calibrar isso com precisão; a resposta correta é monitorar o gasto real depois do lançamento, não prometer um número exato agora.

**Posição final honesta, corrigida na Rodada 12 (achado do Codex: o monitoramento não pode olhar só para WhatsApp isolado, tem que olhar para o gasto TOTAL acumulado)**: o mecanismo (digest + orçamento de custo real) reduz o risco de prejuízo a um resíduo estreito, mas **não é uma garantia absoluta enquanto o WhatsApp permanecer irrestrito por definição** — isso é matematicamente inevitável, não uma falha de desenho a corrigir. A resposta correta não é prometer "nunca negativo" sem ressalva, é: monitorar o **Saldo da assinatura** (seção 3.7 — gasto acumulado total de WhatsApp+storage+IA/OCR contra o preço, não só WhatsApp isolado) em tempo real ou por relatório periódico, com um alerta antes do saldo chegar perto de zero (mesma lógica dos limiares de breakeven já definidos nesta conversa, agora aplicados ao Saldo completo, não a um componente isolado), e ter uma política pronta (aceitar o risco residual, ou introduzir cobrança de excedente de WhatsApp especificamente) para quando isso acontecer.

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
| 1 | **Sustentabilidade econômica** — a proposta traz uma estimativa reproduzível de custo/margem por tier (premissas explícitas de páginas/documento, modelo/tokens, frequência de fallback, cenário típico E cenário de uso elevado), não só reconhece que falta uma | 25% | Estimativa com premissas nomeadas, cenário típico + elevado, margem-alvo e tratamento explícito de exposição deficitária por tier | Só reconhecer a lacuna sem estimativa, ou estimativa sem premissas reproduzíveis |
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

## 8. Revisão Claude↔Codex — Rodada 3 (2026-09-27)

**Nota do Codex: proposta 7,0/10, régua 7,5/10 — régua ainda não estável.** Achado embaraçoso: a seção 7 (revisão da R2) afirmava que o critério 1 do checklist tinha sido corrigido para exigir estimativa de custo/margem, mas a tabela da seção 5 continuava com a âncora antiga e mais fraca — contradição real entre o que o relatório dizia ter feito e o que de fato tinha feito. Corrigido nesta rodada (seção 5, critério 1, agora exige premissas reproduzíveis/cenário típico+elevado/margem-alvo).

**Outros achados reais corrigidos**:
1. Modelo WhatsApp Business estava errado (cobrança por "conversa iniciada"); corrigido para "por mensagem entregue", modelo real de mercado.
2. Estimativa de custo (seção 3.5) reconstruída com premissas explícitas e reproduzíveis, cobrindo os 4 tiers em cenário típico E de uso elevado — não só o Premium.
3. **Achado real novo, exposto pela estimativa reconstruída**: o risco de margem negativa em uso elevado não é exclusivo do Premium — já aparece no Profissional com 1 única organização no pico. Causa raiz é volume de mensagens WhatsApp por fornecedor incluído, não o número de organizações. Registrado como pendência real de produto (política de limite/cobrança de WhatsApp separada da contagem de fornecedores).
4. "Nunca por número de usuários" (seção 1) estava impreciso — a tabela de planos diferencia por usuários incluídos; o validado é especificamente "nunca cobrar por assento avulso". Corrigido.
5. "Vencimento pessoal" (`ExpirationItem`) corrigido — a entidade pertence à organização, não a um usuário individual; "pessoal" descreve o caso de uso (sem fornecedor associado), não posse técnica.

**Status**: Rodada 3 completa, não convergida. Rodada 4 (correções acima) aguarda nova crítica do Codex (seção 9).

## 9. Revisão Claude↔Codex — Rodada 4 (2026-09-27)

**Nota do Codex: design 7,0/10, régua 8,5/10 (âncora do critério 1 confirmada genuinamente mais forte, mas ainda ambígua sobre se "reconhecer o déficit" basta).** Achado grave: **erro aritmético real na estimativa** — o cenário típico do Essencial deveria dar ~R$0,27 (IA/OCR) + R$2,00 (WhatsApp) pelas próprias premissas declaradas, não R$0,70/R$12-18 como a Rodada 3 apresentava. Também: cobertura incompleta (Free ausente, faltavam cenários típicos de Profissional/Premium e o agregado de 5 organizações do Premium), custo de storage descartado sem checar o número (250GB agregado ≈ R$30/mês, relevante), e nova repetição do padrão "seção de revisão descreve mais do que o corpo do documento entrega".

**Corrigido nesta rodada (seção 3.5, reconstruída por completo)**:
1. Matemática refeita passo a passo, verificável — o cenário típico de 1 organização isolada é mais saudável do que a versão com erro sugeria (70-96% de margem nos 3 tiers pagos, não 43-78%). **Correção da Rodada 5**: essa margem saudável não se sustenta no agregado típico de multi-org do Premium (ver achado abaixo) — a alegação original desta linha ("89-96%") estava incompleta/imprecisa, o Codex corrigiu para 70-96% e encontrou o caso agregado que quebra isso.
2. Cobertura completa: Free (com decisão nova de desenho — só e-mail, nunca WhatsApp, evita custo variável numa assinatura sem receita) + cenário típico E elevado para os 4 tiers + agregado multi-org para Profissional (2 orgs) e Premium (5 orgs) + storage incluído no total.
3. Margem-alvo proposta explicitamente (≥60% típico, tolerável até breakeven em uso elevado de 1 organização) — antes ausente.
4. **Achado real confirmado com os números corretos**: o problema de margem negativa em uso elevado é real e isolado — Profissional já fica negativo com 1 organização no pico (~-70%), Premium também (~-357% com 1 org, catastrófico no agregado de 5). Causa raiz: volume de mensagens WhatsApp por fornecedor incluído. Pendência de produto não resolvida aqui: cota de WhatsApp por tier ou mecanismo de digest antes de tratar os números de fornecedores como finais.
5. "Nunca usuário/assento" (seção 1, citação da pesquisa externa) recebeu a mesma qualificação já aplicada à "Consequência de desenho" — evita a leitura de que a tabela de planos (que diferencia por usuários incluídos) contradiz a pesquisa.

**Status**: Rodada 4 completa, não convergida. Rodada 5 (seção 3.5 reconstruída) aguarda nova crítica do Codex (seção 10).

## 10. Revisão Claude↔Codex — Rodada 5 (2026-09-27)

**Nota do Codex: design 7,0/10, régua 8,5/10 — ainda não convergido.** O Codex refez a matemática das 10 linhas à mão e confirmou que bate com as premissas declaradas (divergências de centavos por arredondamento intermediário, não erro real). **Achado mais importante desta rodada**: os agregados TÍPICOS (não só elevados) de multi-org estavam faltando na tabela — ao adicioná-los, o Premium fica negativo (~-52%) já no cenário típico com as 5 organizações incluídas, não só em uso elevado. Isto contradizia a própria conclusão anterior deste relatório ("problema isolado ao uso elevado") — corrigido.

**Achados residuais que permanecem em aberto, não resolvidos até esta rodada**:
- Storage: premissa de ocupação real não declarada (cenários "típico" tratam storage como ~R$0 sem justificar; "elevado" assume cota cheia, pior caso) — reconhecido explicitamente como pendência na seção 3.5, não uma solução fingida.
- Modelo assume 1 verificação por fornecedor por renovação — não tem sensibilidade para múltiplos documentos/requisitos por fornecedor.
- Custo unitário do Bedrock (US$0,015/chamada) continua sendo uma premissa sem modelo/contagem de tokens que a sustente.
- **Ambiguidade de fundo, não resolvida em nenhuma rodada**: mesmo com a matemática certa e a transparência sobre a pendência de WhatsApp, o Codex mantém que "diagnosticar o déficit" não é o mesmo que "resolver a sustentabilidade econômica" — o critério 1 do checklist continua sem nota alta enquanto a política de cota/cobrança de WhatsApp não for de fato decidida (não só descrita como pendente).

**Status**: 5 rodadas completas. Régua estável em 8,5/10 há 3 rodadas seguidas, nunca atingindo 9,0 — o Codex mantém a mesma ressalva (âncora do critério 1 ainda não distingue "reconhecer o gap" de "resolvê-lo"). Design oscila entre 6,25 e 7,0, sem convergência. **Achado de negócio real e acionável, robusto a todas as 5 rodadas de verificação**: os números atuais de fornecedores/organizações incluídos em Profissional e especialmente Premium não são sustentáveis com WhatsApp habilitado sem uma política de cota separada — isto precisa ser resolvido antes de qualquer lançamento comercial com WhatsApp ativo, independente do resultado formal do protocolo.

---

## 11. Revisão Claude↔Codex — Rodada 6 (2026-09-27)

**Nota do Codex: design 7,20/10, régua 8,5/10 — não convergido.** O digest foi reconhecido como uma melhoria real e concreta, mas a versão original desta rodada apresentava o problema como praticamente resolvido — o Codex mostrou que isso era prematuro. Achados reais, todos corrigidos nesta versão:

1. **Modelo original agregava por organização; o desenho já existente (`07-domain-model-...md`) agrega por destinatário** — uma organização com múltiplos destinatários (`ASSIGNEE`/`WATCHER`/`MANAGER`) multiplica o teto de custo, não modelado antes. Corrigido: seção 3.5 agora deixa isso explícito como limite real do modelo, não resolvido.
2. **Mensagens de bypass (vencido/crítico) somam ao custo**, não são absorvidas pelo teto do digest — corrigido, estava implicitamente tratado como "grátis" antes.
3. **Achado mais importante**: o modelo assumia 1 documento/verificação por fornecedor por ciclo. Com uma premissa mais realista de múltiplos requisitos por fornecedor (5, no exemplo do Codex), o Premium agregado de 5 orgs já se aproxima do breakeven em IA/OCR **no cenário TÍPICO**, não só no sintético extremo de "100% renovando junto" que a versão anterior desta seção citava como único resíduo. Corrigido — a alegação de que o problema estava isolado a um cenário sintético extremo foi retirada.
4. Citação do gatilho de reavaliação do digest ("evidência real... em uso real") estava sendo tratada como "já satisfeita" por esta pesquisa — impreciso, já que a pesquisa é análise pré-lançamento, não uso real observado. Corrigido: "justifica reabrir a decisão", não "satisfaz o gatilho literal".
5. Inconsistência na coluna "Fornecedores" da tabela (Profissional típico agregado mostrava 200, incompatível com as 66,7 verificações declaradas — devia ser 1.000) — corrigido.
6. Storage tratado como ~R$0 em linhas "elevado" de Essencial/Profissional apesar da premissa de cota cheia — corrigido, valores agora consistentes em toda a tabela.

**Conclusão honesta desta rodada**: o digest é uma correção real da causa estrutural original e deve ser implementado — mas **não é prova suficiente, sozinho, de que os preços/franquias atuais têm margem garantida**. Faltam 2 números reais do produto (destinatários por organização, documentos/requisitos por fornecedor) que esta pesquisa não tem como estimar sem dados reais de uso.

**Status**: 6 rodadas completas nesta decisão. Régua estável em 8,5/10 desde a Rodada 3 (4 rodadas seguidas sem chegar a 9,0). Design oscilou entre 6,25 e 7,20 nas últimas 4 rodadas, sem tendência clara de convergência — cada correção substancial revela uma nova variável real do produto que a pesquisa por si só não consegue fechar (destinatários/organização, documentos/fornecedor, ocupação real de storage). **Isto não é mais um problema de rigor da proposta — é a ausência de dados reais de uso que só existirão depois do produto estar em operação.** Continuar rodando o protocolo sobre suposições cada vez mais específicas tem retorno decrescente; a decisão real que falta é de Marcelo, não mais uma correção de texto.

---

## 12. Revisão Claude↔Codex — Rodada 7 (2026-09-27)

**Nota do Codex: design 6,78/10, régua 8,5/10 — não convergido.** Achado grave: **erro de unidade na fórmula** — R$0,03975 (custo médio esperado por verificação) foi usado como se fosse o custo de uma chamada Bedrock real (R$0,0795), permitindo gastar o dobro do orçamento disponível. Corrigido na seção 3.7 (fórmula separando Textract obrigatório de Bedrock condicional).

**Achado mais importante**: mesmo com a fórmula corrigida e zerando o Bedrock por completo, o custo obrigatório de Textract sozinho (que não pode ser degradado sem perder a extração automática) já excede o orçamento de 60% de margem do Premium no agregado de 5 organizações, sob a mesma hipótese de múltiplos documentos/fornecedor da Rodada 6. **Conclusão honesta, corrigida nesta rodada**: a cota de IA/OCR é real e vale implementar (reduz custo, não corta informação do cliente), mas **não é suficiente sozinha para garantir a margem do Premium no cenário agressivo de 5 organizações** — falta uma decisão de produto sobre os números incluídos no Premium (fornecedores/organizações), preço, ou uma segunda cota de excedente que cubra Textract/storage, não só Bedrock.

**Achado técnico adicional**: pular a chamada Bedrock sozinha não garante `PENDING_CONFIRMATION` automaticamente no código real — `needsBedrock()` também dispara por ambiguidade de múltiplos candidatos OCR, e o parser determinístico pode confirmar um candidato único automaticamente mesmo sem Bedrock. A implementação precisa preservar o motivo original e garantir revisão manual explícita, não só "pular a chamada" — registrado como requisito de implementação, não resolvido só com a proposta de preço.

**Status**: 7 rodadas completas nesta decisão. Régua estável em 8,5/10 desde a Rodada 3 (5 rodadas seguidas sem 9,0). Cada rodada de correção da cota de IA/OCR reforçou, em vez de dissolver, o achado original da Rodada 5-6: **o Premium, com os números atuais de fornecedores/organizações incluídos, não tem margem sustentável sob premissas realistas de uso, com ou sem engenharia de cota interna.** Isto deixou de ser uma questão de rigor de análise — é uma decisão de produto real e pendente: reduzir o que o Premium inclui, subir o preço, ou aceitar um mecanismo de cobrança por excedente mais amplo que só Bedrock.

---

## 13. Revisão Claude↔Codex — Rodada 8 (2026-09-27)

**Nota do Codex: design 6,725/10, régua 8,5/10 — não convergido.** Achado central, grave: **a "garantia matemática por construção" da versão anterior estava errada** — R$0,03975 é custo médio esperado (Bedrock em 30% dos casos), não o máximo; se a proporção real de Bedrock for maior num mês, o custo real por verificação sobe para R$0,0954, e a mesma cota custaria bem mais do que o orçamento (margem cairia para ~46%, não 60%). Confirmado também: o teto "R$3/organização" do WhatsApp não é hard de verdade (digest agrega por destinatário, não por organização — Premium tem usuários ilimitados; mensagens de bypass somam sem teto). O Codex confirmou por leitura direta do código que a cota de storage (D-249) É real e fail-closed — essa perna do argumento estava certa.

**Achado de produto real, não só técnico**: perder a leitura automática (Textract+IA) não é "parte interna que o cliente não vê como o que comprou" — é uma degradação de experiência perceptível (o cliente passa a transcrever dados manualmente). O Codex recalculou que, no cenário típico de 5 organizações, a cota da Rodada 8 cobriria só ~55% das verificações mensais reais (não 100% como a linguagem da rodada anterior sugeria) — com a hipótese de múltiplos documentos/fornecedor da Rodada 6, cairia para ~11%. **Isto significa que "preservar a capacidade competitiva intacta" era uma alegação forte demais** — a capacidade rastreada (2.000×5 fornecedores) não muda, mas a experiência de automação em uso pesado, sim.

**Pesquisa competitiva pontual feita pelo Codex nesta rodada** (respondendo ao pedido de Marcelo de aprofundar se necessário): verificou Remindax Premium (US$299/mês, 3.000 itens, 3 empresas, 10 usuários, com add-ons pagos) e VendorJot Scale (US$399/mês, 1.500 fornecedores, 20 usuários, 20 workspaces) diretamente nas páginas oficiais. **Conclusão do Codex**: esses exemplos apoiam a direção de separar capacidade rastreada de consumo operacional (o que a proposta já faz), mas não há necessidade de pesquisa de mercado mais ampla para decidir a direção — a recomendação de manter 2.000 fornecedores/5 organizações como oferta permanece válida, só sem a alegação de que a experiência fica "intacta".

**Correção de fundo proposta na Rodada 9 (seção 3.7 reescrita)**: trocar cota pré-calculada por média por **orçamento de custo real, debitado em tempo real por operação** — o mesmo padrão que `TenantQuotaService`/`quota.consume()` já implementa hoje no código real. Isto elimina estruturalmente o erro "média tratada como máximo", porque não há mais média nenhuma no caminho de decisão, só gasto real acumulado.

**Status**: 8 rodadas completas. Régua estável em 8,5/10 desde a Rodada 3 (6 rodadas seguidas sem 9,0). Rodada 9 (orçamento de custo real) aguarda nova crítica do Codex (seção 14).

## 14. Revisão Claude↔Codex — Rodada 9 (2026-09-27) — achado estrutural, não mais um erro de engenharia

**Nota do Codex: design 7,125/10, régua 8,5/10 — não convergido, mas pela primeira vez o motivo não é um erro corrigível.** Achado central desta rodada, direto e definitivo: **como o WhatsApp nunca pode ser bloqueado (diretriz explícita de Marcelo) e o custo real dele não tem teto genuíno (destinatários múltiplos, mensagens de bypass), nenhum desenho consegue GARANTIR a margem de 60% enquanto essa regra for absoluta.** Exemplo concreto do Codex: Premium tem orçamento de R$59,96 (40% de R$149,90); 600 mensagens de WhatsApp a R$0,10 já custam R$60,00 — **o orçamento inteiro consumido só pelo WhatsApp, antes de qualquer IA/OCR entrar na conta.** A cota de IA/OCR (seção 3.7) protege corretamente a fatia de custo que ELA controla — mas não pode proteger a fatia que Marcelo pediu para nunca ser controlada.

**Isto não é um bug a corrigir com mais uma rodada — é uma tensão real entre dois pedidos legítimos**: (1) nunca bloquear informação que chega ao cliente (WhatsApp), e (2) garantir que a margem nunca fica negativa. As duas coisas juntas, ao mesmo tempo, de forma absoluta, não são simultaneamente possíveis — uma tem que ceder, ainda que só um pouco. Achados menores, também reais, do Codex: os custos unitários de Textract/Bedrock usados no modelo (R$0,0159/documento, R$0,0795/chamada) são eles próprios estimativas com premissa de câmbio/páginas/tokens fixas, não valores medidos; o Free (preço R$0) precisa de uma exceção explícita já que `Preço×0,40=0` zeraria toda automação por definição; a válvula secundária (adiar Textract) e a primária (pular Bedrock) precisam consultar o MESMO saldo, não saldos parciais diferentes como a versão desta rodada tinha.

**Recomendação do Codex, que aceito**: trocar a linguagem de "garantia de margem" por **"meta de margem com exposição residual de WhatsApp explicitamente aceita e monitorada"** — não contraria a diretriz de Marcelo, só é honesto sobre o que é tecnicamente possível. Os 2.000 fornecedores/5 organizações do Premium não precisam ser reabertos por causa deste achado especificamente.

**Status**: 9 rodadas completas. Este é o primeiro achado da série que não se resolve com mais precisão técnica — precisa de uma decisão de Marcelo entre: (a) aceitar a exposição residual do WhatsApp como risco monitorado (usando os limiares de breakeven já calculados nesta conversa como gatilho de alerta/ação, não como garantia), ou (b) introduzir uma cobrança de excedente específica para WhatsApp acima de um teto generoso (mensagem continua sendo enviada sempre — nunca bloqueada — só o excedente é cobrado à parte, o que é diferente de "limitar quantidade").

---

## 15. Revisão Claude↔Codex — Rodada 10 (2026-09-27)

**Nota do Codex: design 7,80/10 (subiu de 7,125), régua 8,5/10 — não convergido, mas o "achado estrutural" da Rodada 9 foi genuinamente reduzido, não eliminado.** Aceitou a correção de Marcelo (60% nunca foi pedido) sem ressalva. Achado real, embaraçoso: a versão original desta seção confundiu "cenário típico com 5 documentos/fornecedor" (3.333 verificações/mês) com "cenário extremo" — o extremo real (100% ativos × 5 documentos, tudo no mesmo mês) é **50.000 verificações/mês**, com cobertura automática de só ~2-5%. Corrigido na tabela acima.

**Posição final do Codex, adotada**: aumentar o orçamento de 40%→100% do preço reduz drasticamente o risco (cenários típicos ficam com margem 12-52%, saudáveis), mas **não torna WhatsApp genuinamente limitado** — ele continua sem teto por definição (nunca bloqueado). Ainda é matematicamente possível, em teoria, que WhatsApp+storage sozinhos excedam o preço antes de qualquer IA/OCR — o limiar de "~8 destinatários/org" é só uma referência de ordem de grandeza, não um número exato (não conta bypass nem consumo de IA/OCR já feito no mês). **Conclusão adotada nesta versão**: parar de alegar "garantia" e apresentar como "risco reduzido a um resíduo estreito e monitorável, com uma política pendente para o caso raro" — exatamente a posição final registrada na seção 3.8.

**Achados menores adicionais, corrigidos**: as duas válvulas (Bedrock primária, Textract secundária) precisavam consultar o mesmo saldo único, não saldos parciais diferentes — corrigido na seção 3.7; exceção do Free (orçamento = Preço = R$0 zeraria toda automação) não estava explícita — corrigida.

**Status**: 10 rodadas completas. Régua estável em 8,5/10 desde a Rodada 3 (8 rodadas seguidas sem 9,0) — mas o design subiu de forma consistente nas últimas 2 rodadas (6,725→7,125→7,80) depois da correção do Marcelo, mostrando convergência real em andamento, não estagnação. O mecanismo (digest + orçamento de custo real) está tecnicamente sólido e pronto para implementação — o que resta não é mais precisão técnica, é uma frase final honesta sobre o que ele garante (proteção forte, não absoluta) e uma política pendente (aceitar risco residual vs. cobrar excedente de WhatsApp) para o caso raro que nem mecanismo nenhum elimina por completo.

---

## 16. Revisão Claude↔Codex — Rodada 11 (2026-09-27)

**Nota do Codex: design 8,10/10 (subiu de 7,80), régua 8,5/10 — não convergido, mas a régua foi aceita sem ressalva nova e o design segue subindo de forma consistente (6,73→7,13→7,80→8,10).** Achados reais, todos corrigidos nesta versão:

1. Frase antiga "por que isto é uma garantia real desta vez" sobrevivia na seção 3.7, contradizendo a posição honesta já adotada na seção 3.8 — removida.
2. As duas válvulas (Bedrock, Textract) ainda liam fórmulas de saldo parcialmente diferentes na prática (uma omitia storage, outra omitia Bedrock já consumido) — unificadas numa única fórmula de Saldo, usada pelas duas.
3. **Achado mais importante**: a condição "só fica negativo se WhatsApp+storage sozinhos excederem o preço" estava errada — WhatsApp que chega DEPOIS de IA/OCR já ter gasto parte do orçamento também pode empurrar o total para negativo, mesmo sem WhatsApp+storage isolados excederem nada. Corrigido com um exemplo concreto (IA/OCR gasta R$100 cedo no mês + pico de WhatsApp de R$60 depois = R$160 > R$149,90, mesmo com WhatsApp+storage somando só R$60+storage).
4. Seção 3.8 alegava "margem positiva com folga, com ou sem múltiplos documentos por fornecedor" — contradizia a própria tabela (o típico com 5 documentos já mostra ~0%). Corrigido para refletir exatamente o que a tabela mostra.
5. Seção 16 (Limitações) ainda dizia "WhatsApp resolvido via digest, resíduo só no extremo de IA/OCR" — contradizia a posição final da seção 3.8. Corrigido.
6. Limiar de "~8 destinatários/org" reafirmado explicitamente como ordem de grandeza ilustrativa, não medida ou garantida — sem dados reais de distribuição de uso para calibrar com precisão.

**Status**: 11 rodadas completas. Régua estável 8,5/10 desde a Rodada 3, aceita sem contestação nova pela 3ª rodada seguida — considerada genuinamente estável. Design em tendência de alta consistente nas últimas 4 rodadas. Achados desta rodada eram, na sua maioria, textos remanescentes de rodadas anteriores que não tinham sido atualizados em todos os lugares onde apareciam — não mais erros de concepção do mecanismo em si, que o Codex já validou tecnicamente como implementável desde a Rodada 9.

---

## 17. Revisão Claude↔Codex — Rodada 12 (2026-09-27)

**Nota do Codex: design 8,35/10 (subiu de 8,10), régua 8,5/10 — mantida sem nova contestação pela 4ª rodada seguida (genuinamente estável).** Achados reais, todos corrigidos nesta versão:

1. **Tabela original da seção 3.6 (Rodada 6) nunca tinha sido marcada como substituída pela análise corrigida da seção 3.8** — a linha "Elevado, agregado 5 orgs" ainda mostrava -196% (calculado SEM nenhuma proteção), contradizendo a análise real com o mecanismo aplicado. Corrigido com nota explícita: a tabela de 3.6 mostra exposição bruta sem proteção (ordem de grandeza), a de 3.8 é a referência real com o mecanismo.
2. "Textract roda sempre... nunca gated" (passo 3 da seção 3.7) contradizia a válvula secundária (passo 5) que pode adiá-lo em extremos — corrigido para deixar claro que o passo 5 tem precedência.
3. A conclusão final ainda recomendava monitorar "WhatsApp se aproximar do preço sozinho" — muito estreito, dado o achado da Rodada 11 de que o gasto acumulado total (não só WhatsApp isolado) é que importa. Corrigido para "monitorar o Saldo completo da assinatura".
4. A tabela recalculada da seção 3.8 não deixava claro que assume uma ORDEM específica de gasto (WhatsApp+storage do mês conhecidos primeiro) — corrigido com ressalva explícita de que a ordem real de chegada dos eventos pode produzir resultado diferente.

**Status**: 12 rodadas completas. Régua estável 8,5/10 há 4 rodadas seguidas sem contestação — considerada definitivamente estável. Design em alta consistente há 5 rodadas (6,73→7,13→7,80→8,10→8,35). Os achados desta rodada eram, mais uma vez, textos remanescentes de rodadas anteriores não totalmente reconciliados entre si — não erros novos de concepção.

---

## 18. Limitações desta proposta

- Os números de fornecedores incluídos por tier pago (100/500/2.000) não têm precedente de mercado direto, diferente do eixo em si (validado 2x).
- **Custo de WhatsApp reduzido drasticamente pelo digest (seção 3.5), mas NÃO totalmente resolvido (correção da Rodada 11)** — WhatsApp continua sem teto genuíno por definição (nunca bloqueado); o resíduo de risco de margem negativa não está isolado ao cenário extremo de IA/OCR, pode aparecer sempre que o gasto acumulado total (WhatsApp + storage + IA/OCR já gasto) ultrapassar o preço, inclusive em combinações menos extremas — ver seção 3.8 para a posição final honesta sobre isso.
- Comportamento de excedente de armazenamento (storage) não definido explicitamente (só fornecedores e IA/OCR foram cobertos).
- O cálculo de custo de servir por tier (seção 3.6) é uma estimativa de ordem de grandeza com preços públicos AWS, não uma análise de consumo real validada — D-346 seção 5.2 já registrou o cálculo real como pré-requisito antes de fixar preço final; ainda pendente.
- Preço avulso de organização extra (Profissional/Premium) não definido.
- Comparação da seção 4 usa "itens/registros" dos concorrentes como proxy de "fornecedores" nosso — unidades podem não ser equivalentes, ressalva já registrada, mas não eliminada.
- **Implementação do digest não existe ainda** — esta proposta ativa uma decisão de design já documentada (`07-domain-model-escalation-watchers-digest.md`) mas o mecanismo (`DigestEntry`, agregação na camada de entrega) precisa ser construído antes de qualquer lançamento comercial com WhatsApp ativo.
