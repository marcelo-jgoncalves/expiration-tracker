# Data Export — Rodada 2, Auto-avaliação às cegas (Claude)

Escrita ANTES de mandar a Rodada 2 pro Codex — não vi crítica dele sobre esta versão ainda.

**Nota: 8,6/10**

## O que melhorou de verdade (não só retórica)

- Achado #1 (bloqueante) corrigido com leitura real do domain model + store — a query pattern
  agora existe de verdade (`queryGsi1` por status), verificado, não assumido.
- Achado #2 corrigido com número real de infra (`timeout_seconds` default 10s confirmado por
  leitura de `variables.tf`), não mais um cap arbitrário.
- Achado #3 corrigido — colunas do CSV batem com `expiration-item.ts` real agora.
- Achado #5: tentei uma segunda fonte, ERREI a URL na primeira tentativa (404), corrigi buscando
  a URL real antes de citar — e mais importante, quando o fetch direto NÃO confirmou a alegação
  do resumo de busca (role de quem pode exportar), reportei isso honestamente em vez de manter a
  alegação não verificada. Isso é exatamente a disciplina que `research-protocol.md` exige, e é
  o tipo de correção que só aparece quando alguém realmente confere a fonte.
- Achado #7 corrigido para tratar quoting RFC4180 + mitigação de fórmula como uma responsabilidade
  única e testada junta, não dois mecanismos que alguém poderia esquecer de compor.

## Onde ainda pode estar fraco

1. **Não verifiquei se há algum limite real de tamanho de resposta do API Gateway/Lambda
   síncrono** (payload de resposta, não só tempo) — 2.000 itens × ~15 colunas pode gerar um CSV
   de algumas centenas de KB, provavelmente bem dentro do limite de payload síncrono do Lambda
   (6MB) e do limite de resposta do API Gateway HTTP API (10MB), mas não CITEI o número real
   desses limites por leitura, só assumi que está confortável. Risco real de a Rodada 3 pedir essa
   verificação explícita.
2. **`item:export` como nome de action é uma escolha só minha** — não verifiquei se algum teste
   de contrato/schema já espera um formato de nome de action diferente, nem se existe algum lugar
   que enumera todas as actions esperando uma lista fechada que precisaria de atualização
   coordenada (ex.: teste de matriz RBAC completo). Não é um risco de design, é um risco de eu ter
   esquecido um arquivo que precisa mudar junto.
3. **Ainda não constam residuais claros o bastante sobre teste de G-V3** — a proposta continua
   tratando "cobertura de teste completa" como implementação futura, o que é apropriado para uma
   decisão de escopo (não de implementação), mas eu poderia ter sido mais explícito que o
   sanitizer/writer em si é PEQUENO o bastante para valer a pena escrever já nesta rodada como
   prova de conceito, não só descrito em prosa — não fiz isso, mantive puramente design.
4. **A correção do achado #6 é boa mas um pouco alongada/repetitiva** — poderia ser mais direta.

Nenhum destes é um erro que eu saiba estar errado (diferente da Rodada 1, onde #1-#3 eram
genuinamente incorretos) — são lacunas de rigor adicional, não bugs de raciocínio. Isso justifica
subir de 7,8 para 8,6, mas não bater 9,0 ainda: o ponto #1 (limite de payload) é o tipo de coisa
que "ler o código real" resolveria, e eu não fiz isso antes de fechar esta rodada.
