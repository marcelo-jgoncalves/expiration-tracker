# OmniVence — implementação das nove telas

Referências: especificações e protótipos em `prototype/novasTelas/`. Commits individuais por tela; testes somente ao final, por instrução de Marcelo em 2026-09-25. Implementação em andamento, ainda sem aceite de validação.

| Tela | Implementação | Validação |
|---|---|---|
| Login | 21dd06a2 | Em validação |
| Visão geral e shell | 56a6b952 | Em validação |
| Vencimentos | 9983c776 | Em validação |
| Novo vencimento | 7273e5f2 | Em validação |
| Fornecedores | adc9b7a3 | Em validação |
| Notificações | 496fb3d4 | Em validação |
| Configurações | 14a7aff9 | Em validação |
| Membros | 65e9e2a0 | Em validação |
| Atividade | e86e8aef | Em validação |

## Diferenças de contrato a resolver

- Visão geral/Vencimentos: a busca existente `GET /items/search` pesquisa nome, status e validade; não pesquisa categoria/contexto nem retorna total de correspondências, totais por status ou `asOfDate`. Há cursor e limite de varredura. Usar paginação real e contagens explicitamente parciais; não inferir totais de páginas.
- Datas: o serviço de validade usa instante UTC e janela em milissegundos, enquanto as novas especificações pedem data civil organizacional. A mudança precisa abranger resumo, busca e apresentação juntos para não divergir.
- Logo: PNG lilás aprovado disponível; SVG oficial continua pendente de entrega.
- Trabalho preexistente em NotificationPreferences e backend de WhatsApp preservado; não faz parte dos commits desta frente.

## Novo vencimento — diferenças reais do domínio

- Categoria, periodicidade e prioridade são texto livre no contrato atual; não existe catálogo com IDs. Campos mantidos como texto, sem listas fictícias. Criar catálogos e IDs é decisão de modelo pendente de Marcelo.
- A API exige data-hora; o adaptador mantém a data digitada com sufixo UTC estável. Migrar para data civil exige contrato conjunto com consulta/alertas.
- Rascunho do formulário fica em memória nesta tela; idempotência existente preservada. Links internos e fechamento/reload pedem descarte; botão Voltar/Avançar do browser ainda depende de migração do roteador declarativo para suporte a bloqueio.

## Fornecedores — diferenças confirmadas

- `archiveSubject` sempre transita para ARCHIVED; não há endpoint de restauração. A confirmação explica a limitação e a interface não anuncia reativação falsa.
- Exclusão é lógica (DELETED/deletedAt), não cascata. Confirmação exige nome, mantém OCC e autorização existentes. O serviço não impede exclusão por vínculos; política de bloqueio/retenção pendente de decisão.
- Dashboard existente não devolve totais nem cursor. Contagens rotuladas como carregadas; busca por nome/identificador preservada sobre esse conjunto. Busca remota existente só aceita nome e tags, sem identificador. Paginação e totais completos ainda pendentes de contrato.

## Notificações — decisões pendentes

- A verificação WhatsApp existente registra opt-in automaticamente; a especificação exige verificação independente de adesão. Campo/botão ficam indisponíveis até separar essas operações e expor disponibilidade do serviço. Não há confirmação demonstrativa nem chamada de adesão implícita.
- E-mail salvo desativado não informa se houve supressão SES por reclamação. Desativação pessoal oferecida; reativação de uma preferência já desativada permanece indisponível até existir distinção de supressão no serviço.
- Worker M4 tem perda conhecida de lembretes em quiet hours (item 27 do handoff); o reskin não resolve a fila. Aceite funcional completo depende dessa correção.

## Atividade — diferenças confirmadas

- API consulta um mês UTC por vez, padrão mês atual (`YYYYMM`). Não existe consulta de todos os meses, intervalo civil organizacional ou filtro por ator. Interface mantém mês explícito, campo de pessoa indisponível e aviso; não disfarça o mês atual como todos os meses. Contrato transversal depende de decisão de arquitetura.
- Identidade vem do diretório autorizado de membros, em uma consulta, identificada como perfil atual. Para atores ausentes, mantém ID e informa indisponibilidade de nome/e-mail; snapshots históricos ainda não existem.
- API oferece cursor sem total. Mantidos carregamento incremental real e contagem carregada; total e paginação numerada aguardam contrato. ID de recurso tem correspondência exata.


## Validação em andamento — 2026-09-25

- Frontend: `npm run typecheck` e `npm run lint` verdes após correções de tipos, fechamento de referências e acentuação.
- Primeira execução de `npm test`: 381 testes passaram, 87 falharam (11 arquivos). Resultado anterior às correções finais; é necessário revisar expectativas antigas e regressões reais, corrigir e repetir a suíte. Nenhuma tela recebeu aceite final.
- Pendente: testes de regressão das nove telas, build, validação visual desktop/mobile e acessibilidade. A implementação continua em andamento.
- Configurações: serviço não retorna fuso na listagem inicial; não inferir fuso particular da organização. Encerramento usa retenção real de 30 dias, não exclusão imediata.
- Membros: atribuição direta de Proprietário não é oferecida no formulário de convite/alteração comum, conforme especificação; fluxo próprio de transferência permanece pendente.
