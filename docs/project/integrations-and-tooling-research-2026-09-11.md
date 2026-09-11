# Integrações e ferramentas para execução do projeto — pesquisa 2026-09-11

> Pesquisa exploratória (não normativa, não uma decisão de arquitetura) pedida por Marcelo: quais
> integrações/ferramentas podem ajudar qualquer etapa de execução do projeto — não só
> desenvolvimento, também marketing, vendas, suporte e operação. Contexto: micro-SaaS B2B de
> compliance de fornecedor/vencimento de documentos, fundador solo (Marcelo) trabalhando com agentes
> de IA, foco Brasil, sem usuários reais ainda, billing (D-052) bloqueado por decisão de fornecedor.

## 1. Billing/pagamentos (Brasil) — item mais concreto, destrava D-052 diretamente

- **Pix Automático** (Banco Central, lançado jan/2026) — débito recorrente direto na conta do
  cliente via Pix, taxa de 0,22–0,35%, bem mais barato que cobrança recorrente via cartão
  (2,99–4,99%). Opção mais nova e barata; checar maturidade do suporte dos gateways antes de
  apostar tudo nela, já que tem menos de 1 ano de existência.
- **Asaas** — conta PJ + gateway de pagamento brasileiro, sem mensalidade, transações ilimitadas no
  plano grátis: Pix 0,99%, boleto R$1,99–3,49, cartão 2,99–4,99%, emite nota fiscal automaticamente
  a cada renovação. Melhor encaixe para fundador solo bootstrapped — menor custo fixo, suporte
  completo a assinatura/dunning, suporte em português.
- **Iugu** — especialista em automação de assinatura, API mais simples que a da Stripe, boleto
  recorrente forte + Pix + vencimento fixo, melhor suporte em PT que a Stripe. Boa opção
  intermediária se a profundidade de recursos do Asaas não for suficiente.
- **Vindi** — brasileira, conjunto de recursos de billing recorrente mais maduro (dunning/
  recuperação, integração bancária), porém mais cara — encaixa melhor quando já houver MRR real
  para justificar, não pré-lançamento.
- **Stripe (Brasil)** — suporte a Pix existe mas é *invite-only* para merchants brasileiros (no
  momento desta pesquisa), boleto suportado nativamente; mais forte se o produto algum dia vender
  internacionalmente também, encaixe mais fraco para um SaaS de compliance de fornecedor 100%
  Brasil hoje, dado o gate do Pix.
- **Automação de nota fiscal**: o Asaas emite NFS-e automaticamente junto com a cobrança (sem
  integração separada). Se outro gateway (não-Asaas) for escolhido, **NFE.io**, **Focus NFe** ou
  **Spedy** são APIs de NFS-e dedicadas, construídas exatamente para esse caso de uso de SaaS
  recorrente.
- **Recomendação para fundador solo, sem usuários reais ainda**: Asaas é o ponto de partida de
  menor fricção (zero mensalidade, Pix+boleto+cartão+NFS-e tudo junto, suporte em português) —
  Vindi/Iugu passam a valer o custo extra só quando houver volume real de assinantes que justifique
  o dunning/recuperação mais profundo deles.

## 2. Marketing/growth (pré-lançamento, fundador solo, barato)

- **Carrd** (US$19/ano) — landing page simples, radicalmente barata, suficiente para uma página de
  validação pré-lançamento.
- **Waitlister** (grátis, depois US$15/mês) — waitlist hospedada + programa de indicação + envio de
  email + webhooks/API, construído especificamente para fundadores solo/indie de SaaS.
- **Email**: **Kit** (grátis até 10k assinantes) para construir audiência antes do lançamento;
  **MailerLite** (grátis até 1k) ou **AWeber** (grátis até 500, melhor entregabilidade B2B) quando
  já enviando sequências reais. **Sequenzy** (US$19/mês, sequências geradas por IA) é específico
  para SaaS se escrever sequências à mão não for desejado.

## 3. CRM (vendas founder-led)

- **HubSpot CRM Free** — contatos ilimitados, tracking de negociação, formulários — ponto de
  partida padrão de custo zero.
- **Folk** — construído especificamente para times pequenos de SaaS B2B abaixo de ~US$500k ARR,
  baixo overhead administrativo, auto-enriquecimento de dados.
- **Pipedrive** (US$14/usuário/mês) quando já houver um pipeline real de múltiplas negociações
  (5–50 negociações ativas) para gerenciar visualmente.
- Recomendação: começar no HubSpot grátis; migrar para Folk ou Pipedrive só quando o volume de
  negociações tornar uma planilha/tier grátis genuinamente insuficiente.

## 4. WhatsApp → extensão de suporte

A API do WhatsApp Business já integra nativamente com **Freshdesk, Zendesk, Intercom, HubSpot**
(mensagens viram tickets na mesma inbox). Como este projeto já construiu o WhatsApp como canal de
*notificação* (D-197/ADR-0012), a extensão natural é rotear *respostas* do cliente para um desses
helpdesks em vez de construir uma inbox de suporte do zero — o tier grátis/barato do Freshdesk é o
mais adequado a um fundador solo entre os três. Restrição real de plataforma a considerar no design:
janela de 24h do WhatsApp (sem mensagem livre iniciada pela empresa depois de 24h de silêncio do
cliente).

