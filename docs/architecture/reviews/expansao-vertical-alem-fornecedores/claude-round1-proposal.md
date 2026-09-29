# Expandir o posicionamento além de "fornecedores" — análise de viabilidade — Rodada 1 (proposta Claude)

## Pedido

Marcelo, 2026-09-29: aprofundar a análise de quanto o produto poderia servir outros contextos (RH/gestão de terceiros, corretoras de seguro, imobiliárias, frotas, condomínios) sem mudar muita coisa, e submeter ao protocolo Claude↔Codex para ganhar convicção real sobre se vale a pena — não uma implementação, uma decisão informada.

**Declaração de pesquisa externa (E-014)**: NÃO. Isto não é um padrão técnico que sistemas externos já resolveram (RBAC, invite, sessão multi-tenant) — é uma decisão de posicionamento/produto interna, sem um "estado da arte" externo objetivamente pesquisável da mesma forma.

## Achado central (verificado por leitura direta do código, não suposição)

**O modelo de dados já é genérico — a limitação é só de copy/pricing, não de arquitetura.**

1. `TrackedSubjectType` (`frontend/src/api/types.ts:102`) já é `"COMPANY" | "VENDOR" | "CLIENT" | "EMPLOYEE" | "ASSET" | "LOCATION" | "CUSTOM"` — a entidade central (`Subject`, módulo backend `src/modules/subject/`, nunca `src/modules/fornecedor/`) já modela fornecedor, cliente, colaborador, ativo e unidade como o MESMO conceito. `presentSubjectType()` (`presentation.ts:220`) já traduz cada um (Empresa/Fornecedor/Cliente/Colaborador/Ativo/Unidade).
2. `Requirement.category`/`ExpirationItem.category` são texto livre — nenhum enum fechado amarra a um vocabulário de fornecedor.
3. `DocumentTypesCollection`/`DocumentTypeEditor` já são configuráveis por tenant — um tenant de RH poderia cadastrar "ASO", "Carteira de Trabalho" sem mudança de schema.
4. Busca em todo `src/modules/` (backend): só 2 ocorrências de "fornecedor", ambas em COMENTÁRIOS de código (`guest-document-access-service.ts:119`, `digest-entry.ts:45`), nenhuma em lógica/nome de campo/enum. Templates de e-mail (`email-templates.ts`) não mencionam "fornecedor". A cota técnica (`ACTIVE_TRACKED_SUBJECTS_LIMIT`, `src/modules/subject/domain/entitlement.ts:20`) conta QUALQUER `TrackedSubject`, não filtra por `type=VENDOR` — um tenant de RH gerenciando "Colaboradores" já seria contado corretamente por essa cota hoje, sem nenhuma mudança de código.

**Conclusão do achado**: engenheiramente, expandir para outro vocabulário é muito mais barato do que uma reestruturação de produto — é, na prática, um problema de COPY (rótulos de tela/menu) e de POSICIONAMENTO COMERCIAL (pricing, marketing), não de modelo de dados.

## O que NÃO é barato (achado que corrige a intuição inicial de "pequenos ajustes")

1. **`docs/project/planos-precos-2026-09-27.md`** (proposta de pricing, 13 rodadas de protocolo, **ainda não decidida por Marcelo** — "Isto é uma PROPOSTA... não uma decisão") já nomeia a cota central como **"Fornecedores ativos incluídos por organização"** e um item de linha inteiro "Módulo Fornecedores (Requisitos/Guest Upload/IA-OCR)". Isso não é copy de tela — é a unidade de cobrança do produto. Mudar isso depois que planos estiverem realmente vendidos a clientes reais seria uma mudança de contrato comercial, não uma renomeação de UI.
2. **59 ocorrências de "fornecedor" em 5 specs E2E** (`frontend/e2e/*.spec.ts`) — não é lógica de produto, mas é manutenção real de teste (nomes de describe/it, `getByRole`/`getByText` que casam texto literal de tela).
3. **Todo o vocabulário de UI já em produção**: menu "Fornecedores" (`shell/navigation.ts`), `PageHeader`/`OmniHero` de `SubjectsCollection.tsx` ("Rede de parceiros", "Todos os relacionamentos"), `SubjectLayout.tsx` ("Hub do fornecedor"), fluxo de convite do fornecedor (`G01`/`G02`, guest upload) cuja copy inteira (e-mails, WhatsApp, portal do convidado) fala com uma pessoa de fora da organização no papel de FORNECEDOR especificamente ("{Fornecedor} solicitou evidência...") — isso é a metade do produto (o portal do convidado) que faz sentido para VENDOR mas não necessariamente para EMPLOYEE/CLIENT/ASSET (um "convite de upload" pra um colaborador interno, por exemplo, é uma frase e um fluxo de confiança diferentes).

