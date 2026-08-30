# Round 1 — Claude self-grade (blind, registrado antes de ver a resposta do Codex)

**Nota: 8.4/10**

## Pontos fortes

- Levantamento contra as 25 perguntas feito por leitura real (fork de pesquisa + verificação
  própria de cada achado citado, não aceitei o relatório do fork sem checar) — 20/25 confirmadas
  já cobertas evita a armadilha óbvia desta wave (reescrever adversarial testing do zero quando a
  maior parte já existe, waste real contra `principles.md` #1).
- Achado #3 é o mais valioso: um gap de produção REAL (não só falta de teste) encontrado por
  diferenciar dois pontos de leitura do mesmo dado (roteamento vs. entrega) que uma leitura
  superficial dos testes existentes (que só provam o roteamento) deixaria passar — confirmei
  pessoalmente lendo `email-delivery-workflow.ts`/`runtime/aws/composition/notification.ts` linha
  a linha, não confiei no resumo do fork de pesquisa para essa parte.
- Distingui corretamente Q16 (presigned URLs) como CONTRATO JÁ DECIDIDO (§47/§48) em vez de tratá-lo
  como bug — verifiquei o comentário real de `document-service.ts` confirmando que a semântica de
  admissão já está implementada, evitando propor uma "correção" para um comportamento intencional.
- Checklist de nota (E-014) inclui um critério específico (#2) que aplica o próprio Achado #4 aos
  testes NOVOS desta wave, não só uma auditoria passiva dos antigos — evita a wave introduzir a
  mesma classe de fragilidade que está tentando auditar.

## Riscos/fraquezas conhecidas

- Não verifiquei pessoalmente os 20 pontos "já cobertos" um a um com a mesma profundidade do
  fork — confiei no relatório dele para a maioria, verificando só os 2 mais prováveis de esconder
  nuance (Q22 já confirmado por memória própria de B2B-11, Q16 por leitura direta). Se o Codex
  encontrar um 21º ponto na verdade descoberto, essa é a fraqueza mais provável desta proposta.
- Achado #1 (revogação ponta-a-ponta) e Achado #2 (roles por org) são só testes novos — não
  investiguei se a ausência desses testes esconde um bug real ainda não encontrado (diferente do
  Achado #3, onde SEI que há um gap real) — é possível que ambos "só" formalizem um comportamento
  já correto, o que é valioso mas menos urgente do que apresentei.
- Pergunta aberta 1 (onde colocar o recheck) é uma decisão de design pequena que registrei em vez
  de propor — poderia ter decidido sozinho (inline, já que só há 1 call site real hoje) e deixado
  só para confirmação.

## Nota

8,4 reflete um achado de produção real e bem verificado (Achado #3), mas reconhece que 2 dos 5
itens (Achados #1/#2) são reforço de teste sem confirmação de que escondem um bug real — mantenho
expectativa de que o Codex conteste a pergunta aberta 1 com uma opinião mais forte, ou encontre um
6º achado que esta leitura não viu.
