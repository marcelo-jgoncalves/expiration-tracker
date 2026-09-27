# Pesquisa de Concorrência — OmniVence (2026-09-27)

**Pedido por:** Marcelo, 2026-09-27, no mesmo fluxo da decisão D-345 (multi-organização por `OWNER`, gated por plano). Objetivo: descobrir se já cobrimos as funcionalidades dos concorrentes, quanto cobram, e onde há espaço para diferencial com plano mais barato.

**Método:** 3 agentes de pesquisa web independentes, cada um cobrindo um segmento (mercado brasileiro; plataformas globais de compliance de fornecedores; SaaS de contratos/renovação para PME fora do Brasil), buscando e lendo diretamente páginas de preço/produto reais — nunca inventando concorrente ou preço. 36 concorrentes reais encontrados, cada um com URL + data de consulta (tabela completa na seção 6) — **25 verificados por fetch direto da página oficial, 11 por busca agregada (agregador terceiro nomeado só em 1 dos 11 casos), achado da Rodada 6, ver seção 6** — alguns apps genéricos de nicho sem preço/feature distintos, mencionados agregadamente na seção 2.1, não contam nesses 36 e não têm linha própria na seção 6. Onde um dado não pôde ser confirmado no site, foi marcado explicitamente como não encontrado (nunca presumido).

**Como isto se encaixa no que já existe:** `docs/project/roadmap-competitivo-2026-09-01.md` já tinha uma tabela de preço RASCUNHO (Free R$0 / Essencial R$59,90 / Profissional R$99,90 / Premium R$149,90, §12) e um roadmap de features P0-P2 (§3) — esta pesquisa testa essas duas coisas contra o mercado real, não as substitui sem revisão de Marcelo.

---

## 1. Segmentos pesquisados

OmniVence tem duas frentes de produto que competem em mercados distintos:

- **(A) Controle de vencimentos pessoal/PME** — indivíduos, autônomos, MEIs, pequenas empresas rastreando certidões, licenças, apólices, contratos, documentos de veículo, domínios.
- **(B) Compliance documental de fornecedores** — organizações rastreando requisitos documentais dos seus fornecedores/parceiros, com solicitação de documento por link (guest upload), extração por IA/OCR com verificação humana, status por requisito.

## 2. Achados por categoria

### 2.1 Brasil — controle de vencimentos pessoal/PME (5 concorrentes relevantes)

Não identificado, nas fontes consultadas, um concorrente brasileiro direto e especializado como o nosso (achado da Rodada 3: "não encontrado na busca" é diferente de "comprovadamente não existe" — linguagem ajustada aqui e nos pontos equivalentes abaixo). O que existe:
- Apps pessoais simples (**RemindMe**, R$25-60/mês) — sem B2B, só push local, sem OCR.
- Módulos dentro de GEDs corporativos genéricos (**Software Neutron**, **MegaGED**) — sem preço público, vendidos por "fale conosco" para médio/grande porte, sem multi-canal/templates/import em massa/trilha de auditoria confirmados.

**Gap real**: nenhum concorrente identificado nas fontes consultadas ataca o meio-termo (freelancer/MEI/PME, self-serve, preço público, multi-canal com WhatsApp/Telegram) — exatamente nosso posicionamento nos tiers Essencial/Profissional.

### 2.2 Brasil — compliance documental de fornecedores (8 concorrentes relevantes)

**Predominantemente enterprise, venda consultiva**, mirando empresas com centenas/milhares de fornecedores — **exceto suaCND** (nicho contábil, preço parcialmente público), única exceção da amostra: (achado do Codex, Rodada 4 — a frase "todos sem preço público" contradizia a própria linha da suaCND na tabela abaixo)

| Concorrente | Foco | Preço público? |
|---|---|---|
| **Linkana** | Tecnicamente o mais sofisticado — IA extrai dados de contratos/alvarás/demonstrações, score de risco, integração SAP/Oracle/TOTVS. Clientes: XP, Suzano, BASF, Banco Inter | Não |
| **Wehandle** | Portal do fornecedor, IA/OCR (+1000 tipos de doc), score, integração com controle de acesso físico (catraca) | Não |
| **Sertras** | Modelo "pay-to-play" (fornecedor paga a certificação), due diligence, ESG | Não |
| **Dootax** | Automação de CND via RPA (não OCR), multi-filial | Não |
| **suaCND** | Nicho contábil, R$3,50/CNPJ/mês (modelo trial/promocional) | Parcial |
| **Valide Soluções** | Foco trabalhista (ASO/treinamentos), reivindica atender PME sem provar com preço | Não |
| **GT Soft/Insoft4** | Pioneiro (2005), self-service do terceiro (aproxima-se de guest upload) | Não |

**Gap real**: nenhum tem tabela de preço pública/self-serve para PME gerenciando dezenas (não milhares) de fornecedores. Confirma espaço para nosso módulo B2B com preço público — mas expõe que, em conta com centenas de fornecedores, perderíamos em profundidade de IA/score para Linkana/Wehandle.

### 2.3 Global — plataformas de compliance de fornecedores (11 concorrentes)

- **Avetta / ISNetworld** (líderes de mercado): usam modelo **invertido** — o *fornecedor* paga para ficar qualificado (US$450-5.000/ano), não a empresa que rastreia. Amplamente criticado como "pagar para trabalhar" — **decisão consciente: não copiar esse modelo**.
- **Veriforce / ComplyWorks / Cognibox / Rapid Global**: 100% "fale conosco", nenhum preço público, foco em indústria pesada.
- **myCOI/illumend**: melhor história de IA (agente "Lumie" lê e verifica apólices automaticamente com humano-no-loop) — mas enterprise-only e só cobre seguro (COI), não documentos em geral.
- **TrustLayer**: reivindica upload sem conta e atender PME, mas sem preço público.
- **Certificial**: único com preço público baixo (Free até 5 fornecedores, depois US$99/mês) — mas só cobre seguro.

**Nenhum concorrente identificado nas fontes consultadas combina**: guest-upload sem conta + IA/OCR com verificação humana obrigatória + status por requisito/fornecedor + preço público acessível. **Essa combinação é o espaço em branco mais claro encontrado por esta pesquisa** — não uma prova de que nenhum concorrente no mundo faz isso.

### 2.4 Global — trackers de expiração e CLM para PME (13 concorrentes)

