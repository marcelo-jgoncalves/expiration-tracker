# Pesquisa de Concorrência — OmniVence (2026-09-27)

**Pedido por:** Marcelo, 2026-09-27, no mesmo fluxo da decisão D-345 (multi-organização por `OWNER`, gated por plano). Objetivo: descobrir se já cobrimos as funcionalidades dos concorrentes, quanto cobram, e onde há espaço para diferencial com plano mais barato.

**Método:** 3 agentes de pesquisa web independentes, cada um cobrindo um segmento (mercado brasileiro; plataformas globais de compliance de fornecedores; SaaS de contratos/renovação para PME fora do Brasil), buscando e lendo diretamente páginas de preço/produto reais — nunca inventando concorrente ou preço. 37 concorrentes reais encontrados. Onde um dado não pôde ser confirmado no site, foi marcado explicitamente como não encontrado (nunca presumido).

**Como isto se encaixa no que já existe:** `docs/project/roadmap-competitivo-2026-09-01.md` já tinha uma tabela de preço RASCUNHO (Free R$0 / Essencial R$59,90 / Profissional R$99,90 / Premium R$149,90, §12) e um roadmap de features P0-P2 (§3) — esta pesquisa testa essas duas coisas contra o mercado real, não as substitui sem revisão de Marcelo.

---

## 1. Segmentos pesquisados

OmniVence tem duas frentes de produto que competem em mercados distintos:

- **(A) Controle de vencimentos pessoal/PME** — indivíduos, autônomos, MEIs, pequenas empresas rastreando certidões, licenças, apólices, contratos, documentos de veículo, domínios.
- **(B) Compliance documental de fornecedores** — organizações rastreando requisitos documentais dos seus fornecedores/parceiros, com solicitação de documento por link (guest upload), extração por IA/OCR com verificação humana, status por requisito.

## 2. Achados por categoria

### 2.1 Brasil — controle de vencimentos pessoal/PME (5 concorrentes relevantes)

Não existe concorrente brasileiro direto e especializado como o nosso. O que existe:
- Apps pessoais simples (**RemindMe**, R$25-60/mês) — sem B2B, só push local, sem OCR.
- Módulos dentro de GEDs corporativos genéricos (**Software Neutron**, **MegaGED**) — sem preço público, vendidos por "fale conosco" para médio/grande porte, sem multi-canal/templates/import em massa/trilha de auditoria confirmados.

**Gap real**: ninguém ataca o meio-termo (freelancer/MEI/PME, self-serve, preço público, multi-canal com WhatsApp/Telegram) — exatamente nosso posicionamento nos tiers Essencial/Profissional.

### 2.2 Brasil — compliance documental de fornecedores (8 concorrentes relevantes)

Todos são **enterprise puro, venda consultiva, sem preço público**, mirando empresas com centenas/milhares de fornecedores:

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

**Nenhum concorrente combina**: guest-upload sem conta + IA/OCR com verificação humana obrigatória + status por requisito/fornecedor + preço público acessível. **Essa combinação é o espaço em branco mais claro do mercado para nós.**

### 2.4 Global — trackers de expiração e CLM para PME (13 concorrentes)

- **Expiration Reminder** e **Remindax** são os gêmeos funcionais mais próximos do OmniVence — WhatsApp, IA/OCR de datas, importação em massa. Remindax: US$18-23/mês (dentro da nossa faixa-alvo). Expiration Reminder: US$49-399/mês (acima).
- **Achado crucial para D-345 (multi-org gated por plano)**: a **Remindax já vende "número de empresas" como diferenciador de tier** — 1 empresa no Basic (US$23-29/mês), **Professional já inclui 2 empresas**, 3 no Business (US$119-149/mês), mais no Premium (US$239-299/mês) — **preços corrigidos após a Rodada 1 do protocolo (ver seção 6); a versão original deste relatório tinha os números errados**. A Remindax também permite comprar empresas extras avulsas sem subir de tier (nuance que a proposta original da seção 4.3 tinha omitido). Ainda assim, o precedente de "número de organizações como alavanca de preço" se confirma.
- **VendorJot** (nicho B2B fornecedores): melhor exemplo de guest upload sem conta (link mágico) — valida a feature.
- Ferramentas de CLM (**ContractSafe**, **Contractbook**, **Concord**, **Gatekeeper**) custam **muito acima** da nossa faixa: US$450-1.245/mês.
- Enterprise (**Ironclad**, **Agiloft**): US$30 mil–600 mil+/ano — serve só de contraste de mensagem.
- **"Score de compliance" (nota calculada, não só dashboard de status) não foi confirmado em NENHUM dos 37 concorrentes pesquisados** — candidato a diferencial real, mas recomendo uma checagem adicional antes de afirmar publicamente "somos os únicos".

