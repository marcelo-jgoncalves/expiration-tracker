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
- **Achado crucial para D-345 (multi-org gated por plano)**: a **Remindax já vende "número de empresas" como diferenciador de tier** — 1 empresa nos planos baratos, 2 no Business (US$95-119/mês), 3 no Premium (US$191-239/mês), customizado acima. **Precedente real de mercado exatamente do modelo que decidimos adotar.**
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
| Ações em massa | 🔴 não implementado | Poucos confirmam |
| Compartilhamento externo seguro (link temporário) | 🔴 backlog P1 | Só VendorJot (magic link) e parcialmente ContractSafe/Contract Hound |
| Assinatura eletrônica | 🔴 backlog P2 | ~6 de 37, mas como add-on pago ou via DocuSign — poucos nativos |
| API pública/webhooks | 🔴 backlog P2 | ~8 de 37, muitos via Zapier só |
| Integração com calendário | 🔴 backlog P2 | Só Remindax confirmado — **raro em geral, talvez não seja prioridade alta** |
| Score de compliance (nota calculada) | 🔴 não implementado | **0 de 37 confirmados** — diferencial real se implementarmos |
| Portal completo do fornecedor/cliente | Parcial (guest upload existe, portal completo não) | Vários (Avetta, ISNetworld, Wehandle, VendorJot) — mas todos enterprise |
| SSO/SCIM/enterprise | 🔴 backlog Futuro | Só nos tiers Enterprise dos concorrentes maiores |
| **Multi-organização por dono, gated por plano** | ✅ **decidido (D-345)**, não implementado | **Remindax é o único precedente claro** (1→1→2→3 empresas por tier) |

**Conclusão**: já cobrimos a maior parte do que os concorrentes oferecem, e temos 3 diferenciais que aparecem em pouquíssimos ou nenhum concorrente: **Telegram como canal**, **verificação humana obrigatória como princípio de design** (não só "temos IA"), e **score de compliance calculado** (se implementado). Full-text search, e-signature, API pública e integração de calendário são menos urgentes do que o roadmap atual sugere, já que poucos concorrentes os têm — vale revalidar a prioridade P1/P2 desses itens à luz disso.

---

## 4. Proposta de posicionamento e preço (Rodada 1 do protocolo Claude↔Codex)

> Isto é uma PROPOSTA para revisão — não uma decisão. Marcelo decide.

### 4.1 Pitch de posicionamento

*"A alternativa moderna e acessível ao mundo Avetta/ISNetworld, sem a estreiteza de escopo do mundo myCOI/TrustLayer/Certificial — e o primeiro controle de vencimentos brasileiro pensado para PME, não para indivíduo isolado ou para grande corporação."*

### 4.2 Reconciliação com o rascunho de preço existente (roadmap §12)

O rascunho atual (Free/R$0, Essencial/R$59,90, Profissional/R$99,90, Premium/R$149,90) já está **bem posicionado** frente ao mercado pesquisado — abaixo até da Remindax nos tiers pagos intermediários quando convertido (R$99,90 ≈ US$18-19, no patamar do tier mais barato da Remindax) e muitíssimo abaixo de qualquer CLM (US$450+/mês) ou plataforma de compliance de fornecedores enterprise. Nenhuma mudança de faixa de preço é recomendada nesta rodada — o gap não é preço, é feature-differentiation e clareza de posicionamento.

### 4.3 Gating de multi-organização (D-345) — proposta concreta

Seguindo o precedente real da Remindax (único concorrente com esse modelo documentado):

| Plano | Orgs por dono |
|---|---|
| Free | 1 |
| Essencial | 1 |
| Profissional | até 2 |
| Premium | até 5 (ou ilimitado — a definir) |

### 4.4 Recomendações de roadmap (não vinculantes, para revisão)

1. **Subir prioridade**: nenhuma mudança óbvia — o roadmap P0 atual já cobre os itens que mais aparecem nos concorrentes (templates, bulk import, IA/OCR, dashboard, relatórios).
2. **Reconsiderar prioridade de busca full-text (D-202, hoje P1 bloqueado)**: só 2 de 37 concorrentes confirmam ter — pode descer de prioridade sem risco competitivo real.
3. **Reconsiderar prioridade de integração de calendário (hoje P2)**: só 1 de 37 confirma — baixo risco de ficar para trás não tendo isso cedo.
4. **Considerar subir prioridade de "score de compliance calculado"**: não é mencionado no roadmap atual como item numerado, mas 0 de 37 concorrentes o têm — diferencial de marketing forte e potencialmente barato de implementar (já temos os status por requisito, "só" falta a fórmula/apresentação).
5. **Reforçar Telegram e "verificação humana obrigatória" na comunicação de marketing** — ambos já implementados, nenhum concorrente pesquisado os oferece/comunica da mesma forma.

---

## 5. Limitações desta pesquisa

- Pesquisa feita via busca web + fetch de páginas públicas, não testes reais de produto (trial/demo) — features marcadas "não encontrado no site" podem existir e não estarem documentadas publicamente.
- Preços de concorrentes "fale conosco" foram, quando possível, estimados por fontes de terceiros (marcado explicitamente como tal) — não são números oficiais.
- Câmbio USD→BRL não aplicado nas comparações acima (valores em USD/EUR mantidos como encontrados) — considerar ao decidir preço final.
- Não cobre concorrentes que só existem via marketplaces de nicho não indexados em busca geral (possível lacuna, mas baixo risco dado o volume já coberto — 37 concorrentes reais).
