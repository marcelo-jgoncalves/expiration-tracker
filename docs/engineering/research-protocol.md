# Pesquisa Externa antes de Decisões Type 1 — Expiration Tracker

**Status: `APPROVED` via protocolo Claude↔Codex (`AGENTS.md` §4), 3 rodadas, nota cega cada rodada: Rodada 1 Claude 7,9/Codex 7,7 → Rodada 2 Claude 8,8/Codex 8,7 → Rodada 3 Claude 9,2/Codex 9,2 (fechamento, ambos ≥9,0, sem arredondar).** Registrado como `docs/engineering/decisions-log.md` E-014. Evidência completa das 3 rodadas: `docs/engineering/reviews/research-protocol/`.

Pedido do Marcelo (2026-08-30, no fechamento da Wave B2B-5): formalizar quando pesquisa de padrões/mercado deve informar uma decisão de arquitetura, do mesmo jeito que `definition-of-done.md` (E-012) formalizou o gate por item de todo list — inclusive submetendo a própria formalização ao protocolo Claude↔Codex até convergência, mesmo não sendo decisão de arquitetura em si (mesmo precedente de E-012 §"Pedido explícito do Marcelo").

## Regra central

Uma decisão nível 5-6 de `docs/engineering/change-risk-scale.md` (Type 1, já sob o protocolo obrigatório de `AGENTS.md` §4) que **define um padrão ou contrato que sistemas fora deste projeto já resolveram de forma amplamente estabelecida** exige, antes da Rodada 1 do protocolo, uma declaração explícita de pesquisa externa — nunca uma omissão silenciosa.

Este documento não cria uma segunda régua de risco: ele se acopla à régua que já existe (`change-risk-scale.md`) e ao ponto de entrada que já é obrigatório (a Rodada 1 do protocolo Claude↔Codex, `AGENTS.md` §4) — não é uma disciplina nova e independente para lembrar, é um campo obrigatório dentro de uma disciplina que já é enforced.

## Quando pesquisa é exigida (critério decidível, não julgamento livre)

Pesquisa externa é exigida quando **ambas** as condições valem:

1. A decisão é nível 5-6 de `change-risk-scale.md` (já aciona o protocolo de qualquer forma).
2. A decisão define, no todo ou em parte, um **padrão que existe fora deste projeto** — um problema que produtos/sistemas estabelecidos já resolveram de forma conhecida (ex.: modelo de permissões RBAC, fluxo de convite/invite com prevenção de account-takeover, sessão/contexto multi-tenant, política de expiração de token, fronteira de sessão OAuth/cookie/CSRF) — e não apenas "como ESTE projeto específico organiza seus próprios dados" (ex.: layout de chave DynamoDB, decisão de qual módulo possui um valor default, nome de campo interno).

Regra prática para a linha divisória: se a resposta certa depende de "o que a maioria dos produtos/padrões estabelecidos faz aqui" (inclui RFCs/normas de segurança, não só produtos comerciais), pesquisa é exigida. Se a resposta certa depende só de "como isso se encaixa no nosso próprio modelo de dados/módulos já existentes", pesquisa não ajuda e não é exigida — mesma lógica de proporcionalidade de `principles.md` #1, aplicada a research em vez de a mecanismo.

**Decisão composta (achado real da Rodada 1 do Codex, testado contra D-086/D-053-D-054)**: uma decisão Type 1 raramente é 100% padrão-externo ou 100% interna — o physical model do Multi-User B2B (D-086) mistura layout de PK/SK (interno) com convite/last-OWNER/revogação de Membership (padrão SaaS estabelecido); o Full BFF (D-053/D-054) é majoritariamente padrão externo (OAuth/PKCE/cookie de sessão — RFCs e guias de segurança de browser são fonte direta do design), mas ainda toca decisões internas (nome de tabela, TTL específico). Forçar uma classificação binária da decisão INTEIRA erra nos dois casos. A declaração aceita um terceiro valor, `SIM PARCIAL`, com o escopo explícito de quais sub-decisões são informadas por pesquisa e quais são puramente internas — o checklist da próxima seção cobre só a parte `SIM`/`SIM PARCIAL`.

