# A16 — Relatórios e exportações

**Rota:** `/app/:orgId/reports`
**Acesso:** **CORRIGIDO — ADMIN_ROLES exclusivamente para os 7 downloads e para gerenciar assinaturas** (`item:export`/`docarchive:requirement-export`/`reports:subscription-manage`, todas ADMIN_ROLES-only). MEMBER e VIEWER **não** veem os botões "Baixar CSV"/"Editar"/"Remover"/"Nova assinatura" (omitidos, nunca apenas desabilitados) — a versão anterior desta spec dizia incorretamente "todos os papéis para baixar/ver; criar assinatura MEMBER+", o que concederia a MEMBER e VIEWER uma ação tenant-wide exclusiva de ADMIN_ROLES. **Exceção estreita e real** (distinta do acesso tenant-wide acima): um destinatário nomeado de uma execução agendada específica pode baixar **aquela execução** mesmo sem ser ADMIN — essa exceção vive apenas no link de download daquele run específico (recebido por e-mail ou na notificação), nunca como acesso geral a este catálogo.
**Nav ativo:** "Relatórios"

**Revisão 2026-09-10 (screen-spec-audit-2026-09-09, batch 4/6)**: reescrita completa após NOT PASS
com **achado CRITICAL de RBAC over-grant** (Functional 21.7/100, Visual 31.0/100, Consolidado
25.4/100). Ver `docs/architecture/reviews/screen-spec-audit-2026-09-09/A16-audit-record.md`. **G3
(D-248) está fechado** — os 7 downloads são end-to-end reais através do BFF (headers
`content-disposition`/`x-report-truncated` propagados); esta revisão trata os downloads como
funcionais, não bloqueados, e adiciona os estados que essa realidade operacional exige (abaixo).

## Visão para MEMBER/VIEWER (sem acesso a nenhuma ação desta tela)

MEMBER e VIEWER que naveguem para `/app/:orgId/reports` veem um `EmptyState` explicativo em vez do
catálogo: "Relatórios e exportações são administrados por OWNER/ADMIN desta organização." — nunca a
tela em branco nem um catálogo com botões desabilitados sem explicação. Isso é deliberado: mostrar
o catálogo e desabilitar cada botão individualmente sugeriria que a ação é normalmente disponível a
este papel e apenas temporariamente indisponível, o que é falso.

## Estrutura (ADMIN_ROLES)

1. `PageHeader`: título "Relatórios e exportações", descrição "7 relatórios CSV e assinaturas de envio programado." Sem ações de cabeçalho.
2. **Grid de cards de relatório** (`repeat(auto-fill, minmax(260px,1fr))`), 7 cards, agrupados visualmente em duas categorias com um subtítulo de seção cada — "Vencimentos" (4 relatórios) e "Requisitos" (3 relatórios) — em vez de uma grade única de 7 iguais (o agrupamento por domínio é a diferenciação mínima exigida antes de se tornar um SLF-01 análogo; ver §V7 no registro de auditoria). Cada card: título do relatório + nota técnica (entidade/filtro) + botão "Baixar CSV" (secondary, sm):
   1. Vencimentos expirados — ExpirationItem · status expirado
   2. Vencimentos a vencer — Janela de 7 dias
   3. Vencimentos renovados — Histórico de renovações
   4. Vencimentos por responsável — Agrupado por assignee
   5. Requisitos em falta — Requirement · MISSING
   6. Requisitos por fornecedor — Requirement · agrupado por Subject
   7. Requisitos por responsável — Requirement · agrupado por assignee
3. **Painel "Assinaturas"** (header: título + contagem + botão "Nova assinatura" secondary sm à direita): `DataTable` compacta, colunas:
   - Relatório (primary)
   - Destinatários (ex. "3 destinatários", link "Ver todos" se > 3, `EntityPicker` keyboard-searchable ao editar)
   - Periodicidade (ex. "Semanal", "Diária")
   - Última execução (data, link para o histórico de runs dessa assinatura — ver abaixo)
   - Ações: "Editar" (`ghost`, sm) + "Remover" (`danger`, sm — exclusão de uma assinatura é uma ação destrutiva real, não apenas de baixa ênfase).

## Download de um relatório