## A pergunta que a engenharia não responde

Nenhum documento do repositório (`docs/project/`) registra pesquisa de demanda real para nenhum vertical além do atual (SaaS de compliance documental B2B para fornecedores). `docs/project/pesquisa-owners-admins-por-plano-2026-09-28.md`/`planos-precos-2026-09-27.md`/`roadmap-competitivo-2026-09-01.md` (a pesquisa de concorrência mais recente, D-346) são todos ancorados no nicho de fornecedores. **Isto é o risco real, não o custo de engenharia**: mudar rótulos sem evidência de demanda de outro nicho é aposta especulativa, não validação — o esforço de engenharia (baixo a moderado) não é o fator limitante da decisão, a falta de sinal de mercado é.

## Opções concretas, por esforço e reversibilidade

| Opção | Esforço | Reversível | O que resolve |
|---|---|---|---|
| **A. Nada agora** | Zero | N/A | Evita gasto especulativo; mantém foco no nicho validado (fornecedores/compliance B2B) |
| **B. Filtro por `TrackedSubjectType` na listagem existente** | Baixo (1 tela, sem tocar menu/pricing) | Total | Deixa visível pra quem já usa que a mesma tela serve Cliente/Colaborador/Ativo, sem prometer nada a mercado novo |
| **C. Renomear só o menu/H1 pra termo neutro** ("Cadastros"/"Contrapartes") | Médio (menu + PageHeader + specs E2E que casam o texto) | Alta, mas exige revisão de 5 arquivos de teste | Remove a ancoragem visual em "fornecedor" sem prometer nada nem mexer em pricing/portal do convidado |
| **D. Landing page/mensagem de teste pra 1-2 verticais adjacentes** (RH, seguros) sem mudar produto nenhum | Baixo (fora do código do produto) | Total | **Responde a pergunta real** (existe demanda?) antes de qualquer investimento de engenharia |
| **E. Reescrever pricing/portal do convidado pra vocabulário genérico** | Alto (pricing ainda nem decidido, portal do convidado tem fluxo de confiança específico de VENDOR) | Baixa depois de comercializado | Só faz sentido DEPOIS de D confirmar demanda real |

## Recomendação (Claude, Rodada 1)

**D primeiro, isoladamente, sem tocar em nenhuma linha de código do produto.** É a única opção que resolve a incerteza real (demanda) ao invés de gastar esforço de engenharia numa aposta não validada. Se D confirmar sinal em algum vertical específico, C (rename de copy neutro, baixo risco) é o próximo passo natural — B pode ser feito em paralelo a qualquer momento por ser reversível e não comprometer nada. E fica fora de escopo até haver decisão de pricing E validação de demanda — mexer no "Módulo Fornecedores" do pricing ainda-não-decidido antes de D seria inverter a ordem de uma decisão de produto real.

## Critérios de aceite desta análise

1. Toda afirmação sobre o código foi verificada por leitura direta (arquivo:linha citado), não suposição.
2. A distinção entre "custo de engenharia" (baixo) e "risco de decisão de produto" (real, não resolvido por engenharia) fica explícita, não escondida atrás de "é só renomear".
3. A recomendação não implementa nada — é uma sequência de validação, coerente com a ausência de qualquer pesquisa de demanda registrada para outro vertical.