Pesquisa **factual isolada de implementação** (qual é a assinatura atual de uma chamada do AWS SDK, versão de uma lib) nunca aciona este documento. Mas pesquisa factual que **fundamenta o próprio padrão/postura de segurança** de uma decisão Type 1 (ex.: RFC 6749/7636 informando o design de PKCE do Full BFF) conta como a pesquisa que este documento exige, mesmo vindo de fontes "técnicas" — a distinção não é "a fonte parece uma RFC ou um blog de produto", é "essa pesquisa decide um padrão, ou só implementa um já decidido".

## Declaração obrigatória na Rodada 1 (nunca omissão silenciosa)

Todo documento de proposta Rodada 1 de um protocolo Type 1 que se enquadre no critério acima inclui, antes da seção de escopo, uma linha:

```text
Pesquisa externa considerada: SIM (fontes: <lista com data de acesso>)
                             | SIM PARCIAL (fontes: <lista>; escopo: <quais sub-decisões
                               são informadas por pesquisa, quais são internas>)
                             | NÃO (motivo: <justificativa>)
```

`NÃO` é uma resposta válida (ex.: "o padrão já está fechado internamente por uma decisão anterior, não há ambiguidade que pesquisa resolveria") — o que não é válido é a ausência da linha. Mesma disciplina do `DoD:` de `definition-of-done.md`: a linha em si é a trilha auditável mínima, escrita no momento da proposta, não reconstruída depois. Quando a resposta é `SIM`/`SIM PARCIAL`, a mesma seção da proposta inclui logo em seguida o checklist de critérios de nota derivado da pesquisa (próxima seção), escopado só à parte informada por padrão externo — as duas coisas nascem juntas, nunca o checklist como um adendo tardio de uma rodada posterior.

**Pesquisa sem padrão convergente**: `SIM`/`SIM PARCIAL` não pressupõe que o mercado concorda — às vezes a pesquisa encontra abordagens legitimamente divergentes entre produtos estabelecidos. Nesse caso a declaração registra isso explicitamente ("sem padrão convergente — fontes X/Y/Z discordam") e o checklist da próxima seção vira critérios de TRADE-OFF explícitos (qual critério favorece qual abordagem e por quê), nunca finge um consenso que a pesquisa não encontrou.

## A pesquisa estabelece os critérios de nota da rodada — nunca julgamento livre depois

Achado do Marcelo (2026-08-30): a nota do protocolo Claude↔Codex hoje é dada por julgamento de cada lado, sem uma régua comum declarada antes de avaliar — funciona quando a rodada é sobre o próprio código/dados deste projeto (cada lado lê o mesmo diff), mas quando a decisão se apoia em padrão de mercado, julgamento livre reabre exatamente a subjetividade que a pesquisa deveria fechar.

Quando a declaração é `SIM`/`SIM PARCIAL`, a pesquisa não produz só fontes — produz um **checklist de critérios objetivos e pesados**, derivado do que ela encontrou como padrão estabelecido (ou, no caso de "sem padrão convergente", como critérios de trade-off explícitos).

**Hierarquia com `joint-review-criteria.md` (achado real da Rodada 1 do Codex — a frase original "vira a régua de nota da rodada inteira" contradizia a própria declaração de `joint-review-criteria.md` de ser "fonte única dos critérios de avaliação usados nas revisões conjuntas")**: este checklist não substitui nem compete com a rubrica fixa dos 9 eixos — é uma **sub-rubrica subordinada**, específica de UMA decisão, usada em conjunto com o(s) eixo(s) de `joint-review-criteria.md` que já se aplicariam a essa rodada de qualquer forma (ex.: uma proposta de RBAC continua sendo avaliada também contra o eixo de Segurança/Governança de Produto já existente lá — o checklist de pesquisa é adicional, não um substituto). Descartado depois que a decisão fecha; nunca vira uma seção nova permanente de `joint-review-criteria.md` por conta própria (isso continua exigindo o procedimento de convergência próprio daquele documento, "Não criar a tabela de critérios dentro do primeiro doc de auditoria do eixo novo").

