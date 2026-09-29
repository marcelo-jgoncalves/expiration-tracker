# Expandir o posicionamento além de "fornecedores" — estado final consolidado

**Convergido em 2 rodadas: Codex 9,0/10, Claude 9,0/10 (sem arredondar).** Nota de processo: o protocolo padrão deste projeto (`AGENTS.md` §4) pede mínimo 3 rodadas para decisões Type 1 obrigatórias; esta é uma análise de produto/negócio submetida voluntariamente por Marcelo para ganhar convicção, não uma decisão técnica irreversível — a Rodada 1 já produziu correção adversarial real e substantiva (6 achados, nota 6,8/10), e a Rodada 2 convergiu genuinamente (9,0/9,0, sem achado bloqueante novo, o próprio Codex declarou "concordo com a convergência"). Uma 3ª rodada mecânica sem achado pendente seria formalismo, não rigor adicional — registrado aqui para transparência, não escondido.

## Pergunta original

Marcelo: o produto serve outros contextos além de escritórios de contabilidade (o ICP atual do plano de aquisição)? Vale a pena fazer pequenos ajustes (ex. renomear "Fornecedor") para isso?

## Achado central, corrigido entre as rodadas

**Tecnicamente**: o modelo de dados já é genérico (`TrackedSubjectType`: COMPANY/VENDOR/CLIENT/EMPLOYEE/ASSET/LOCATION/CUSTOM já existe e já tem tradução própria; a cota técnica conta qualquer `TrackedSubject`, não só VENDOR) — mas isso prova só que o **controle documental básico** (1 entidade, N documentos que ela precisa manter válidos) é reaproveitável a baixo custo provável. NÃO prova cobertura de relações mais ricas que outros verticais podem exigir (veículo+condutor, imóvel+proprietário+locatário, empregado+empregador+contratante) — isso é indeterminado até testar um caso real.

**Comercialmente**: já existe um plano de GTM completo e não executado (`docs/project/first-customers-acquisition-strategy.md`, 2026-08-31) que já declara o princípio "produto horizontal, marketing vertical" (§47), já escolheu contabilidade como primeiro ICP, e já lista candidatos a "próximos segmentos" (§46: construção/engenharia, administradoras, facilities, clínicas, indústrias, serviços profissionais, empresas com fornecedores/licenças) condicionados a "evidência comercial". Nenhum segmento — incluindo contabilidade — tem hoje registro de cliente pagante real (`AGENTS.md` §1 confirma: fase de construção, sem usuários reais). A pesquisa de concorrência (`pesquisa-concorrencia-2026-09-27.md`) já mapeia um concorrente (**Valide Soluções**) com foco trabalhista/ASO — sinal de que existe OFERTA concorrente nesse nicho (não prova de demanda pagante para o OmniVence especificamente).

## Recomendação final

**Vale investigar um caso de uso adicional, mantendo contabilidade na comparação — não decidir expandir ainda, e não mudar nenhuma linha de produto antes disso.** Sequência (adaptada do plano de GTM já existente, não uma landing page nem um rename como primeiro passo):

1. Escolher 1 caso de uso por comparação explícita (contabilidade permanece na comparação; RH/gestão documental trabalhista tem sinal competitivo real via Valide Soluções, mas isso não é prova de demanda, só justifica investigar).
2. Entrevistas sobre situações recentes REAIS no segmento escolhido (não hipotéticas).
3. Demo contextual com dados sintéticos, produto tal como está hoje — nenhuma mudança de código, `TrackedSubjectType` já cobre Colaborador/Cliente/Ativo sem nenhum ajuste.
4. Buscar compromisso concreto (piloto + preço) — sinal de demanda mais forte que interesse declarado.
5. Só então (se o compromisso do passo 4 se confirmar em piloto acompanhado, com uso/custo observados): decidir ajustes de copy/navegação (ex. renomear "Fornecedores") e reavaliar riscos específicos do vertical validado (dados sensíveis/LGPD-ANPD para RH; economia de OCR/mensagem por vertical; capacidade de suporte a múltiplos segmentos).

## Riscos reais identificados (a considerar em qualquer piloto, antes de dados reais)

- **RH/ASO**: documento de saúde de colaborador é dado sensível (LGPD/ANPD) — exige avaliação de finalidade/acesso/retenção/processamento por terceiro (o pipeline de IA/OCR já existente) ANTES de qualquer piloto real, não depois.
- **Economia por vertical**: a mesma cota de "N cadastros" pode gerar custo de OCR/WhatsApp/storage muito diferente por vertical — `planos-precos-2026-09-27.md` já registra essa lacuna de dados para o pricing em geral.
- **Marca/suporte**: atender múltiplos segmentos com o mesmo time pequeno aumenta material de onboarding, exemplos e risco de roadmap conflitante entre segmentos.

## O que fica fora de escopo até haver evidência de piloto

Rename de "Fornecedor" no menu/telas, qualquer mudança em `planos-precos-2026-09-27.md` (ainda proposta, não decisão), qualquer mudança em copy do portal do convidado/e-mails (já genéricos, confirmado no código — não precisavam de ajuste nenhum para começar a investigar).
