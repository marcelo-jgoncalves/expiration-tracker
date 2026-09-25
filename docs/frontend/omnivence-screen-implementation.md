# OmniVence — implementação das nove telas

Referências: especificações e protótipos em `prototype/novasTelas/`. Commits individuais por tela; testes somente ao final, por instrução de Marcelo em 2026-09-25. Implementação em andamento, ainda sem aceite de validação.

| Tela | Implementação | Validação |
|---|---|---|
| Login | 21dd06a2 | Pendente rodada final |
| Visão geral e shell | Implementados sobre APIs existentes | Pendente rodada final |
| Vencimentos | Em andamento | Pendente |
| Novo vencimento | Pendente | Pendente |
| Fornecedores | Pendente | Pendente |
| Notificações | Pendente | Pendente |
| Configurações | Pendente | Pendente |
| Membros | Pendente | Pendente |
| Atividade | Pendente | Pendente |

## Diferenças de contrato a resolver

- Visão geral/Vencimentos: a busca existente `GET /items/search` pesquisa nome, status e validade; não pesquisa categoria/contexto nem retorna total de correspondências, totais por status ou `asOfDate`. Há cursor e limite de varredura. Usar paginação real e contagens explicitamente parciais; não inferir totais de páginas.
- Datas: o serviço de validade usa instante UTC e janela em milissegundos, enquanto as novas especificações pedem data civil organizacional. A mudança precisa abranger resumo, busca e apresentação juntos para não divergir.
- Logo: PNG lilás aprovado disponível; SVG oficial continua pendente de entrega.
- Trabalho preexistente em NotificationPreferences e backend de WhatsApp preservado; não faz parte dos commits desta frente.

## Novo vencimento — diferenças reais do domínio

- Categoria, periodicidade e prioridade são texto livre no contrato atual; não existe catálogo com IDs. Campos mantidos como texto, sem listas fictícias. Criar catálogos e IDs é decisão de modelo pendente de Marcelo.
- A API exige data-hora; o adaptador mantém a data digitada com sufixo UTC estável. Migrar para data civil exige contrato conjunto com consulta/alertas.
- Rascunho do formulário fica em memória nesta tela; idempotência existente preservada. Links internos e fechamento/reload pedem descarte; botão Voltar/Avançar do browser ainda depende de migração do roteador declarativo para suporte a bloqueio.
