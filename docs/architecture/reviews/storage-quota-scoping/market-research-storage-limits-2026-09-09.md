# Pesquisa de mercado — limites de storage por plano (concorrentes diretos e adjacentes)

**Contexto**: D-249 implementou o mecanismo técnico de cota de storage por tenant (contador
`usedBytes`/`reservedBytes`, enforcement fail-closed, rota de leitura), mas deixou o **número
exato do default** como pendência de decisão de produto (Marcelo usou "5GB" como exemplo
ilustrativo, não firme). Esta pesquisa foi conduzida a pedido dele (2026-09-09) para basear essa
decisão em prática real de mercado, e não em um número arbitrário. Nenhuma decisão foi fechada
aqui — este documento é insumo, não uma linha nova do decisions-log.

**Método**: busca web direta (não protocolo Claude↔Codex — pesquisa factual, não decisão de
design), 8 buscas ao todo, cobrindo (1) nicho direto — rastreamento genérico de vencimento de
documentos/licenças/certificações —, (2) nicho adjacente — compliance/homologação de fornecedores
(COI tracking) —, (3) categorias não comparáveis usadas só como contraste (storage genérico tipo
Google Workspace/Dropbox), e (4) o mercado brasileiro especificamente, nos dois nichos acima.

## 1. Nicho direto — rastreamento de vencimento/renovação (EUA)

O grupo mais parecido estruturalmente com este produto: alertas de vencimento + storage de
documento anexado por item rastreado.

| Produto | Plano de entrada | Storage (entrada) | Plano intermediário | Storage | Plano maior | Storage |
|---|---|---|---|---|---|---|
| **Remindax** | $29/mês (200 itens, 4 usuários) | **1 GB** | — | — | — | — |
| **Expiration Reminder** | $49/mês (250 registros, 10 admins) | **1 GB** | $149/mês (1.000 registros) | **10 GB** | $499/mês (3.000 registros) | **50 GB** |
| **ExpiryEdge** | Starter | **100 MB** | Standard | **5 GB** | — | — |

**Padrão**: storage escala linearmente com o volume de itens/plano pago. Entrada fica entre
100MB-1GB; portanto **5GB já corresponde a um plano intermediário/pago** nesses 3 concorrentes
diretos, não a um plano de entrada.

## 2. Nicho adjacente — compliance/homologação de fornecedores (COI tracking, EUA)

Categoria mais próxima do modelo de dados real deste produto (Subject/Requirement/Document, não
só um lembrete simples), mas cobra por sujeito rastreado, não por byte.

| Produto | Cobrança | Storage |
|---|---|---|
| **CertFocus** | $6-19/vendor/ano | **Ilimitado** |
| **bcs** (COI tracking) | $0,95/vendor/mês (self-service) a $17,80/vendor/ano (full-service) | **Ilimitado, sem limite algum** |

**Achado que já estava no projeto**: confirma o achado prévio de `roadmap-evolution/02-market-
research.md` — billing por sujeito rastreado é o padrão dominante nesse nicho, não por
armazenamento. Documentos de compliance (PDFs de certificado/licença) são pequenos o bastante para
que storage nunca vire gargalo de custo real — por isso os concorrentes tratam como não-diferencial
e oferecem ilimitado.

## 3. Contraste — storage genérico, não comparável diretamente

Usado só para calibrar escala, não como benchmark direto (caso de uso é arquivo/mídia geral, não
documento de compliance pequeno):

| Produto | Plano | Storage |
|---|---|---|
| Google Workspace | Business Standard ($14/user/mês) → Business Plus ($22/user/mês) | 2TB → 5TB (pool) |
| Dropbox Business | Standard ($15/user/mês) → Advanced ($20/user/mês) | 5TB → ilimitado |
| Document management genérico (CPA/legal) | Entrada → Enterprise | 250GB → ilimitado |

## 4. Mercado brasileiro

Nenhum concorrente brasileiro pesquisado publica um número de GB por plano — sinal de que o
mercado nacional nem usa isso como argumento comercial.