---

## 3. Tabela mestra — onde estamos vs. o mercado

Cobertura de feature do OmniVence hoje (do que já vimos implementado nesta e em sessões anteriores) vs. o que os concorrentes oferecem:

| Feature | OmniVence hoje | Quantos concorrentes (de 37) confirmam ter |
|---|---|---|
| Lembrete por e-mail | ✅ | Maioria |
| Lembrete por WhatsApp | ✅ (M4, gated por E-019 jurídico) | Só 3: Expiration Reminder, Remindax, suaCND(?) — raro |
| Lembrete por Telegram | ✅ | 0 confirmados — **diferencial real** |
| Templates de requisito reutilizáveis | ✅ (Requirement Templates, roadmap item 1) | Poucos (Rapid Global, Contractbook, Linkana parcial) |
| Importação em massa (CSV) | ✅ (Items; Requirements ainda não) | ~8 de 37 |
| Guest upload sem conta | ✅ (A14, já implementado) | Raro — só VendorJot (magic link) faz bem; TrustLayer reivindica mas sem prova |
| Extração IA/OCR + verificação humana obrigatória | ✅ (fail-closed por design, `AI Architecture`) | ~6 confirmam IA/OCR, **nenhum confirma "verificação humana obrigatória" como princípio de design** — diferencial real de confiabilidade |
| Busca full-text | 🔴 backlog P1 (D-202, bloqueado) | Só 2 (ContractSafe, Contractbook) — não é prioridade tão alta quanto pensávamos, poucos concorrentes têm |
| Dashboard de compliance/risco | ✅ | Maioria dos players B2B |
| Relatórios + trilha de auditoria | ✅ (parcial — export ainda backlog P1) | Maioria |
| Tipos de documento configuráveis | ✅ | Vários |
| Ações em massa | ✅ (roadmap §18.3, já entregue) | Poucos confirmam |
| Compartilhamento externo seguro (link temporário) | ✅ (`ExternalShareLink`, roadmap §18.3, já entregue) | VendorJot (magic link), parcialmente ContractSafe/Contract Hound |
| Assinatura eletrônica | 🔴 backlog P2 | ~6 de 37, mas como add-on pago ou via DocuSign — poucos nativos |
| API pública/webhooks | 🔴 backlog P2 | ~8 de 37, muitos via Zapier só |
| Integração com calendário | 🔴 backlog P2 | Remindax e Expiration Reminder (Outlook) confirmados — menos raro do que a 1ª versão deste relatório concluiu |
| Score de compliance (nota calculada) | 🔴 backlog P2 (roadmap §18.4, já é item existente — corrigido, não é novidade desta pesquisa) | Linkana confirma ter (0-100, pesos por documento) — **não é uma ausência de mercado, corrigido após crítica do Codex** |
| Portal completo do fornecedor/cliente | Parcial (guest upload existe, portal completo não) | Vários (Avetta, ISNetworld, Wehandle, VendorJot) — mas todos enterprise |
| SSO/SCIM/enterprise | 🔴 backlog Futuro | Só nos tiers Enterprise dos concorrentes maiores |
| **Multi-organização por dono, gated por plano** | ✅ **decidido (D-345)**, não implementado | **Remindax é o único precedente claro** (1→1→2→3 empresas por tier) |

**Conclusão (corrigida após Rodada 1 do protocolo — ver seção 5)**: já cobrimos a maior parte do que os concorrentes oferecem, incluindo itens que a primeira versão deste relatório havia marcado incorretamente como pendentes (ações em massa, compartilhamento externo seguro — já entregues, roadmap §18.3). Telegram como canal continua um diferencial real (nenhum concorrente pesquisado o oferece). **Verificação humana obrigatória e score de compliance NÃO são diferenciais exclusivos** como a primeira versão afirmou — Linkana já tem score calculado (0-100, pesos por documento) e myCOI já usa humano-no-loop; a alegação de exclusividade foi retirada. Full-text search e e-signature seguem com baixa contagem de concorrentes, mas o Codex apontou corretamente que baixa contagem não prova baixo risco de negócio — tratar como hipótese a validar, não como fato estabelecido.

---

## 4. Checklist de critérios de nota (E-014) — introduzido na Rodada 2