Regras de aplicação:

- Os critérios são declarados **na mesma proposta Rodada 1**, ao lado da linha "Pesquisa externa considerada: SIM/SIM PARCIAL" — antes de qualquer nota, nunca depois (evita o critério ser moldado para justificar uma nota já formada).
- Formato: lista pesada, cada critério com peso e uma âncora curta do que "atende"/"não atende" significa — combinando os dois precedentes já formais deste projeto: a tabela de critérios pesados por eixo de `joint-review-criteria.md` (formato) e os gates binários com âncora de `test-engineering-standard.md` (G-V1..G-V6 são validade binária, não peso — a âncora "atende/não atende" é o que se reaproveita de lá, não o peso).
- Ambos os lados (Claude e Codex) graduam a proposta **contra esses critérios explícitos** em toda rodada subsequente, não contra impressão geral — a justificativa da nota cita qual critério foi ou não atendido, não uma sensação de qualidade.

**Reconciliação quando o Codex contesta o checklist (achado central da Rodada 1 — o maior buraco identificado)**: se a crítica do Codex contesta critérios/pesos do checklist original (não só a nota dada contra ele), a proposta **não pode ser aprovada contra o checklist contestado naquela mesma rodada** — a régua em si está em disputa, não só o design. Fluxo:

1. A rodada que contesta registra a nota como **duas partes separadas, só no artefato daquela rodada** (nunca como coluna do `decisions-log.md` final, ver abaixo): nota da régua (o checklist está certo?) e nota do design (dado o checklist como está, o design atende?) — nunca uma nota única misturando as duas enquanto a régua está disputada.
2. A rodada seguinte traz um checklist reconciliado (incorporando a contestação) OU uma rejeição ponto a ponto justificada de cada item contestado — nunca silêncio sobre a contestação.
3. **Gate explícito de régua estável** (achado real da Rodada 2 do Codex — "sem contestação aberta" sozinho permite uma régua ruim sobreviver por exaustão textual, não por concordância real): a régua só é considerada estável quando **ambos os lados registram nota da régua ≥9,0**, exatamente o mesmo padrão numérico já usado para a nota do design em `AGENTS.md` §4 — nunca "parou de ser contestada" como critério informal por si só. A nota do design só conta para o fechamento ≥9,0/≥9,0 da decisão na rodada em que a régua já está estável, ou em rodadas posteriores — nunca antes (inclui a possibilidade de régua e design atingirem ≥9,0 na mesma rodada, sem exigir uma rodada extra só por formalidade).
4. Se o checklist muda por um achado real de uma rodada (não por capricho), a mudança é registrada explicitamente como correção — versão nova do checklist citada na rodada, nunca uma régua trocada silenciosamente para justificar uma nota diferente da anterior.
- O registro final da decisão (`decisions-log.md`) cita **só a nota final normal de Claude/Codex** (a mesma coluna que toda decisão já registra) **e a versão final do checklist usado** — nunca as notas intermediárias de "régua vs. design" de rodadas em disputa, que ficam só no artefato de review daquela rodada (`docs/architecture/reviews/` ou `docs/engineering/reviews/`, conforme o tipo de decisão). Isso evita introduzir um formato de coluna novo num log que já tem convenção própria (D-084/D-066 separam timing de qualidade técnica ou usam `APPROVED WITH CONDITIONS`, mas nunca um par numérico régua/design na mesma linha).

## Verificabilidade — fonte + data + representatividade, nunca "pesquisei e X é assim"

