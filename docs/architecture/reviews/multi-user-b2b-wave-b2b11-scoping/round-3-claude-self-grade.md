# Round 3 — Claude self-grade (blind, registrado antes de ver a resposta do Codex)

**Nota: 9.2/10**

O achado da Rodada 2 é real e a correção é precisa: reaproveita exatamente o mecanismo já
`APPROVED`/testado (`resolve-request-context.ts`'s checagem de `identityStatus`), não inventa uma
regra nova — só estende a MESMA regra para o resolver de notificação e para
watcher/assignee. A escolha de `active:false` (não `undefined`) para Membership-ativa-mas-
identidade-suspensa é consistente com a semântica já estabelecida (NOT_FOUND é sobre relação com a
Organization, NOT_ELIGIBLE é sobre a pessoa em si).

Não é 9.5+ porque ainda é design — a prova real vem só na implementação/teste.