| Produto | Nicho | Modelo de storage |
|---|---|---|
| **Econsulte** (controle de alvarás/licenças/certidões) | Idêntico ao nosso | **Ilimitado, vendido explicitamente como diferencial** ("armazene quantos arquivos quiser, sem custo adicional") |
| **SoftExpert** (GED/compliance corporativo) | Adjacente, porte maior | Preço sob consulta; planos por funcionalidade/módulo, sem GB publicado |
| **Valide** (homologação de fornecedores) | Adjacente | "Fale conosco", sem storage nem preço público |
| **Sertras, Bernhoeft, Netrin** (homologação de fornecedores) | Adjacente | Mesmo padrão — storage nunca é eixo comercial |
| CertiSeguro / Presto (Oystr) — certificado digital contábil | Adjacente | R$80-300/mês por carteira de 50-150 certificados — cobrança por volume de certificados, não por GB |

## 5. Síntese e recomendação (não decidida — insumo para decisão de Marcelo)

- Nos concorrentes **mais parecidos estruturalmente** (rastreamento genérico, grupo 1), storage é
  um número pequeno e explícito: 100MB-1GB na entrada, 5-50GB em planos pagos superiores.
- Nos concorrentes **mais parecidos no modelo de dados/proposta de valor** (compliance de
  fornecedor por Subject, grupo 2 + Brasil), storage é tratado como **não-diferencial e
  frequentemente ilimitado** — o valor cobrado está no volume de sujeitos/fornecedores/certidões
  rastreados, nunca em bytes.
- Este produto está posicionado mais perto do grupo 2 (Subject/Requirement/Document, não um
  lembrete simples de vencimento) — isso sugere que a prática de mercado mais alinhada é **não
  expor o storage como preocupação visível do cliente**, mantendo a cota (D-249) como proteção
  técnica interna com um número folgado (a faixa "plano padrão" observada nos concorrentes diretos
  — 5GB — está bem posicionada: nem apertada como planos de entrada do grupo 1, nem exagerada).
- Decisão explicitamente NÃO fechada aqui: (a) o número exato do default de `TenantStorageQuota`
  (D-249 já implementou como configurável, não hardcoded); (b) se a tela de uso de storage (A03/
  A19 no `docs/frontend/p0-screen-inventory-plan.md`) deve ter destaque visual proporcional a uma
  "preocupação real" ou ser deliberadamente discreta, dado que o mercado (inclusive nacional)
  trata isso como não-problema.

## Fontes

- [Top 7 Certification Expiration Tracking Software for 2026](https://blog.remindax.com/top-certification-expiration-tracking-software/)
- [Remindax Pricing Plans](https://www.remindax.com/pricing)
- [Expiration Reminder Pricing 2026 | Capterra](https://www.capterra.com/p/172196/Expiration-Reminder/pricing/)
- [Expiration Reminder Pricing (2026): Plans, Costs & Cheaper Alternatives | Remindax](https://www.remindax.com/compare/expiration-reminder-pricing)
- [ExpiryEdge pricing expiry reminder plans and costs](https://expiryedge.com/pricing/)
- [We Compared 7 Best COI Tracking Software For 2026](https://www.certificial.com/blog-post/we-compared-7-best-coi-tracking-software-in-depth-feedback-and-review)
- [COI Tracking Software Pricing & Plans | bcs](https://www.getbcs.com/pricing-and-plans)
- [How Much Does COI Tracking Software Cost? (2026)](https://www.vertikalrms.com/article/how-much-does-coi-tracking-software-cost-2026-pricing-guide/)
- [Google Workspace Pricing (2026)](https://www.emailvendorselection.com/google-workspace-pricing/)
- [Dropbox Storage Prices in 2026: Plans & Costs Compared](https://blog.internxt.com/dropbox-pricing/)
- [Document Management Software Pricing Guide for CPA Firms (2026)](https://unclekam.com/tax-pro-tools/document-management/document-management-software-pricing/)
- [Sistema de Controle de Alvarás e Licenças · Econsulte](https://econsulte.com/sistema-controle-alvaras-licencas)
- [Software para gestão de renovação de certificados e documentos regulatórios - v30](https://v30.com.br/blog/software-para-gestao-de-renovacao-de-certificados-e-documentos-regulatorios-como-automatizar-vencimentos-e-evitar-riscos-operacionais)
- [Gestão de Certificados Digitais na Contabilidade: Presto, ByToken, CertiSeguro e Dootax comparados](https://altcom.com.br/certificados-digitais-contabilidade-gestao-vencimentos/)
- [Módulo Homologação de Fornecedores - Valide](https://validesolucoes.com.br/modulo-homologacao-de-fornecedores/)
- [Destrave o potencial da sua empresa | SoftExpert Software](https://www.softexpert.com/pt-BR/precos/)