- **Expiration Reminder** e **Remindax** são os gêmeos funcionais mais próximos do OmniVence — WhatsApp, IA/OCR de datas, importação em massa. Remindax: US$23-29/mês no tier de entrada (dentro da nossa faixa-alvo). Expiration Reminder: US$49-399/mês (acima).
- **Achado crucial para D-345 (multi-org gated por plano), números corrigidos na Rodada 4 conforme a [tabela oficial da Remindax](https://www.remindax.com/pricing) (a correção da Rodada 3 ainda estava errada — Codex verificou de novo)**: sequência real dos 4 tiers pagos, empresas incluídas = **1/2/2/3** (não 1/1/2/3): Basic US$29/mês (US$23 anual-equivalente, 1 empresa) → Professional US$79/mês (US$63 anual-equivalente, 2 empresas) → Business US$149/mês (US$119 anual-equivalente, 2 empresas) → Premium US$299/mês (US$239 anual-equivalente, 3 empresas). Compra de empresa extra avulsa sem subir de tier também existe — confirmada só na Remindax, não identificada na VendorJot abaixo.
- **Segundo precedente real, adicionado na Rodada 2, dados corrigidos na Rodada 4 conforme [vendorjot.com/pricing](https://www.vendorjot.com/pricing)**: **VendorJot** vende 6 planos, cada um JÁ INCLUINDO um número de workspaces (não "preço por workspace" — correção de unidade, achado do Codex) — Free (1 workspace), US$29/mês (1), US$49/mês (3), US$99/mês (10), US$199/mês (15), US$399/mês (20). Confirma que "número de organizações/workspaces incluídas no plano como alavanca de tier" aparece em pelo menos 2 dos 36 concorrentes pesquisados, não só na Remindax — a mecânica de "compra avulsa sem subir de tier" da Remindax não foi identificada na VendorJot. VendorJot também tem o melhor exemplo de guest upload sem conta (link mágico) — valida essa feature.
- Ferramentas de CLM (**ContractSafe**, **Contractbook**, **Concord**, **Gatekeeper**) custam **muito acima** da nossa faixa: US$450-1.245/mês.
- Enterprise (**Ironclad**, **Agiloft**): US$30 mil–600 mil+/ano — serve só de contraste de mensagem.
- **"Score de compliance" (nota calculada, não só dashboard de status)**: Linkana (seção 2.2) já tem um score calculado real (0-100, pesos por documento) — **não é uma ausência de mercado**, correção mantida da Rodada 1 (a versão original deste relatório afirmava "0 de 36 têm").

---

## 3. Tabela mestra — onde estamos vs. o mercado

Cobertura de feature do OmniVence hoje (do que já vimos implementado nesta e em sessões anteriores) vs. o que os concorrentes oferecem:

| Feature | OmniVence hoje | Quantos concorrentes (de 36) confirmam ter |
|---|---|---|
| Lembrete por e-mail | ✅ | Maioria |
| Lembrete por WhatsApp | ✅ (M4, gated por E-019 jurídico) | Só 3: Expiration Reminder, Remindax, suaCND(?) — raro |
| Lembrete por Telegram | ✅ | 0 confirmados — **diferencial real** |
| Templates de requisito reutilizáveis | ✅ (Requirement Templates, roadmap item 1) | Poucos (Rapid Global, Contractbook, Linkana parcial) |
| Importação em massa (CSV) | ✅ (Items; Requirements ainda não) | ~8 de 36 |
| Guest upload sem conta | ✅ (A14, já implementado) | Raro — só VendorJot (magic link) faz bem; TrustLayer reivindica mas sem prova |
| Extração IA/OCR + verificação humana obrigatória | ✅ (fail-closed por design, `AI Architecture`) | ~6 confirmam IA/OCR; myCOI/illumend também confirma humano-no-loop — **não é exclusividade de mercado**, corrigido na Rodada 1 |
| Busca full-text | 🔴 backlog P1 (D-202, bloqueado) | Só 2 de 36 (ContractSafe, Contractbook) — dado registrado, não usado para recomendar re-priorização (ver seção 5.4) |
| Dashboard de compliance/risco | ✅ | Maioria dos players B2B |
| Relatórios + trilha de auditoria | ✅ (roadmap §18.2, já entregue) | Maioria |
| Tipos de documento configuráveis | ✅ | Vários |
| Ações em massa | ✅ (roadmap §18.3, já entregue) | Poucos confirmam |
| Compartilhamento externo seguro (link temporário) | ✅ (`ExternalShareLink`, roadmap §18.3, já entregue) | VendorJot (magic link), parcialmente ContractSafe/Contract Hound |
| Assinatura eletrônica | 🔴 backlog P2 | ~6 de 36, mas como add-on pago ou via DocuSign — poucos nativos |
| API pública/webhooks | 🔴 backlog P2 | ~8 de 36, muitos via Zapier só |
| Integração com calendário | 🔴 backlog P2 | Remindax e Expiration Reminder (Outlook) confirmados — menos raro do que a 1ª versão deste relatório concluiu |
| Score de compliance (nota calculada) | 🔴 backlog P2 (roadmap §18.4, já é item existente — corrigido, não é novidade desta pesquisa) | Linkana confirma ter (0-100, pesos por documento) — **não é uma ausência de mercado, corrigido após crítica do Codex** |
| Portal completo do fornecedor/cliente | Parcial (guest upload existe, portal completo não) | Avetta/ISNetworld/Wehandle são enterprise; **VendorJot é uma exceção real de porte PME** (6 planos, US$0 a US$399/mês, cada um incluindo de 1 a 20 workspaces, [vendorjot.com/pricing](https://www.vendorjot.com/pricing)) — não é "todos enterprise" |
| SSO/SCIM/enterprise | 🔴 backlog Futuro | Só nos tiers Enterprise dos concorrentes maiores |
| **Multi-organização por dono, gated por plano** | ✅ **decidido (D-345)**, não implementado | **2 precedentes reais**: Remindax (empresas incluídas por tier = 1/2/2/3; compra de empresa extra avulsa sem subir de tier não identificada em outro concorrente) e VendorJot (6 planos, cada um incluindo de 1 a 20 workspaces) — Remindax não é o único precedente |

**Conclusão (corrigida após Rodada 1 do protocolo — ver seção 5)**: já cobrimos a maior parte do que os concorrentes oferecem, incluindo itens que a primeira versão deste relatório havia marcado incorretamente como pendentes (ações em massa, compartilhamento externo seguro — já entregues, roadmap §18.3). Telegram como canal continua um diferencial não identificado nas fontes consultadas (nunca "comprovadamente ausente do mercado" — distinção reforçada na Rodada 3). **Verificação humana obrigatória e score de compliance NÃO são diferenciais exclusivos** como a primeira versão afirmou — Linkana já tem score calculado (0-100, pesos por documento) e myCOI já usa humano-no-loop; a alegação de exclusividade foi retirada. Full-text search e e-signature seguem com baixa contagem de concorrentes, mas o Codex apontou corretamente que baixa contagem não prova baixo risco de negócio — tratar como hipótese a validar, não como fato estabelecido.

---

## 4. Checklist de critérios de nota (E-014) — introduzido na Rodada 2, reponderado na Rodada 3

**Declaração de pesquisa externa (protocolo E-014, `docs/engineering/research-protocol.md`): SIM.** Pricing/posicionamento de SaaS B2B é um padrão que outras empresas já resolveram extensivamente; a amostra (36 concorrentes, 25 verificados por fetch direto e 11 por busca agregada — ver ressalva de rastreabilidade na seção 6 —, 4 segmentos: Brasil pessoal/PME, Brasil B2B fornecedores, global B2B fornecedores, global trackers/CLM) cobre desde apps pessoais até enterprise, reduzindo viés de nicho único — representatividade justificada, não só listada.

**Correção de processo registrada explicitamente (exigida pelo protocolo quando o Codex contesta a régua)**: a Rodada 1 foi submetida **sem** este checklist — o Codex apontou isso corretamente (nota da régua 2,0/10) e a proposta foi avaliada por impressão geral em vez de critérios explícitos. Este checklist nasceu na Rodada 2; a Rodada 2 do Codex **contestou parcialmente** os pesos/âncoras (régua 8,0/10, ainda não ≥9,0) e sugeriu explicitamente a reponderação e o critério novo abaixo — **incorporados nesta versão (Rodada 3)**, citado aqui como correção explícita, nunca trocado em silêncio. Subordinado ao eixo "Arquitetura/Modelo de Produto" de `docs/engineering/joint-review-criteria.md` — este checklist é uma sub-rubrica específica desta decisão, não substitui os 9 eixos fixos.

| # | Critério | Peso | Atende | Não atende |
|---|---|---|---|---|
| 1 | **Verificabilidade** — toda alegação de preço/feature/exclusividade/cobertura funcional cita fonte real + data de acesso, e a amostra é justificada como representativa (não só listada) | 20% | Cada afirmação (numérica ou de exclusividade) tem URL+data rastreável (seção 6), aponta a página específica usada | Alegação sem fonte, fonte que não sustenta o número/exclusividade citada, ou aponta só o domínio raiz sem a página específica |
| 2 | **Sem inferência de ausência indevida** — "poucos concorrentes confirmam X" nunca vira "baixo risco de não ter X" sem justificativa adicional além da contagem | 15% | Toda recomendação de re-priorização cita um motivo além de "concorrentes não têm" (ex. custo de implementação, demanda de cliente já observada) | Recomendação apoiada só na contagem de concorrentes |
| 3 | **Consistência interna** — toda alegação sobre o que o OmniVence "já tem"/"não tem" é conferida contra `roadmap-competitivo-2026-09-01.md`/`decisions-log.md` antes de publicar, sem contradição entre seções do próprio relatório | 15% | Estado do produto citado bate com a fonte interna real, e a mesma alegação não aparece diferente em 2 seções do relatório | Estado presumido/desatualizado, ou correção aplicada em uma seção mas não nas outras (como ocorreu na Rodada 2) |
| 4 | **Especificidade acionável e coerência do gating de multi-org** — a proposta define quem paga, cotas por-organização, downgrade, MÚLTIPLOS `OWNER`s e transferência de titularidade — e reconhece explicitamente quando o modelo técnico existente (`TenantEntitlement`, `Membership.status`, `TenantLifecycleRecord`) não cobre um desses pontos, em vez de forçar um mecanismo errado | 20% | Os 5 pontos estão explicitados; qualquer ponto sem mecanismo técnico existente é nomeado como gap de design a escopar separadamente, nunca preenchido com uma reutilização incorreta de um mecanismo existente | Ponto omitido, ou preenchido reaproveitando um mecanismo que não serve para o caso (ex. `TenantLifecycleRecord` é forward-only para deleção, não serve para pausa reversível) |
| 5 | **Câmbio e periodicidade normalizados** — toda comparação de preço declara taxa de câmbio + data, e mensal vs. anual é normalizado com a mesma base antes de comparar | 10% | Conversão explícita, mesma base de período (mensal) em toda a tabela comparativa, sem misturar preço anual-equivalente com preço mensal cobrado | Valores de moedas/períodos distintos comparados diretamente, ou base de período inconsistente entre linhas da mesma tabela |
| 6 | **Reconciliação com princípios já registrados do projeto** — nenhuma recomendação contradiz uma decisão/princípio já existente (ex. roadmap §13) sem reconhecer e resolver a tensão com base no texto original da fonte, não numa interpretação extrapolada | 10% | Tensão nomeada e resolvida citando o texto original da fonte interna | Tensão ignorada, ou resolvida com uma interpretação que o texto original não sustenta |
| 7 | **Validação comercial/econômica** *(novo, sugerido pelo Codex na Rodada 2)* — a proposta de preço inclui um plano concreto de validação (não just "é mais barato que enterprise") e reconhece que cotas por-organização multiplicam o consumo potencial incluído numa assinatura | 10% | Plano de validação nomeado (ex. lista de espera, entrevistas) + reconhecimento explícito do efeito de cotas multiplicadas por org | Preço justificado só por comparação com concorrentes mais caros, sem plano de validação nem análise de custo de servir |

---

## 5. Proposta de posicionamento e preço (Rodada 5, revisada)

> Isto é uma PROPOSTA para revisão — não uma decisão. Marcelo decide. **Revisada após as críticas das Rodadas 1-4 (seções 7-10) — a régua do checklist (seção 4) já está estável/aceita; esta rodada só ajusta o design contra ela.**

### 5.1 Pitch de posicionamento

*"A alternativa moderna e acessível ao mundo Avetta/ISNetworld, sem a estreiteza de escopo do mundo myCOI/TrustLayer/Certificial — pensado para PME, não para indivíduo isolado ou para grande corporação."*

**Mudança desde a Rodada 1**: removida a afirmação "o primeiro controle de vencimentos brasileiro pensado para PME" — não demonstrada pela pesquisa (achado real do Codex), só o gap de mercado foi demonstrado, não a alegação de "primeiro". O pitch de "alternativa a Avetta/ISNetworld" é mantido como hipótese de mensagem, com a ressalva explícita de que cria expectativa de profundidade funcional (score/IA/integrações ERP) que o OmniVence ainda não tem no nível desses dois concorrentes — comunicar o escopo real, não prometer paridade de profundidade.

### 5.2 Preço — tratado como hipótese a testar, não como validado

**Mudança desde a Rodada 1**: a versão anterior tratava a faixa atual (Free/R$0, Essencial/R$59,90, Profissional/R$99,90, Premium/R$149,90) como "bem posicionada" e recomendava não mudar. O Codex apontou corretamente: **ser mais barato que concorrentes enterprise não prova que MEIs pagariam R$59,90, nem que o preço sustenta o custo real de servir um cliente B2B** (OCR/IA, WhatsApp, storage, suporte). A faixa segue como ponto de partida razoável (nenhum concorrente identificado nas fontes consultadas ataca esse meio-termo de preço para o mesmo escopo).

**Plano de validação concreto (critério 7, adicionado na Rodada 3 por sugestão do Codex)**: antes de tratar a faixa como decidida, (1) lista de espera/early-access com pergunta explícita de faixa de preço aceitável, (2) 5-10 entrevistas com potenciais clientes PME reais (não só early adopters técnicos), (3) cálculo de custo de servir por tier — chamadas de OCR/IA (Textract/Bedrock) e WhatsApp têm custo variável real por uso, e **multi-org multiplica esse custo**: um `OWNER` com 2-5 organizações no mesmo tier paga uma vez mas consome cotas de IA/WhatsApp/storage várias vezes (uma por organização, seção 5.3) — o preço do tier precisa cobrir esse consumo multiplicado, não só o consumo de 1 organização. Este cálculo não foi feito nesta pesquisa (é interno, não de mercado) e é um pré-requisito real antes de fixar o preço final dos tiers com multi-org.

### 5.3 Gating de multi-organização (D-345) — mecânica concreta

**Mudança desde a Rodada 1**: a versão anterior só listava números de orgs por tier, sem mecânica. A Rodada 2 tentou ancorar downgrade num reaproveitamento de `Membership.status`/`TenantLifecycleRecord` — **o Codex verificou por leitura direta do código e derrubou essa proposta**: `TenantLifecycleRecord` (`src/shared/tenant-lifecycle/tenant-lifecycle-record.ts`) é uma máquina de estados **forward-only** ("ACTIVE nunca é reentrado", com uma única exceção nomeada) desenhada para o fluxo de EXCLUSÃO de tenant — reaproveitá-la para uma pausa reversível por motivo de billing seria uma extensão incorreta de um mecanismo que existe para outra coisa. `Membership.status` é por-pessoa (uma linha por usuário×organização), não por-organização — suspender um `Membership` não impede outros `MEMBER`s/`OWNER`s de continuar usando a organização.

Correção honesta (critério 4 do checklist, seção 4): a mecânica de pagamento/cota é definida abaixo; **downgrade, múltiplos `OWNER`s e transferência de titularidade são registrados como um gap de design real, não preenchidos com um mecanismo que não serve para o caso**:

| Plano | Orgs incluídas | Org extra avulsa | Cotas (storage/IA/WhatsApp) |
|---|---|---|---|
| Free | 1 | Não disponível | Por organização (já é o modelo hoje, `TenantEntitlement`) |
| Essencial | 1 | Não disponível | Por organização |
| Profissional | até 2 | Sim, preço avulso a definir (precedente: Remindax vende empresa extra sem subir de tier — VendorJot inclui workspaces fixos por plano, sem essa opção confirmada) | Por organização, sem compartilhamento entre as orgs do mesmo dono — ver seção 5.2 sobre o efeito de custo multiplicado |
| Premium | até 5 | Sim, preço avulso a definir | Idem |

**Gap de design real, registrado explicitamente (não resolvido nesta pesquisa)**: o modelo atual (`Membership` já permite múltiplos `OWNER`s por organização, physical model D-086) não tem hoje o conceito de "qual `OWNER` é o pagador responsável pelo limite de organizações do grupo", nem um estado de organização "pausada por billing, dados preservados, reversível" (o que existe — `TenantLifecycleRecord` — é para exclusão definitiva, não pausa). Definir isso exige: (1) quem é o pagador quando há múltiplos `OWNER`s, (2) o que acontece se esse pagador specific sai da organização ou é removido, (3) um estado novo de organização (não reaproveitando `TenantLifecycleRecord`) para "acima do limite do plano, mas não excluída", (4) fluxo de transferência de titularidade. **Isto precisa da sua própria rodada de escopo técnico (nível 5) antes da implementação de D-345** — não é algo que esta pesquisa de mercado deveria/conseguiria resolver.

**Reconciliação com roadmap §13** — citação direta da fonte (`roadmap-competitivo-2026-09-01.md` §13): *"Evitar depender principalmente da quantidade de empresas. Preferir limites ligados a custo real: storage + IA/OCR + WhatsApp + usuários. Subjects e documentos podem ter limites generosos."* Lido literalmente, "quantidade de empresas" nesse texto tem ambiguidade real — pode significar "quantos `TrackedSubject` (fornecedores) uma organização rastreia" (leitura mais provável dado o contexto de "Subjects e documentos") ou, menos provavelmente, "quantas organizações". **Não presumir a leitura mais favorável à proposta sem confirmar com Marcelo** — o achado do Codex na Rodada 2 é correto: a interpretação anterior ("§13 sempre tratou exclusivamente de fornecedores dentro de uma organização") extrapolava o texto original. Registrado aqui como pergunta em aberto para Marcelo resolver, não como reconciliação fechada.

### 5.4 Recomendações de roadmap — reformuladas como hipóteses, não conclusões

**Mudança desde a Rodada 1**: a versão anterior recomendava "descer prioridade" de full-text/calendário só pela baixa contagem de concorrentes — o Codex apontou que isso é uma inferência de ausência logicamente frágil (contagem de concorrentes mede o que eles divulgam publicamente, não o que clientes exigem). Correção — nenhuma recomendação de re-priorização nesta rodada, só dados registrados para pesar junto de outros critérios (custo de implementação, pedidos reais de cliente) que esta pesquisa não cobre:

1. **P0 atual**: sem mudança recomendada — já cobre os itens mais comuns entre concorrentes (templates, bulk import, IA/OCR, dashboard, relatórios). Isto não prova que os fluxos estão completos ou suficientes, só que a lista de features está alinhada.
2. **Full-text search (D-202, P1 bloqueado)**: dado registrado — só 2 de 36 concorrentes confirmam ter. Não é recomendação de descer prioridade; é um dado a mais para a decisão de caminho que já está pendente com Marcelo em D-202.
3. **Integração de calendário (P2)**: dado registrado — Remindax e Expiration Reminder confirmam ter (2 de 36, não só 1 como a versão anterior afirmou). Já está em P2, sem mudança de tier recomendada.
4. **Score de compliance (já é item P2 existente, roadmap §18.4)**: dado registrado — Linkana já tem um score calculado (0-100, pesos por documento, dispensas, revisão pendente). Implementar um score raso (média simples que esconde uma pendência crítica atrás de uma nota favorável) seria pior que não ter — qualquer implementação futura precisa tratar criticidade/documentos faltantes/dispensas explicitamente, não só "média de status", achado real do Codex.
5. **Telegram como canal**: dado registrado — 0 de 36 concorrentes confirmam ter. Vale comunicar como diferencial, mas demanda real de cliente por esse canal específico não foi medida por esta pesquisa.

---

## 6. Fontes consultadas (reprodutibilidade) + normalização de câmbio

**Taxa de câmbio de referência usada nesta seção e nas comparações acima: USD 1 = R$ 5,30, EUR 1 = R$ 5,70** — cotação aproximada de mercado em 2026-09-27 (**achado da Rodada 3: esta taxa não tem fonte primária única citável por URL, é uma referência de ordem de grandeza — nunca usar para decisão final de preço sem checar a cotação exata do dia**). Onde um concorrente cobra mensal e anual-equivalente diferentes (ex. desconto anual), a coluna "Preço citado (original)" declara os dois valores explicitamente, nunca um único número ambíguo.

| Concorrente | URL | Preço citado (original — mensal e anual-equivalente quando diferentes) | Preço citado (BRL/mês, referência) | Método | Data |
|---|---|---|---|---|---|
| RemindMe | apps.apple.com/br/app/vencimento-documento-remindme | R$24,90-59,90/mês | R$24,90-59,90 | Fetch direto (App Store) | 2026-09-27 |
| Software Neutron | softwareneutron.com.br | Não divulgado | — | Fetch direto | 2026-09-27 |
| MegaGED | megaged.com.br | Não divulgado | — | Fetch direto | 2026-09-27 |
| Dootax | dootax.com.br/solucoes/gestao-de-certidoes | Não divulgado | — | Fetch direto | 2026-09-27 |
| suaCND | suacnd.com | R$3,50/CNPJ (trial 24h) | ~R$3,50/CNPJ | Fetch direto | 2026-09-27 |
| Linkana | linkana.com; suporte.linkana.com (score) | Não divulgado (enterprise) | — | Fetch direto + doc de suporte | 2026-09-27 |
| Wehandle | wehandle.com.br | Não divulgado (enterprise) | — | Fetch direto | 2026-09-27 |
| Sertras | sertras.com/homologacao-de-fornecedores | Não divulgado | — | Fetch direto | 2026-09-27 |
| Valide Soluções | validesolucoes.com.br | Não divulgado | — | Fetch direto | 2026-09-27 |
| GT Soft/Insoft4 | insoft4.com.br/gtsoft-gestao-de-terceiros | Não divulgado (enterprise) | — | Fetch direto | 2026-09-27 |
| Contraktor | contraktor.com.br | Não divulgado (`/precos` 404) | — | Fetch direto | 2026-09-27 |
| GestãoClick | gestaoclick.com.br/gestao-de-contratos | R$119-379/mês | R$119-379 | Fetch direto | 2026-09-27 |
| Projuris | projuris.com.br/contratos; start.projuris.com.br | Fale conosco / START grátis | R$0 (START) | Fetch direto | 2026-09-27 |
| Avetta | avetta.com; docs.connect.avetta.com | US$399-3.499/ano (lado fornecedor, estimativa de terceiros) | ~R$176-1.546/mês | Fetch direto + estimativa de terceiros (marcado) | 2026-09-27 |
| Veriforce | veriforce.com | Fale conosco (estimativa terceiros: US$1.500+/ano) | ~R$663+/mês (estimativa) | Busca agregada, não fetch direto | 2026-09-27 |
| ISNetworld | isnetworld.com | US$875+/ano (lado fornecedor) | ~R$386+/mês | Busca agregada | 2026-09-27 |
| ComplyWorks | complyworks.com | Fale conosco | — | Fetch direto | 2026-09-27 |
| Cognibox | cognibox.com | Fale conosco (estimativa CA$300/usuário/ano) | — | Busca agregada | 2026-09-27 |
| Rapid Global | rapidglobal.com | Fale conosco | — | Fetch direto | 2026-09-27 |
| Contractor Compliance | contractorcompliance.io (agora VelocityEHS) | US$349-1.999/ano | ~R$154-883/mês | Fetch direto (dados históricos, empresa adquirida) | 2026-09-27 |
| myCOI/illumend | mycoitracking.com; illumend.ai | Não divulgado | — | Fetch direto | 2026-09-27 |
| TrustLayer | trustlayer.io | Não divulgado (estimativa terceiros US$1.000+) | — | Busca agregada | 2026-09-27 |
| Certificial | certificial.com | US$0 (até 5) / US$99/mês | R$0 / R$525 | Fetch direto | 2026-09-27 |
| Expiration Reminder | expirationreminder.com | US$49-399/mês | R$260-2.115 | Fetch direto | 2026-09-27 |
| Remindax | remindax.com/pricing | Basic: US$29 ou US$23/mês anual (1 empresa) · Professional: US$79 ou US$63/mês anual (2 empresas) · Business: US$149 ou US$119/mês anual (2 empresas) · Premium: US$299 ou US$239/mês anual (3 empresas) | Mensal: R$153,70-1.584,70 · Anual-equivalente: R$121,90-1.266,70 (faixas separadas na Rodada 5, achado do Codex — não misturar mínimo anual com máximo mensal) | Fetch direto | 2026-09-27 |
| RenewAlert | renewalert.net | US$14,99-49,99/mês | R$79-265 | Fetch direto | 2026-09-27 |
| VendorJot | vendorjot.com/pricing | US$0/29/49/99/199/399/mês (6 planos, cada um incluindo 1/1/3/10/15/20 workspaces — preço do plano, não por workspace, corrigido na Rodada 4) | R$0-2.115 | Fetch direto | 2026-09-27 |
| ContractSafe | contractsafe.com/features | US$450-815/mês | R$2.385-4.320 | Fetch direto (busca p/ preço) | 2026-09-27 |
| Contractbook | contractbook.com | €399-599/mês | ~R$2.274-3.415 | Busca agregada | 2026-09-27 |
| Concord | concord.app | US$499-899/mês + assento | R$2.645-4.765+ | Busca agregada | 2026-09-27 |
| Contract Hound | contracthound.com | US$95/mês | R$504 | Fetch direto | 2026-09-27 |
| PandaDoc | pandadoc.com | US$19-49/usuário/mês | R$101-260/usuário | Busca agregada | 2026-09-27 |
| Ironclad | ironclad.com | Fale conosco (estimativa US$30k-600k/ano) | — | Busca agregada | 2026-09-27 |
| Agiloft | agiloft.com | Fale conosco (estimativa ~US$68k/ano médio, agregador Vendr) | — | Busca agregada — **achado do Codex, Rodada 5: URL específica da página do Vendr não foi capturada durante a pesquisa original, só o nome do agregador; registrado como limitação, não uma fonte plenamente rastreável** | 2026-09-27 |
| Gatekeeper | gatekeeperhq.com | US$1.245/mês | R$6.599 | Busca agregada | 2026-09-27 |
| TrackSSL | trackssl.com | US$0-72/mês | R$0-382 | Busca agregada | 2026-09-27 |

**Nota sobre "fetch direto" vs. "busca agregada"**: fetch direto = página oficial do concorrente foi lida diretamente pelo agente de pesquisa nesta sessão. Busca agregada = dado vem de agregador terceiro (Capterra/G2/Vendr/GetApp/blog de mercado) porque a página oficial não publicava preço ou o fetch direto não foi possível — marcado explicitamente em cada caso, nunca apresentado com a mesma confiança de um dado de fonte primária.

**Limitação reconhecida na Rodada 5, corrigida na Rodada 6 (achado do Codex: a generalização da R5 estava ela própria incorreta)**: **11 das 36 linhas** desta tabela estão marcadas "Busca agregada". Só a Agiloft nomeia o agregador (Vendr) explicitamente — Veriforce, ISNetworld, Cognibox, TrustLayer, Contractbook, Concord, PandaDoc, Ironclad, Gatekeeper e TrackSSL dizem apenas "Busca agregada" sem nomear a fonte terceira específica nem sua URL. Em nenhum dos 11 casos a coluna URL (que lista o domínio do PRÓPRIO concorrente) é de onde o preço realmente veio. Esta é uma lacuna real de rastreabilidade não resolvida — registrada honestamente em vez de reconstruída de memória agora (risco de citar uma URL/fonte incorreta), e a afirmação "36 concorrentes com fonte individual rastreável" usada no resto do relatório deve ser lida com essa ressalva: rastreável para 25 das 36 linhas (fetch direto), e apontada mas não plenamente rastreável para as outras 11.

---

## 7. Revisão Claude↔Codex — Rodada 1 (2026-09-27)

**Protocolo acionado por pedido explícito de Marcelo.** Rodada 1: proposta (seção 4, versão original) submetida ao Codex para crítica adversarial independente.

**Nota do Codex**: Proposta 5,5/10 (independente/provisória) · Régua de pesquisa (E-014) 2,0/10 — checklist ponderado com âncoras ainda não existe, só a declaração `SIM`.

**Achados reais confirmados e corrigidos nesta versão do relatório**:
1. Ações em massa e compartilhamento externo seguro (`ExternalShareLink`) já estão **entregues** (roadmap §18.3) — a versão original os listava como pendentes. Corrigido na seção 3.
2. "Compliance score avançado" já é item existente do backlog P2 (roadmap §18.4) — a versão original afirmava que não era item numerado. Corrigido.
3. Score calculado NÃO é ausente no mercado — Linkana já tem (0-100, pesos por documento, [documentação oficial](https://suporte.linkana.com/pt-BR/articles/5339977-como-configuro-categorias-e-score-de-risco)). Alegação de exclusividade retirada.
4. Integração de calendário não é exclusiva da Remindax — Expiration Reminder também tem (sync com Outlook). Corrigido.
5. Preços da Remindax estavam errados na versão original — corrigidos na seção 2.4 conforme a [tabela oficial](https://www.remindax.com/pricing) (Basic US$23-29, Business US$119-149, Premium US$239-299; Professional já inclui 2 empresas, e há compra avulsa de empresa extra sem subir de tier).
6. "Verificação humana obrigatória" como diferencial de confiabilidade não está provada como exclusiva — o próprio relatório já registrava humano-no-loop no myCOI/illumend. Tratar como diferencial de comunicação, não de exclusividade de mercado.

**Achados metodológicos corrigidos na Rodada 2** (ver seções 4/5/6 acima): lista reprodutível de fontes com URL/data ✅ (seção 6); câmbio normalizado com taxa/data declaradas ✅ (seção 6, taxa em si sem fonte primária única — achado residual, ver seção 8); inferência de ausência indevida removida das recomendações de roadmap ✅ (seção 5.4, viraram "dados registrados", não conclusões); §13 do roadmap **citado diretamente, mas a interpretação inicial extrapolava o texto — corrigido só na Rodada 3 (seção 5.3), registrado como pergunta em aberto para Marcelo, não como reconciliação fechada**.

**Status**: Rodada 1 completa, não convergida (mínimo 2 rodadas consecutivas ≥9,0 nas duas notas, cegas, exigido pelo protocolo). Rodada 2 (seções 4-6 acima) responde a cada achado da Rodada 1 — aguardando nova crítica do Codex (seção 8).

---

## 8. Revisão Claude↔Codex — Rodada 2 (2026-09-27)

**Nota do Codex**: Régua 8,0/10 (subiu de 2,0 na R1) · Design 6,325/10 (subiu de 5,5 na R1) — melhorou, mas régua ainda não estável (não convergida) e design abaixo do necessário.

**Contestação da régua (incorporada na Rodada 3, seção 4)**: o Codex propôs reponderar para 20/15/15/20/10/10 + um 7º critério de 10% (validação comercial/econômica), e ampliar as âncoras dos critérios 1 e 4. Adotado integralmente na seção 4.

**Achados residuais reais, corrigidos na Rodada 3**:
1. Preço da Remindax ainda estava errado após a correção da R1 (Business tem 2 empresas, Premium tem 3 — não "Business com 3" como a R1 relatou) — corrigido em 2.4/6.
2. Contagem de fontes divergia do texto ("37" em várias seções vs. 36 linhas reais na tabela) — corrigido em todas as ocorrências.
3. Texto contraditório remanescente: seção 2.4 ainda dizia "0 de 37 têm score" e a linha de IA/OCR na tabela ainda chamava verificação humana de diferencial exclusivo, mesmo com a correção já feita em outro lugar — corrigido nos dois pontos.
4. "Export ainda backlog P1" contradizia roadmap §18.2 (relatórios/exportação já entregues) — corrigido.
5. Novo precedente encontrado pelo Codex: **VendorJot também tiera por número de workspace** (Free/1, US$29/1, US$49/3) — adicionado à seção 2.4/5.3, corrige a alegação de que a Remindax era o único precedente.
6. Mecânica de downgrade da Rodada 2 reaproveitava `TenantLifecycleRecord`/`Membership.status` incorretamente (o Codex verificou por leitura direta do código que `TenantLifecycleRecord` é forward-only, desenhado para exclusão, não pausa reversível) — reescrito na seção 5.3 como gap de design real a escopar separadamente, não mais fingido como resolvido.
7. Interpretação de §13 do roadmap como "exclusivamente sobre fornecedores dentro de uma organização" extrapolava o texto original — reescrito na seção 5.3 citando o texto exato e registrando a ambiguidade como pergunta em aberto para Marcelo, não como reconciliação fechada.
8. Faltava reconhecer que cotas por-organização multiplicam o consumo de IA/WhatsApp/storage incluído numa assinatura — adicionado à seção 5.2 como parte do critério 7 (validação comercial).

**Status**: Rodada 2 completa, não convergida. Rodada 3 (seções 4-6 revisadas acima) responde a cada achado residual — aguardando nova crítica do Codex (seção 9).

---

## 9. Revisão Claude↔Codex — Rodada 3 (2026-09-27)

**Nota do Codex**: Régua **9,3/10 — aceita, estável** (sem contestação material restante; Codex concorda com os 7 critérios e pesos 20/15/15/20/10/10/10). Design **8,5/10** — subiu de 6,325 (R2), ainda abaixo do limiar de convergência.

**Confirmação importante**: o Codex releu `TenantLifecycleRecord`/`Membership` diretamente e confirmou que a seção 5.3 (registrar downgrade/pagador/transferência como gap de design real, em vez de reaproveitar um mecanismo incorreto) é a resposta adequada ao achado técnico da Rodada 2 — nenhum novo erro técnico equivalente encontrado ali.

**Achados residuais reais, corrigidos nesta versão (Rodada 4)**:
1. Seção 3 ainda chamava a Remindax de "único precedente claro", contradizendo as seções 2.4/5.3 (que já citavam a VendorJot) — corrigido.
2. Sequência de planos da Remindax estava incompleta (faltava o tier Professional) — corrigido para Basic/Professional=1, Business=2, Premium=3 empresas, conforme a página oficial.
3. VendorJot ainda aparecia agrupada com "todos enterprise" na tabela de portal do cliente/fornecedor, e sua faixa de preço na seção 6 estava truncada (só até US$49, faltavam os planos US$99/199/399) — corrigido, com nota de que a mecânica de "compra avulsa sem subir de tier" é confirmada só na Remindax, não na VendorJot.
4. Linguagem de exclusividade ("não existe", "nenhum concorrente", "nenhum... oferece") suavizada para "não identificado nas fontes consultadas" em todos os pontos equivalentes — a alegação correta é ausência nas fontes pesquisadas, não prova de inexistência no mercado.
5. Seção 7 (revisão da Rodada 1) ainda marcava a reconciliação de §13 como concluída, contradizendo a seção 5.3 (que corretamente a deixa como pergunta em aberto) — corrigido.
6. Taxa de câmbio da seção 6 não tinha fonte rastreável — reconhecido explicitamente como referência de ordem de grandeza, não cotação citável.
7. Preços mistos mensal/anual-equivalente na mesma célula da tabela da seção 6 (ex. Remindax) — separados explicitamente por tier.

**Status**: Rodada 3 completa. **Régua estável e aceita por ambos os lados** (critério do protocolo E-014 atingido). Design ainda não convergido — Rodada 4 (correções acima) aguarda nova nota do Codex (seção 10). Lembrete: o protocolo (`AGENTS.md` §4) exige **duas rodadas consecutivas** com nota ≥9,0 dos dois lados antes de considerar a decisão concluída — mesmo que a Rodada 4 atinja ≥9,0, ainda faltaria uma segunda rodada confirmando.

---

## 10. Revisão Claude↔Codex — Rodada 4 (2026-09-27)

**Nota do Codex**: Régua confirmada estável (sem nova contestação). Design **8,70/10** — subiu de 8,5 (R3), ainda abaixo de 9,0.

**Confirmação**: nenhum problema estrutural novo no gating de multi-org (critério 4, nota 10,0) nem na validação comercial (critério 7, nota 10,0) — os dois critérios que tratam da mecânica de negócio da proposta já estão no máximo.

**Achados residuais reais, corrigidos na Rodada 5**:
1. **A correção de preço da Remindax da Rodada 3 ainda estava errada** — Codex verificou de novo contra a fonte oficial: a sequência real é 1/2/2/3 empresas (Basic/Professional/Business/Premium), não 1/1/2/3. Preços exatos: US$29/23 · US$79/63 · US$149/119 · US$299/239 (mensal/anual-equivalente). Corrigido em 2.4/3/6.
2. **VendorJot: erro de unidade** — os 6 planos JÁ INCLUEM um número fixo de workspaces (1/1/3/10/15/20), não é "preço por workspace" (o que implicaria cobrança multiplicativa que a fonte não confirma). Corrigido em 2.4/3/6. A afirmação de que ela também permite comprar org extra sem subir de tier foi removida — não confirmada na fonte.
3. Linguagem de exclusividade residual corrigida: "ninguém ataca o meio-termo" (2.1) → "nenhum concorrente identificado nas fontes consultadas ataca"; "compra avulsa é exclusiva da Remindax" → "não identificada em outro concorrente"; §2.2 dizia "todos sem preço público" contradizendo a própria linha da suaCND na tabela — corrigido para reconhecer a exceção.

**Status**: Rodada 4 completa, régua estável, design ainda não convergido (8,70 < 9,0). Rodada 5 (correções acima) aguarda nova nota do Codex (seção 11).

---

## 11. Revisão Claude↔Codex — Rodada 5 (2026-09-27)

**Nota do Codex: 9,15/10 — primeira nota ≥9,0 do Codex nesta decisão.** Confirmou por leitura direta das fontes oficiais que os números corrigidos de Remindax e VendorJot batem exatamente. Nenhum problema estrutural novo encontrado nos critérios 4 (gating de multi-org) e 7 (validação comercial), ambos 10,0/10. Dois achados residuais pequenos: (1) linhas "Busca agregada" da seção 6 citam o agregador pelo nome mas não a URL específica da página consultada; (2) a faixa BRL da Remindax misturava mínimo anual-equivalente com máximo mensal.

**Correções aplicadas nesta mesma revisão**: (1) reconhecida como limitação honesta e generalizada (~10 das 36 linhas da tabela, não só a Agiloft que o Codex citou como exemplo — nunca reconstruir URLs de agregador de memória, risco de citar fonte errada); (2) faixa BRL da Remindax separada em mensal (R$153,70-1.584,70) e anual-equivalente (R$121,90-1.266,70). Achado adicional próprio, fora do que o Codex reportou: seção 5.2 ainda tinha a mesma linguagem de exclusividade ("nenhum concorrente pesquisado ataca esse meio-termo") corrigida nos outros pontos — corrigida aqui também.

**Nota do Claude (auto-avaliação crítica contra os mesmos 7 critérios da seção 4, registrada com a ressalva honesta de que não é verdadeiramente cega — sou o autor da proposta)**: revisei o documento inteiro buscando ativamente por contra-evidência antes de pontuar, não só validando o que já escrevi.
- Critério 1 (verificabilidade, 20%): 8,0 — mesma lacuna de rastreabilidade em "busca agregada" que o Codex apontou; agora reconhecida explicitamente, não escondida, mas não eliminada.
- Critério 2 (inferência de ausência, 15%): 9,5 — linguagem de exclusividade agora consistentemente suavizada em todos os pontos que encontrei, incluindo um que o Codex não citou (seção 5.2).
- Critério 3 (consistência interna, 15%): 9,0 — sem contradição nova encontrada nesta revisão.
- Critério 4 (gating multi-org, 20%): 9,5 — mecânica completa, gap de design honestamente registrado; não pontuo 10 porque o gap em si ainda não tem nem uma data-alvo de resolução.
- Critério 5 (câmbio/periodicidade, 10%): 8,5 — faixas separadas corretamente agora; taxa de câmbio segue sem fonte primária única, reconhecido.
- Critério 6 (reconciliação com princípios, 10%): 9,0 — §13 tratado com honestidade, deixado como pergunta aberta.
- Critério 7 (validação comercial, 10%): 9,5 — plano concreto, efeito de cotas multiplicadas reconhecido.
- **Nota ponderada: 8,975/10 — correção da Rodada 6**: a soma ponderada real (8×20% + 9,5×15% + 9×15% + 9,5×20% + 8,5×10% + 9×10% + 9,5×10%) é 8,975, não 9,0 como esta seção afirmou originalmente. O Codex recalculou e apontou o erro aritmético na Rodada 6 — erro de cálculo real, não arredondamento indevido; `AGENTS.md` §4 já proíbe arredondar 8,99 para 9, e 8,975 também não vira 9,0. Isto invalida o status de "primeira rodada bilateral convergida" que esta seção declarava.

**Status (corrigido na Rodada 6)**: Rodada 5 completa. Codex atingiu ≥9,0 (9,15). A nota do Claude foi originalmente reportada como 9,0, mas era **8,975 de verdade** (erro aritmético, corrigido acima) — **a Rodada 5 NÃO foi uma rodada bilateral ≥9,0**, diferente do que esta seção afirmava antes da correção.

---

## 12. Revisão Claude↔Codex — Rodada 6 (2026-09-27)

**Nota do Codex: 9,00/10, sem arredondamento — fecha a sequência do lado do Codex** (R5 9,15 → R6 9,00, ambas ≥9,0). Achado real e importante desta rodada: **o Codex recalculou a soma ponderada dos 7 critérios que o Claude reportou na Rodada 5 e encontrou 8,975, não 9,0** — erro aritmético real do lado do Claude, corrigido na seção 11 acima. Também corrigiu a generalização da limitação de rastreabilidade (a R5 dizia que toda linha "Busca agregada" nomeia o agregador; na verdade só 1 das 11 nomeia — Agiloft/Vendr) — corrigido nas seções 1, 4 e 6.

**Nota do Claude (Rodada 6, recomputada com cuidado após o achado aritmético da R5)**: reavaliei os 7 critérios do zero em vez de reaproveitar os números da R5. Nenhum critério individual mudou de valor — a correção desta rodada foi de DESCRIÇÃO (rastreabilidade real: 25 fetch direto / 11 busca agregada, só 1 nomeando o agregador), não de substância nova encontrada. Recalculando com os mesmos 7 valores da R5 (8,0 / 9,5 / 9,0 / 9,5 / 8,5 / 9,0 / 9,5): a soma ponderada continua **8,975/10** — abaixo de 9,0.

**Por que não forçar o critério 1 (verificabilidade) para cima só para fechar em 9,0**: o gap é real e não desaparece só de descrevê-lo com mais precisão — 11 das 36 linhas da tabela de fontes não têm uma URL de terceiro rastreável, só "busca agregada" registrado. Resolver isso de verdade exigiria uma nova rodada de pesquisa (recuperar as URLs específicas dos agregadores), não mais edição de texto. Reportar 9,0 sem isso seria repetir o mesmo tipo de erro que o Codex encontrou nesta mesma rodada.

**Status**: Rodada 6 completa. **Codex confirmou ≥9,0 pela segunda rodada consecutiva (9,15 → 9,00).** A nota do Claude permanece em 8,975 em ambas as rodadas 5 e 6 — **a decisão NÃO converge pelo critério formal do protocolo** (exige ambos os lados ≥9,0 em 2 rodadas consecutivas). O gap residual é conhecido, específico e pequeno (rastreabilidade de 11 fontes secundárias) — não um problema de fundo na proposta de preço/posicionamento em si, que já tem nota alta e estável nos critérios de maior peso (gating multi-org 9,5/10, validação comercial 9,5/10).

## 13. Limitações desta pesquisa

- Pesquisa feita via busca web + fetch de páginas públicas, não testes reais de produto (trial/demo) — features marcadas "não encontrado no site" podem existir e não estarem documentadas publicamente.
- Preços de concorrentes "fale conosco" foram, quando possível, estimados por fontes de terceiros (marcado explicitamente como "busca agregada" na seção 6) — não são números oficiais.
- A taxa de câmbio da seção 6 é uma referência de ordem de grandeza, não a cotação exata do dia da decisão final de preço.
- Não cobre concorrentes que só existem via marketplaces de nicho não indexados em busca geral (possível lacuna, mas baixo risco dado o volume já coberto — 36 concorrentes reais com fonte rastreável).