## 5. Integrações Claude/Anthropic

- **Connector Directory da própria Anthropic** (nativo, MCP, um clique) já lista Slack, Notion,
  Stripe, HubSpot, Salesforce, Jira, Google Drive, Figma, Canva — real, primeira parte, sem
  necessidade de confiar em terceiro. Utilizável hoje diretamente se Marcelo quiser o Claude lendo/
  escrevendo qualquer um desses de dentro de uma sessão.
- **Composio** (gateway MCP terceirizado, 1000+ apps, tier grátis 100k chamadas/mês, US$29/mês
  pago) — cobertura mais ampla incluindo WhatsApp, Pipedrive, HubSpot, Close, Attio — vale a pena só
  para o que ainda não estiver no directory nativo da Anthropic.
- **Assistente de IA conversacional dentro do próprio produto**, construído diretamente sobre a API
  do Claude (não MCP — isto é uma feature de produto, não uma integração do Claude Code): pesquisa
  de mercado confirma que "assistente de IA de compliance" é uma tendência real de diferenciação em
  2026 entre SaaS de compliance/GRC. Este projeto já tem extração/OCR de documento construída —
  vale confirmar no código se esse pipeline já usa LLM ou é um serviço de OCR não-LLM, já que de
  qualquer forma existe uma extensão natural: um assistente conversacional tipo "quais fornecedores
  vencem em breve / explique este documento sinalizado" usando a API do Claude seria uma feature de
  produto genuína e validada por mercado, não só ferramenta interna. **Movido para o backlog P2 —
  ver `NEXT_SESSION_PROMPT.md`.**

## 6. Ferramentas/recursos GRATUITOS do Claude/Anthropic (aprofundamento, 2026-09-11)

- **Claude for Startups Program** (`claude.com/programs/startups`) — **até US$25.000 em créditos
  gratuitos de API** + rate limits prioritários. Elegibilidade: empresa fundada nos últimos 4 anos,
  nunca ter recebido crédito de startup da Anthropic antes, **financiamento de VC não é exigido**.
  Ressalvas reais: só API/Console de primeira parte (não via AWS Bedrock — irrelevante aqui, já que
  o projeto já usa acesso de API de primeira parte), créditos expiram 12 meses após a concessão, não
  renovável. **Achado mais concreto e acionável desta pesquisa** — o projeto se encaixa no perfil
  (pré-lançamento, fundado recentemente, sem crédito prévio). Ação depende de Marcelo (cadastro/
  aplicação com dados da empresa) — ver pendência em `NEXT_SESSION_PROMPT.md`.
- **Skills de projeto** (`.claude/skills/`, `SKILL.md` + scripts auxiliares) — já usamos skills
  prontas (code-review, security-review, etc.); Marcelo poderia autorar uma skill específica deste
  projeto (ex. "rodar o gate local completo", "checar status do bloco N") para virar um comando de
  uma palavra em vez de um prompt multi-etapa repetido. Gratuito, sem ressalva.
- **Hooks** (scripts determinísticos em pontos do ciclo de vida — PreToolUse, PostToolUse,
  SessionStart) — poderiam impor regras do projeto mecanicamente em vez de depender só de o agente
  ler o `AGENTS.md` toda vez (ex. um hook `PreToolUse` bloqueando `git commit` em `main`, ou
  bloqueando `terraform apply` fora do caminho de CI/CD). Gratuito, sem ressalva — é uma lacuna real
  frente ao que o `AGENTS.md` hoje pede que o agente se autopoliciе. **Sugestão concreta de
  engenharia, não só pesquisa** — vale considerar implementar.
- **Plugins** — empacotam skills/hooks/subagentes/slash-commands numa unidade versionável e
  compartilhável; só vale a pena quando já houver um conjunto estável de automações específicas do
  projeto para empacotar — não urgente pré-lançamento.
- **Preço da API Claude**: não existe tier gratuito para acesso direto à API (isso é exclusivo do
  chat consumidor claude.ai). Alavancas de custo relevantes para um uso pesado de agentes em
  background como esta sessão: **prompt caching** (leitura em cache custa ~10% da tarifa base de
  input, ~90% de economia — já ajuda implicitamente o padrão de fork/workflow desta sessão, que
  reaproveita contexto em cache); **Batch API** (50% de desconto em input+output, assíncrono em até
  24h — encaixe real para qualquer trabalho não-tempo-real que o projeto rodar em escala no futuro,
  ex. geração de relatório em lote; não se aplica a trabalho interativo de agente); níveis de modelo
  (set/2026): Haiku 4.5 US$1/US$5 por milhão de tokens, Sonnet 5 US$3/US$15, Opus 5 US$5/US$25,
  Fable 5 US$10/US$50 — vale escolher Haiku para tarefas baratas/mecânicas em background, já que o
  projeto roda muitas.