**Declaração de pesquisa externa (protocolo E-014, `docs/engineering/research-protocol.md`): SIM.** Pricing/posicionamento de SaaS B2B é um padrão que outras empresas já resolveram extensivamente; a amostra (37 concorrentes, 4 segmentos: Brasil pessoal/PME, Brasil B2B fornecedores, global B2B fornecedores, global trackers/CLM) cobre desde apps pessoais até enterprise, reduzindo viés de nicho único — representatividade justificada, não só listada.

**Correção de processo registrada explicitamente (exigida pelo protocolo quando o Codex contesta a régua)**: a Rodada 1 foi submetida **sem** este checklist — o Codex apontou isso corretamente (nota da régua 2,0/10) e a proposta foi avaliada por impressão geral em vez de critérios explícitos. Este checklist nasce agora, na Rodada 2, e — por ainda não ter sido validado pelo Codex — a nota desta rodada continua sendo reportada em duas partes separadas (nota da régua + nota do design), nunca uma nota única, até a régua atingir ≥9,0 dos dois lados.

| # | Critério | Peso | Atende | Não atende |
|---|---|---|---|---|
| 1 | **Verificabilidade** — toda alegação de preço/feature cita fonte real + data de acesso | 25% | Cada afirmação numérica tem URL+data rastreável (seção 6) | Alegação sem fonte, ou fonte que não sustenta o número citado |
| 2 | **Sem inferência de ausência indevida** — "poucos concorrentes confirmam X" nunca vira "baixo risco de não ter X" sem justificativa adicional além da contagem | 20% | Toda recomendação de re-priorização cita um motivo além de "concorrentes não têm" (ex. custo de implementação, demanda de cliente já observada) | Recomendação apoiada só na contagem de concorrentes |
| 3 | **Consistência interna** — toda alegação sobre o que o OmniVence "já tem"/"não tem" é conferida contra `roadmap-competitivo-2026-09-01.md`/`decisions-log.md` antes de publicar | 20% | Estado do produto citado bate com a fonte interna real | Estado presumido ou desatualizado (como ocorreu na Rodada 1) |
| 4 | **Especificidade acionável do gating de multi-org** — a proposta define quem paga, se cotas (storage/IA/WhatsApp) são por-organização ou compartilhadas, e o comportamento de downgrade — não só o número de orgs por tier | 15% | Os 3 pontos (pagamento/cota/downgrade) estão explicitados e tecnicamente ancorados no modelo real (`TenantEntitlement`, `Membership.status`) | Só o número de orgs por tier, sem mecânica |
| 5 | **Câmbio e periodicidade normalizados** — toda comparação de preço declara taxa de câmbio + data, e mensal vs. anual é normalizado antes de comparar | 10% | Conversão explícita, mesma base de período em toda a tabela comparativa | Valores de moedas/períodos distintos comparados diretamente |
| 6 | **Reconciliação com princípios já registrados do projeto** — nenhuma recomendação contradiz uma decisão/princípio já existente (ex. roadmap §13) sem reconhecer e resolver a tensão explicitamente | 10% | Tensão nomeada e resolvida com justificativa | Tensão ignorada ou não mencionada |

---

## 5. Proposta de posicionamento e preço (Rodada 2, revisada)

> Isto é uma PROPOSTA para revisão — não uma decisão. Marcelo decide. **Revisada após a crítica da Rodada 1 (seção 7) — ver o que mudou em cada subseção.**

### 5.1 Pitch de posicionamento

*"A alternativa moderna e acessível ao mundo Avetta/ISNetworld, sem a estreiteza de escopo do mundo myCOI/TrustLayer/Certificial — pensado para PME, não para indivíduo isolado ou para grande corporação."*

**Mudança desde a Rodada 1**: removida a afirmação "o primeiro controle de vencimentos brasileiro pensado para PME" — não demonstrada pela pesquisa (achado real do Codex), só o gap de mercado foi demonstrado, não a alegação de "primeiro". O pitch de "alternativa a Avetta/ISNetworld" é mantido como hipótese de mensagem, com a ressalva explícita de que cria expectativa de profundidade funcional (score/IA/integrações ERP) que o OmniVence ainda não tem no nível desses dois concorrentes — comunicar o escopo real, não prometer paridade de profundidade.

### 5.2 Preço — tratado como hipótese a testar, não como validado

