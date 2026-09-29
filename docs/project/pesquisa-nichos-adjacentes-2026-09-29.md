# Pesquisa de nichos adjacentes — custo-benefício de expandir além de "fornecedores/contabilidade" (2026-09-29)

**Pedido por:** Marcelo, 2026-09-29, na sequência direta de D-353 (análise convergida no protocolo Claude↔Codex: "vale investigar 1 vertical adicional, mantendo contabilidade na comparação"). Objetivo: pesquisa real de mercado (não suposição) para cada nicho candidato de `first-customers-acquisition-strategy.md` §46, avaliando custo-benefício de atender mais nichos com o mínimo de ajustes de produto.

**Método:** 5 agentes de pesquisa web independentes, um por nicho, mesma disciplina de `pesquisa-concorrencia-2026-09-27.md` — nunca inventar concorrente/preço, marcar explicitamente "não encontrado" quando a busca não confirma um dado, citar URL real de cada fonte.

**Isto NÃO substitui o passo 2 do funil já recomendado em D-353** (entrevistas com clientes potenciais reais) — é pesquisa competitiva/documental, o mesmo tipo de evidência que já embasou a escolha de contabilidade como ICP, não conversa com comprador real.

---

## 1. Resultado por nicho

| Nicho | Nota | Achado central |
|---|---|---|
| **Construção civil/engenharia** | 6,5/10 | Dor real e documentada (NR-18, Súmula 331/responsabilidade solidária, ART/RRT). O caso de uso central do OmniVence é EXATAMENTE o que os concorrentes reais (Dynadok, wehandle, REGRHAN, Canteiro Online) vendem. Mas todos são venda enterprise/sob consulta, sem nenhum concorrente self-serve de baixo ticket encontrado — sinal ambíguo: pode ser espaço aberto no segmento pequeno/médio, ou sinal de que o mercado não aceita ticket baixo nesse nicho. |
| **RH/gestão de terceiros** | 6/10 | Demanda legal real e com prazo (NR-1/GRO-PGR, fiscalização punitiva a partir de 26/05/2026). Mercado dominado por venda consultiva sem preço público (Valide Soluções, BMS Integra, Senior, GT Soft, Tecnoseg — nenhum com tabela pública). Lacunas técnicas reais: dado de saúde (ASO) é dado sensível LGPD; vínculo CLT vs. PJ não modelado estruturalmente; regras condicionais por cargo/função (ex. NR-35) não são um simples Requirement por Subject. |
| **Frotas/logística** | 5/10 | Demanda legal real (CNH/CRLV/seguro), volume grande (319 mil empresas de transporte de carga, ANTT). Mas o controle de vencimento já é módulo commodity embutido em sistemas de gestão de frota (FrotaControl, Frota Certa, Sofit) — nenhum concorrente vende isso isolado. Só a cauda de frota pequena sem TMS seria plausível, sem dado de tamanho confirmado. |
| **Corretoras de seguros** | 3/10 | Mercado grande (136.505 corretores ativos, SUSEP). Mas a dor de "lembrete de renovação" já vem de graça dentro dos sistemas verticais dominantes que o corretor já paga pra cotizar/emitir (Segfy R$124,90-149,90/mês, Quiver a partir de R$99/mês, Agger). Produto não cobre o núcleo de valor desses sistemas (multicálculo, emissão, comissão) — ficaria incompleto na comparação direta. |
| **Imobiliárias/condomínios** | 3/10 | Mercado grande (161.573 condomínios, ~70 mil imobiliárias). Mesmo padrão de seguros: nenhum concorrente vende "só vencimento" separado — é sempre módulo dentro de ERP condominial/imobiliário que já é o sistema operacional do dia a dia (Superlógica, Residente Online, Imobiliária21). Concorrer exigiria deslocar orçamento de um módulo já pago dentro de um sistema maior. |

## 2. Padrão que emerge dos 5 nichos (o achado real desta pesquisa)

**Nenhum dos 5 nichos tem o mesmo "buraco" que justificou escolher contabilidade como ICP.** A pesquisa de concorrência original (`pesquisa-concorrencia-2026-09-27.md`) não achou concorrente brasileiro direto para controle de vencimentos pessoal/PME com preço público — esse é o gap que sustenta o ICP atual. Nos 5 nichos pesquisados agora, o padrão se repete de duas formas, nenhuma delas resolvida por "pequenos ajustes de produto":

1. **Venda consultiva enterprise sem preço público** (RH, frotas, construção) — o comprador típico não está acostumado a comprar esse tipo de solução por assinatura self-service; validar isso exige processo de vendas mais longo/caro, não uma mudança de copy.
2. **Feature commodity já embutida de graça num sistema maior que o cliente já paga** (seguros, condomínios/imobiliárias) — o produto concorreria por uma fração pequena do orçamento de software já comprometido, contra um recurso que "já vem junto".

**Conclusão de custo-benefício**: o custo de ENGENHARIA pra servir tecnicamente qualquer um desses nichos é de fato baixo (confirmado por D-353 — `TrackedSubjectType` já cobre as entidades certas). Mas o fator que decide se vale a pena não é esse custo — é a estrutura de distribuição/venda de cada nicho, que a pesquisa mostra ser estruturalmente mais difícil que o ICP atual em todos os 5 casos, não mais fácil. "Mínimo de ajustes" reduziria o custo de CONSTRUIR pro nicho, mas não reduz o custo de VENDER nele — que é onde a pesquisa aponta o risco real.

## 3. Recomendação

**Nenhum dos 5 nichos supera contabilidade em evidência até aqui.** Se for pra escolher 1 para testar de verdade (passo 1 do funil de D-353), a ordem por nota sugere **construção civil** (6,5) e **RH/gestão de terceiros** (6,0) como os únicos dois com dor documentada forte o bastante pra justificar uma entrevista real — mas ambos têm ressalvas que a entrevista/demo precisa resolver antes de qualquer piloto:
- Construção: descobrir se o comprador pequeno/médio aceitaria um ticket self-service, já que todo concorrente real encontrado vende sob consulta.
- RH: resolver antes do piloto o tratamento de dado sensível (ASO) sob LGPD/ANPD — não depois, como já registrado em D-353.

Seguros e condomínios/imobiliárias (3/10 ambos) não parecem valer o próximo passo do funil — o problema não é falta de mercado, é que o produto concorreria contra um recurso já embutido de graça em algo que o comprador já paga, sem um "pé na porta" óbvio.

**Nenhuma mudança de produto/copy recomendada a partir desta pesquisa isoladamente** — ela é insumo pro passo 1 (comparação) do funil já convergido em D-353, não substitui os passos 2-4 (entrevista real → demo → compromisso de piloto).
