# Round 2 — Claude self-grade (blind, registrado antes de ver a resposta do Codex)

**Nota: 9.0/10**

## Por que subiu de 8.1
Os 2 achados bloqueantes são reais e a correção de cada um foi verificada por leitura do mecanismo
real (não só aceita de olhos fechados): a corrida agora tem um gate explícito com cancelamento ativo
(fecha as 2 metades do problema: novo tráfego E tráfego já em voo), e o inventário foi refeito por
grep exaustivo em vez de confiar na lista parcial anterior — achei até um 8º call site
(`Overview.tsx`, uso inline que nem replica o hook) que nem o próprio Codex nomeou explicitamente
por arquivo, só por classe de problema ("Overview usa... direto").

## Riscos residuais conhecidos
- O gate `switching` é estado local do hook `useActiveOrganization()` — se dois componentes
  chamarem o hook de lugares diferentes (não deveria acontecer se for consumido só via Context/um
  singleton, mas não verifiquei se a implementação real vai garantir isso), poderia haver 2 cópias
  do estado `switching` desincronizadas. Deveria virar Context Provider único, não múltiplas
  instâncias do hook — vou registrar isso explicitamente na implementação, mas não testei a
  alternativa a fundo nesta rodada de design.
- Não tenho prova de execução (nenhum teste rodou) de que `cancelQueries` realmente aborta o
  `fetch()` em voo do `ApiClient` real (o Codex citou a doc do TanStack confirmando que cancelamento
  só aborta se o `AbortSignal` for consumido) — `client.ts` JÁ aceita `options.signal` e já encadeia
  no `AbortController` interno (verificado na Rodada 1), então o mecanismo deveria funcionar, mas
  isso só vira certeza real na implementação/teste, não no design.
- Não sei ainda se `["session"]` como chave da query de sessão colide com algum uso futuro — nome
  genérico o suficiente para ser uma escolha um pouco arriscada, mas não vi nenhum uso conflitante
  hoje.

## Nota
9.0 reflete confiança de que os 2 bloqueantes foram fechados corretamente com mecanismo verificável
(cancelamento explícito, não confiança implícita em comportamento automático), mas mantenho no piso
do gate porque o design ainda não foi implementado/testado e há uma pergunta real de arquitetura
(hook vs. Context singleton) que registro para a Rodada 3/implementação em vez de fingir que já está
resolvida.