**Mudança desde a Rodada 1**: a versão anterior tratava a faixa atual (Free/R$0, Essencial/R$59,90, Profissional/R$99,90, Premium/R$149,90) como "bem posicionada" e recomendava não mudar. O Codex apontou corretamente: **ser mais barato que concorrentes enterprise não prova que MEIs pagariam R$59,90, nem que o preço sustenta o custo real de servir um cliente B2B** (OCR/IA, WhatsApp, storage, suporte). Correção: a faixa segue como ponto de partida razoável (nenhum concorrente pesquisado ataca esse meio-termo de preço para o mesmo escopo), mas **precisa de validação real antes de ser tratada como decidida** — ex. teste de disposição a pagar com uma lista de espera/early-access, ou entrevistas com 5-10 potenciais clientes PME sobre a faixa de preço antes do lançamento comercial. Isto não é uma decisão de produto desta pesquisa — é a recomendação de que a decisão de preço final não se apoie só nesta pesquisa de concorrência.

### 5.3 Gating de multi-organização (D-345) — mecânica concreta

**Mudança desde a Rodada 1**: a versão anterior só listava números de orgs por tier, sem mecânica. Corrigido, ancorado no modelo real do produto (`docs/architecture/data-model.md`, `TenantEntitlement` por organização, `Membership.status`):

| Plano | Orgs incluídas | Org extra avulsa | Quem paga | Cotas (storage/IA/WhatsApp) |
|---|---|---|---|---|
| Free | 1 | Não disponível | — | Por organização (já é o modelo hoje, `TenantEntitlement`) |
| Essencial | 1 | Não disponível | — | Por organização |
| Profissional | até 2 | Sim, preço avulso a definir (precedente: Remindax vende empresa extra sem subir de tier) | Cobrança consolidada na conta do `OWNER` que criou a 1ª organização — nunca split entre organizações | Por organização, sem compartilhamento entre as orgs do mesmo dono |
| Premium | até 5 | Sim, preço avulso a definir | Idem | Por organização |

**Downgrade** (cenário não coberto na Rodada 1): se um `OWNER` com N organizações faz downgrade para um plano que permite menos, as organizações excedentes (as mais recentes primeiro, por `createdAt`) entram em estado análogo a `SUSPENDED` — mesmo mecanismo que já existe para `Membership.status` (nunca exclusão automática de dados). Reativa com um novo upgrade ou transferência de ownership para outro usuário. Isto é uma proposta técnica a validar tecnicamente antes de implementar, não uma decisão de produto desta pesquisa.

**Reconciliação com roadmap §13** ("evitar depender principalmente da quantidade de empresas [tenants] para limites, preferir custo real: storage+IA+WhatsApp+usuários"): **§13 trata de um eixo diferente — quantos fornecedores/itens uma ÚNICA organização pode rastrear** (esse eixo continua generoso, sem gating por contagem). O gating desta proposta é sobre **quantas organizações separadas (tenants) um dono pode possuir** — um eixo ortogonal, não uma contradição. Registrado aqui explicitamente porque o Codex apontou a ausência dessa reconciliação como pendência real na Rodada 1.

### 5.4 Recomendações de roadmap — reformuladas como hipóteses, não conclusões

**Mudança desde a Rodada 1**: a versão anterior recomendava "descer prioridade" de full-text/calendário só pela baixa contagem de concorrentes — o Codex apontou que isso é uma inferência de ausência logicamente frágil (contagem de concorrentes mede o que eles divulgam publicamente, não o que clientes exigem). Correção — nenhuma recomendação de re-priorização nesta rodada, só dados registrados para pesar junto de outros critérios (custo de implementação, pedidos reais de cliente) que esta pesquisa não cobre:

1. **P0 atual**: sem mudança recomendada — já cobre os itens mais comuns entre concorrentes (templates, bulk import, IA/OCR, dashboard, relatórios). Isto não prova que os fluxos estão completos ou suficientes, só que a lista de features está alinhada.
2. **Full-text search (D-202, P1 bloqueado)**: dado registrado — só 2 de 37 concorrentes confirmam ter. Não é recomendação de descer prioridade; é um dado a mais para a decisão de caminho que já está pendente com Marcelo em D-202.
3. **Integração de calendário (P2)**: dado registrado — Remindax e Expiration Reminder confirmam ter (2 de 37, não só 1 como a versão anterior afirmou). Já está em P2, sem mudança de tier recomendada.
4. **Score de compliance (já é item P2 existente, roadmap §18.4)**: dado registrado — Linkana já tem um score calculado (0-100, pesos por documento, dispensas, revisão pendente). Implementar um score raso (média simples que esconde uma pendência crítica atrás de uma nota favorável) seria pior que não ter — qualquer implementação futura precisa tratar criticidade/documentos faltantes/dispensas explicitamente, não só "média de status", achado real do Codex.
5. **Telegram como canal**: dado registrado — 0 de 37 concorrentes confirmam ter. Vale comunicar como diferencial, mas demanda real de cliente por esse canal específico não foi medida por esta pesquisa.

