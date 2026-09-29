# Expandir o posicionamento além de "fornecedores" — Rodada 3 (proposta Claude)

Continuação de D-353 (convergido 9,0/9,0 na Rodada 2: "vale investigar 1 vertical adicional, sem mudar produto antes disso"). Marcelo pediu execução do passo 1 do funil recomendado (comparar candidatos) via pesquisa de mercado real, e agora pede que o resultado seja submetido ao Codex. Relatório completo: `docs/project/pesquisa-nichos-adjacentes-2026-09-29.md` (D-354).

## O que foi feito

5 agentes de pesquisa web independentes (mesma disciplina de `pesquisa-concorrencia-2026-09-27.md` — nunca inventar concorrente/preço, marcar "não encontrado" explicitamente), um por nicho candidato de `first-customers-acquisition-strategy.md` §46 + o candidato de RH já sinalizado em D-353 via o concorrente Valide Soluções:

| Nicho | Nota | Achado central |
|---|---|---|
| Construção civil/engenharia | 6,5/10 | Dor documentada (NR-18, Súmula 331, ART/RRT); concorrentes reais (Dynadok, wehandle, REGRHAN, Canteiro Online) todos venda enterprise/sob consulta, nenhum self-service com preço público |
| RH/gestão de terceiros | 6,0/10 | Demanda legal com prazo real (NR-1, fiscalização a partir de 26/05/2026); mercado consultivo sem preço público (Valide Soluções, BMS Integra, Senior, GT Soft); lacunas reais de LGPD (dado de saúde) e modelagem (CLT vs. PJ, regras por cargo) |
| Frotas/logística | 5,0/10 | Demanda legal real, volume grande (319 mil ETCs, ANTT); mas controle de vencimento já é módulo commodity embutido em sistemas de gestão de frota (FrotaControl, Frota Certa, Sofit) |
| Corretoras de seguros | 3,0/10 | Mercado grande (136.505 corretores, SUSEP); dor já resolvida de graça dentro dos sistemas verticais que o corretor já paga (Segfy, Quiver, Agger) |
| Imobiliárias/condomínios | 3,0/10 | Mercado grande (161.573 condomínios, ~70 mil imobiliárias); mesmo padrão de seguros — feature de ERP que o cliente já paga (Superlógica, Residente Online, Imobiliária21) |

## Achado central (a conclusão que está sendo submetida à crítica)

Nenhum dos 5 nichos reproduz o gap que justificou escolher contabilidade como ICP (`pesquisa-concorrencia-2026-09-27.md` §2.1: nenhum concorrente brasileiro direto identificado para controle de vencimentos pessoal/PME com preço público). O padrão nos 5 novos nichos é sempre (a) venda consultiva enterprise sem preço público, ou (b) feature já embutida de graça dentro de um ERP vertical que o comprador já paga. **O custo de engenharia pra atender tecnicamente qualquer um deles é baixo (confirmado em D-353 — `TrackedSubjectType` já cobre as entidades certas), mas isso não é o fator limitante — a estrutura de distribuição/venda é estruturalmente mais difícil que o ICP atual nos 5 casos pesquisados.**

## Recomendação sendo submetida

Nenhum dos 5 supera contabilidade em evidência até aqui. Construção civil (6,5) e RH (6,0) são os únicos com dor documentada forte o bastante pra justificar uma entrevista real (passo 2 do funil de D-353) — cada um com uma ressalva específica a resolver antes de qualquer piloto (ticket self-service viável em construção; tratamento LGPD de dado sensível em RH, ANTES do piloto). Seguros e condomínios/imobiliárias (3/10 ambos) não parecem valer o próximo passo. Nenhuma mudança de produto recomendada a partir desta pesquisa isoladamente.

## Pontos que pedimos que o Codex avalie com rigor adversarial

1. A metodologia de pesquisa (5 agentes paralelos, um por nicho, buscando concorrente/preço real na web) é adequada para o tipo de decisão em jogo, ou tem viés estrutural (ex: cada agente só teve ~500-600 palavras e um conjunto fixo de perguntas — pode ter perdido concorrentes relevantes ou superficializado a avaliação técnica)?
2. A conclusão central ("nenhum reproduz o gap de contabilidade") é logicamente sustentada pelas 5 notas individuais, ou há um viés de confirmação nela (ex: será que "dor já resolvida de graça" é um teste justo, dado que TODO nicho maduro provavelmente já tem algum concorrente estabelecido — inclusive o de contabilidade tem "suaCND" como concorrente parcial)?
3. A comparação entre construção/RH (recomendados para próximo passo) e seguros/condomínios (descartados) é justa, ou os últimos dois merecem mais investigação antes de descartar?
4. Existe risco de que esta pesquisa, sendo só competitiva/documental (sem conversa com comprador real), esteja sendo tratada com mais peso do que deveria na recomendação final?
5. Qualquer achado real que a pesquisa ou esta síntese tenha errado, cite fonte:linha do relatório (`docs/project/pesquisa-nichos-adjacentes-2026-09-29.md`) ou do código/doc relevante.

Isto é uma pesquisa de mercado/produto, não uma decisão técnica de código irreversível — não é preciso exigir rigor de nível arquitetural, mas Marcelo quer convicção real antes de decidir onde investir o próximo passo (conversa com cliente real).