- Clique em "Baixar CSV" inicia o download via BFF (`content-disposition` já traz o nome do arquivo). O botão entra em `loading` breve durante a requisição.
- **CSV truncado** (relatório grande, `x-report-truncated` presente na resposta): `Toast` persistente (não desaparece sozinho) "Este relatório foi truncado em {n} linhas pelo tamanho do arquivo." com link "Ver como reduzir o escopo" quando o relatório aceitar filtro.
- **Relatório vazio**: card mostra "Sem dados no período atual" abaixo do título em vez de habilitar um download de CSV vazio sem aviso; o botão "Baixar CSV" continua disponível (um CSV só com cabeçalho é um resultado válido), mas o aviso evita a impressão de erro.
- **Falha de geração/download**: `InlineNotice tone="danger"` inline no card específico, "Não foi possível gerar este relatório agora. Tentar novamente." — nunca um erro genérico de página inteira, já que os outros 6 relatórios continuam funcionais.

## Assinaturas — criação/edição (`Dialog`, ADMIN_ROLES)

- Campos: Relatório (`Select`, um dos 7), Destinatários (`EntityPicker` multi-select, keyboard-searchable, aceita e-mails avulsos além de membros da organização), Periodicidade (Diária/Semanal/Mensal).
- Botão "Salvar" (primary) → cria/atualiza a assinatura. Estados de loading/sucesso/erro seguem o mesmo padrão de A14 (`Toast` de sucesso, `InlineNotice` de erro inline no dialog).

## Histórico de execuções (por assinatura, "Última execução" → link)

`Drawer` lateral com a lista de runs daquela assinatura: data, status (Concluído/Falhou), link de
download por run. Estados:
- **URL de download expirada, mas o run ainda existe**: link mostra "Expirado — gerar novamente" (regenera uma nova URL presignada para o mesmo run já concluído, sem reprocessar o relatório).
- **Assinatura removida, mas o destinatário de um run passado ainda pode acessá-lo**: o run permanece acessível pelo link que aquele destinatário recebeu originalmente (a exceção estreita descrita no topo desta spec), mesmo que a assinatura em si já não exista mais na lista — a UI desse destinatário (fora desta tela, no e-mail/notificação recebida) nunca aponta de volta para este painel administrativo.

## Ação "Remover" assinatura

`Dialog` de confirmação nomeando objeto e consequência: "Remover a assinatura de 'Requisitos em falta' para 3 destinatários? Execuções futuras não serão mais enviadas. O histórico de execuções já enviadas permanece acessível a quem as recebeu." Botão de confirmação `danger`.

## Responsivo

Full parity (per plano). Grid de cards já é responsivo por `auto-fill`. `DataTable` de assinaturas vira lista de cards empilhados abaixo de 768px, mesmo padrão de A14/A16. `EntityPicker` de destinatários permanece totalmente operável por teclado em mobile (não depende de hover).

## Motion

Troca de estado do botão "Baixar CSV" (`default` → `loading` → `default`) é instantânea, sem fade — é uma ação frequente e curta, motion aqui atrasaria a percepção de resposta. Abertura do `Drawer` de histórico usa o token de motion padrão do componente. `prefers-reduced-motion`: sem alteração adicional (nada aqui depende de animação decorativa).

## Dados de exemplo (assinaturas)

```
Requisitos em falta — 3 destinatários — Semanal — última 07/09/2026
Vencimentos a vencer — 1 destinatário — Diária — última 09/09/2026
```

## Regras de negócio

- Os 7 relatórios são fixos/predefinidos (não criados pelo usuário) — apenas as assinaturas de envio recorrente são configuráveis.
- Assinatura = relatório + destinatários + periodicidade; roda automaticamente e envia por e-mail.
- Download de um relatório e gerenciamento de assinaturas são ADMIN_ROLES-only, sempre — a única exceção real é o acesso de um destinatário nomeado à execução específica que lhe foi endereçada, nunca ao catálogo geral.
- Um CSV pode vir truncado por tamanho (sinalizado via header) — a tela nunca apresenta um relatório truncado como se fosse completo.

## Conecta-se com

Linhas de relatório (quando o relatório aceitar filtro equivalente) podem levar de volta a A04/A11 com o mesmo filtro aplicado.