---

## 6. Fontes consultadas (reprodutibilidade) + normalização de câmbio

**Taxa de câmbio de referência usada nesta seção e nas comparações acima: USD 1 = R$ 5,30, EUR 1 = R$ 5,70 (cotação aproximada de 2026-09-27, só para ordem de grandeza — nunca usar para decisão final de preço sem checar a taxa do dia)**. Preços mensais convertidos; onde o concorrente só publica anual, convertido para mensal primeiro (÷12) antes de comparar.

| Concorrente | URL | Preço citado (original) | Preço citado (BRL/mês, referência) | Método | Data |
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
| Remindax | remindax.com/pricing | US$23-299/mês (Basic-Premium) | R$122-1.585 | Fetch direto (corrigido na Rodada 1) | 2026-09-27 |
| RenewAlert | renewalert.net | US$14,99-49,99/mês | R$79-265 | Fetch direto | 2026-09-27 |
| VendorJot | vendorjot.com | US$0-49/mês | R$0-260 | Fetch direto | 2026-09-27 |
| ContractSafe | contractsafe.com/features | US$450-815/mês | R$2.385-4.320 | Fetch direto (busca p/ preço) | 2026-09-27 |
| Contractbook | contractbook.com | €399-599/mês | ~R$2.274-3.415 | Busca agregada | 2026-09-27 |
| Concord | concord.app | US$499-899/mês + assento | R$2.645-4.765+ | Busca agregada | 2026-09-27 |
| Contract Hound | contracthound.com | US$95/mês | R$504 | Fetch direto | 2026-09-27 |
| PandaDoc | pandadoc.com | US$19-49/usuário/mês | R$101-260/usuário | Busca agregada | 2026-09-27 |
| Ironclad | ironclad.com | Fale conosco (estimativa US$30k-600k/ano) | — | Busca agregada | 2026-09-27 |
| Agiloft | agiloft.com | Fale conosco (estimativa ~US$68k/ano médio) | — | Busca agregada (Vendr) | 2026-09-27 |
| Gatekeeper | gatekeeperhq.com | US$1.245/mês | R$6.599 | Busca agregada | 2026-09-27 |
| TrackSSL | trackssl.com | US$0-72/mês | R$0-382 | Busca agregada | 2026-09-27 |

**Nota sobre "fetch direto" vs. "busca agregada"**: fetch direto = página oficial do concorrente foi lida diretamente pelo agente de pesquisa nesta sessão. Busca agregada = dado vem de agregador terceiro (Capterra/G2/Vendr/GetApp/blog de mercado) porque a página oficial não publicava preço ou o fetch direto não foi possível — marcado explicitamente em cada caso, nunca apresentado com a mesma confiança de um dado de fonte primária.

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

**Achados metodológicos corrigidos na Rodada 2** (ver seções 4/5/6 acima): lista reprodutível de fontes com URL/data ✅ (seção 6); câmbio normalizado com taxa/data declaradas ✅ (seção 6); inferência de ausência indevida removida das recomendações de roadmap ✅ (seção 5.4, viraram "dados registrados", não conclusões); §13 do roadmap reconciliado explicitamente com o gating de multi-org ✅ (seção 5.3).

**Status**: Rodada 1 completa, não convergida (mínimo 2 rodadas consecutivas ≥9,0 nas duas notas, cegas, exigido pelo protocolo). Rodada 2 (seções 4-6 acima) responde a cada achado da Rodada 1 — aguardando nova crítica do Codex (seção 8).

---

## 8. Revisão Claude↔Codex — Rodada 2 (pendente)

Aguardando resposta do Codex à proposta revisada (seções 4-6). Nota da régua e nota do design a preencher aqui após a rodada, seguidas do mesmo formato de "achados corrigidos"/"achados em aberto" da seção 7 — nunca uma nota única enquanto a régua da seção 4 não atingir ≥9,0 dos dois lados.

---

## 9. Limitações desta pesquisa

- Pesquisa feita via busca web + fetch de páginas públicas, não testes reais de produto (trial/demo) — features marcadas "não encontrado no site" podem existir e não estarem documentadas publicamente.
- Preços de concorrentes "fale conosco" foram, quando possível, estimados por fontes de terceiros (marcado explicitamente como "busca agregada" na seção 6) — não são números oficiais.
- A taxa de câmbio da seção 6 é uma referência de ordem de grandeza, não a cotação exata do dia da decisão final de preço.
- Não cobre concorrentes que só existem via marketplaces de nicho não indexados em busca geral (possível lacuna, mas baixo risco dado o volume já coberto — 37 concorrentes reais).