- **Connector Directory oficial da Anthropic** — 369+ conectores em meados de 2026 (GitHub, Google
  Drive, Slack, Notion, Confluence, Gmail/Calendar, Zoom entre eles) — **ressalva real**: um plano
  Free (não pago) do claude.ai é limitado a UM conector customizado via URL MCP remota; planos pagos
  não têm esse mesmo teto. Uso concreto para este projeto (fundador solo): Slack (atualização de
  status assíncrona sem precisar de terminal aberto) ou Google Drive (se algum doc de planejamento
  viver fora do repo).
- **Visibilidade de custo/uso, gratuita e standalone**: `/cost` (comando nativo do Claude Code,
  detalhamento de custo/token em tempo real da sessão, zero setup); `ccusage` (`npx ccusage@latest`,
  CLI open-source gratuita, lê o JSONL local da sessão, sem chave de API, sem chamada de rede —
  detalhamento diário/por modelo, tracking de janela de faturamento de 5 horas) — relevante dado o
  uso pesado de fork/Workflow desta sessão; vale rodar periodicamente para ver onde o gasto se
  concentra.

## Fontes

- [Gateways de Pagamento no Brasil: Comparativo 2026](https://fwctecnologia.com/en/blog/post/payment-gateways-brazil-comparison-2026)
- [As 10 Melhores Plataformas de Pagamento no Brasil em 2026](https://stackbrasil.com/melhores-plataformas-pagamento-brasil-2026/)
- [Accept Pix Payments | Stripe](https://stripe.com/payment-method/pix)
- [How to accept payments in Brazil](https://stripe.com/resources/more/payments-in-brazil)
- [Nota Fiscal Automática para SaaS | Spedy](https://lp.spedy.com.br/saas)
- [Emitir nota fiscal automaticamente em 2026 | Asaas](https://blog.asaas.com/emitir-nota-fiscal-automaticamente/)
- [PIX Recorrente em 2026](https://umanovaimagem.marketing/blog/pix-recorrente-2026-como-cobrar-mensalidade-sem-atrito)
- [Pix Automático para SaaS: Guia Completo 2026](https://forjadesistemas.com.br/blog/pix-automatico-recorrencia-saas-proprio-2026/)
- [Comparação entre Asaas vs Iugu](https://www.b2bstack.com.br/compare/asaas-vs-iugu)
- [12 Best CRMs for Solopreneurs in 2026](https://addtocrm.com/tools/best-crm-for-solopreneurs)
- [5 Best CRM for B2B SaaS in 2026](https://www.folk.app/articles/best-crm-b2b-saas)
- [Best Waitlist Software in 2026 | Waitlister](https://waitlister.me/growth-hub/guides/best-pre-launch-waitlist-tools)
- [Best Email Marketing Tools for Solo Founders (2026)](https://b2bcontentos.com/best-email-marketing-tools-solo-founders/)
- [A guide to the Freshdesk WhatsApp business integration in 2026](https://www.eesel.ai/blog/freshdesk-whatsapp-business)
- [20 Best Claude Connectors with actual day-to-day value in 2026 | Composio](https://composio.dev/content/best-claude-connectors)
- [New from Anthropic: A Connector Directory for Slack, Figma, and More](https://news.frozenlight.ai/post/frozenlight/689/anthropic-connector-directory-for-slack-figma-and-more/)
- [AI-Powered SaaS Features That Can Differentiate Your Product in 2026](https://aipxperts.com/blog/ai-powered-saas-features-that-can-differentiate-your-product-in-2026/)
- [Claude Code Changelog (September 2026)](https://www.gradually.ai/en/changelogs/claude-code/)
- [Claude Code Skills in 2026: The Complete Guide (vs Hooks, vs Subagents, vs MCP)](https://www.totalum.app/blog/claude-code-skills-totalum)
- [Claude Cost Optimization 2026: Batch API (50% Off) and Prompt Caching (90% Off)](https://pecollective.com/tools/claude-pricing-guide/)
- [Claude pricing in 2026: every plan, API rate, and what it actually costs](https://www.cloudzero.com/blog/claude-pricing/)
- [GitHub - awesome-claude-connectors (1,625 MCP integrations catalog)](https://github.com/rdmgator12/awesome-claude-connectors)
- [Claude for Startups Program 2026: Apply for Free Anthropic Claude API Credits](https://opportunitiesforyouth.org/2026/08/11/claude-for-startups/)
- [Anthropic Startup Program: How to Get $25K in Credits (2026)](https://aicreditmart.com/ai-credits-providers/anthropic-startup-program-how-to-get-25k-in-credits-2026/)
- [ccusage: Finally Know How Much Claude Code Is Actually Costing You](https://dev.to/stevengonsalvez/ccusage-finally-know-how-much-claude-code-is-actually-costing-you-1873)
- [How to monitor Claude Code token usage in software engineering](https://www.faros.ai/blog/claude-code-token-usage)