Toda afirmação vinda de pesquisa externa citada numa proposta cita a fonte real (nome/URL) e a data em que foi consultada, exatamente como o projeto já exige para código ("verificar por leitura direta antes de escrever, não repetir uma alegação não verificada" — achado real da sessão que produziu D-086→D-088). Isto importa mais aqui do que numa alegação sobre o próprio código: uma pesquisa externa erra por resumo impreciso, desatualização, ou viés de vendor de um jeito que ler o código deste repositório não erra — o revisor (Codex, ou uma sessão futura) precisa conseguir checar a fonte, não só confiar na síntese.

**Fonte + data é necessário, não suficiente (achado real da Rodada 1 do Codex)**: a declaração também justifica por que o conjunto de fontes é representativo para o TIPO de decisão, não só cita-las. Duas classes concretas:

- **Decisões com postura de segurança/identidade** (sessão, autenticação, convite, revogação): preferir normas/RFCs/OWASP quando existirem, nunca só documentação de um vendor específico — se só documentação de vendor estiver disponível, a declaração registra isso explicitamente como limitação, não esconde.
- **Decisões de padrão de produto SaaS** (RBAC, onboarding, UX de troca de organização): 2-3 exemplos de produtos estabelecidos não bastam por si só se forem todos do mesmo nicho/porte — a declaração nomeia por que a amostra escolhida é representativa (ex.: "GitHub/Notion/Linear/Slack cobrem desde ferramentas dev-first até produtividade geral, reduzindo viés de nicho único"), não apenas lista os nomes.

Nunca inventar ou adivinhar uma URL/fonte — mesma regra que já vale para toda comunicação com o Marcelo. Uma afirmação de pesquisa sem fonte verificável é tratada como não verificada, não como fato.

## Papel do Codex na rodada

Quando a Rodada 1 declara `SIM`/`SIM PARCIAL`, a crítica do Codex avalia três coisas, não só o design resultante: (1) a fonte sustenta a afirmação citada? (2) há um padrão estabelecido relevante que a proposta não considerou? (3) os critérios de nota propostos são os certos, pesados corretamente, e verificáveis — o Codex pode contestar o próprio checklist antes de aplicá-lo, não só a nota dada contra ele. Quando a Rodada 1 declara `NÃO`, o Codex tem posição aberta para discordar da declaração — "esta decisão deveria ter se apoiado em pesquisa e não se apoiou" é um achado de rodada válido, mesma categoria dos achados já vistos em rodadas reais deste projeto (ex.: `UserProfile`/gate de lifecycle da Wave B2B-5, achados encontrados por revisão antes de fechar).

## Fluxo completo (nenhum mecanismo novo, só as peças que faltavam)

```text
Decisão nível 5-6 identificada
  → pesquisa externa (se o critério acima se aplicar) — fontes+data+representatividade
    registradas; SIM / SIM PARCIAL (com escopo) / NÃO / "sem padrão convergente"
  → checklist de critérios de nota derivado da pesquisa, pesado e âncorado, subordinado
    ao(s) eixo(s) de joint-review-criteria.md já aplicáveis
  → proposta Rodada 1 com a linha "Pesquisa externa considerada: ..." + o checklist
  → Codex pode contestar o checklist em si (não só a nota) — se contestar, nota da régua
    e nota do design são registradas separadas até o checklist reconciliar
  → protocolo Claude↔Codex até convergência, cada rodada graduada contra o checklist
    (mínimo 3 rodadas, ≥9,0 dos dois, sem arredondar — AGENTS.md §4)
  → só então implementação
  → fechamento gated por definition-of-done.md (E-012/E-013) por item de todo list
```

Nenhuma etapa aqui é nova — pesquisa+declaração+checklist de critérios (com reconciliação quando disputado) é a peça que este documento adiciona ao fluxo que já existe.

## O que isso NÃO é

- Não é uma segunda régua de risco — usa `change-risk-scale.md` como está.
- Não transforma toda pesquisa em gate formal — só a que informa uma decisão já nível 5-6 (proporcionalidade, `principles.md` #1).
- Não substitui o protocolo Claude↔Codex — é um campo obrigatório dentro da Rodada 1 dele, não um protocolo paralelo.
- Não exige um formato de citação acadêmico — só fonte + data + justificativa de representatividade, suficiente para um revisor checar.
- Não substitui `joint-review-criteria.md` — aquele continua "fonte única dos critérios de avaliação usados nas revisões conjuntas" para os 9 eixos fixos; o checklist deste documento é uma sub-rubrica subordinada, específica de UMA decisão, descartada depois que ela fecha — nunca uma seção nova permanente daquele documento por conta própria.
- Não fica invisível por estar indexado só depois de aprovado — `AGENTS.md` §4 e `docs/engineering/README.md` são atualizados no fechamento (mesma sequência de E-012), não uma lacuna a mais para lembrar durante o debate em si.

## Exemplos concretos deste projeto (ilustrativos, não decisões já tomadas)

### Exemplo 1 — `SIM` completo

Wave B2B-7 (RBAC) precisa definir o que `Membership.role = ADMIN` autoriza além de `OWNER`/`MEMBER`/`VIEWER` — um modelo de permissões é exatamente o tipo de padrão que produtos estabelecidos (GitHub, Notion, Linear, Slack) já resolveram de forma conhecida. Isso se enquadra no critério: nível 5-6 (muda a matriz de autorização real, `authorization.ts`) + padrão externo estabelecido, decisão inteira informada por pesquisa (não há parte puramente interna significativa aqui). A Rodada 1 dessa proposta declararia `SIM`, citando as fontes reais consultadas (justificando por que a amostra de produtos é representativa, não só listando nomes), e proporia um checklist como (ilustrativo — os pesos/critérios reais nascem da pesquisa de verdade, não deste exemplo):

```text
1. (peso 30%) Hierarquia de papéis sem explosão combinatória — ADMIN é um superconjunto
   claro de MEMBER, não uma lista paralela de permissões redundante.
2. (peso 25%) Default deny — uma ação não listada explicitamente nunca é permitida por
   omissão.
3. (peso 25%) Não quebra `authorize()`/`ACTION_ROLES` existente sem necessidade — extensão,
   não reescrita, salvo achado real que exija o contrário.
4. (peso 20%) Mudança de permissão é auditável (quem, quando, de que role para que role).
```

Cada rodada subsequente do protocolo Claude↔Codex graduaria a proposta contra estes 4 itens especificamente, não contra uma impressão geral de qualidade.

### Exemplo 2 — `SIM PARCIAL` (decisão composta, retrospectivo contra D-086)

O physical model do Multi-User B2B (D-086) é o caso real que expôs a necessidade deste valor intermediário. Nome/formato do GSI4 (`MembershipByUser`) e layout de `PK`/`SK` de `Membership` são decisões internas — nenhuma pesquisa de mercado ajudaria a escolher entre `GSI4PK=USER#<userId>` e uma alternativa equivalente, isso depende só do resto do schema já existente deste projeto. A postura de isolamento IAM do índice (achado real da Rodada 2 do Codex: "least-privilege para índice cross-tenant" É um padrão de segurança que poderia depender de pesquisa externa, não é automaticamente interno só por tocar um índice) já estava decidida internamente ANTES de D-086, pelo precedente já estabelecido de GSI3/GSI6 (`AGENTS.md` §7 — "nunca conceder acesso de leitura a um GSI restrito via política geral de tabela") — é interna aqui por decisão anterior já convergida, não porque IAM/postura de segurança seja categoricamente interna. Mas o mecanismo de `ownerCount`/last-OWNER, a unicidade de convite pendente, e a semântica de revogação de Membership são padrões que produtos SaaS multi-tenant estabelecidos já resolveram e não tinham precedente interno prévio. A declaração correta nesse caso seria `SIM PARCIAL (fontes: ...; escopo: mecanismo de last-OWNER e revogação de Membership são informados por padrão externo; layout de chave/GSI e isolamento IAM do índice são decisão interna — o último por precedente já convergido em GSI3/GSI6, não por serem categoricamente internos)` — e o checklist de critérios cobriria só a parte de last-OWNER/revogação, não o schema inteiro.
