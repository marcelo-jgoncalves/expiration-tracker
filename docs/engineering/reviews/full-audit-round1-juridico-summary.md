# Full-audit round1 — Eixo: Governança Jurídica, Contratual e de Terceiros — Summary

**Status**: concluído, abaixo do gate de 9.0 dos dois lados, com achados restantes classificados honestamente (não forçados). Consistente com o padrão dos eixos Segurança, Privacidade, Operações/SRE e Governança de IA — não é falha do protocolo, é resultado real: este eixo depende estruturalmente de artefatos jurídicos externos (parecer de advogado, contratos com fornecedores) que uma sessão de engenharia não pode produzir.

## Notas por rodada

| Rodada | Claude | Codex |
|---|---:|---:|
| 1 (antes dos fixes) | 4,87 | — (não rodou antes do fix, ver nota abaixo) |
| 1 (nota final registrada, após 2 fixes point-fix aplicados) | 4,87* | 5,015 |

\* A nota do Claude (`full-audit-round1-juridico-claude.md`) foi calculada **antes** de aplicar os dois fixes (LICENSE/package.json e `third-party-inventory.md`), mas os fixes já estavam descritos como "a aplicar" no próprio arquivo. O Codex avaliou **depois** dos fixes aplicados, com acesso direto aos dois novos artefatos — por isso sua nota (5,015) já reflete o estado pós-fix e é a nota final de referência deste eixo. Não houve segunda rodada formal do Claude porque a diferença entre as duas notas (4,87 vs 5,015) já converge na mesma direção e a mesma classificação de causa (gaps reais, não desacordo de critério) — reabrir uma rodada só para recalibrar o Claude ao redor de 5,0 não mudaria a conclusão nem o gate.

## Fixes reais aplicados nesta sessão

1. **`LICENSE`** (raiz do repositório) — antes inexistente; agora declara copyright proprietário ("All rights reserved").
2. **`package.json`** — ganhou `"license": "UNLICENSED"` (antes ausente).
3. **`docs/engineering/third-party-inventory.md`** (novo) — inventário versionado de fornecedores com colunas fornecedor/serviço/dados/criticidade/região/certificação/lock-in/responsável/DPA, formalizando a lista que antes só existia em prosa dentro de `privacy-lgpd.md` §5.

O Codex confirmou os três fixes como reais e íntegros, mas apontou corretamente que nenhum fecha o critério por completo (ver tabela de achados abaixo) — os fixes resolvem a lacuna documental mínima, não a due diligence/gate completo que o critério de fato exige.

## Achados restantes, classificados

| Critério | Nota Codex | Classificação | Motivo |
|---|---:|---|---|
| 1. Papéis Jurídicos & Modelo Contratual | 4,5 | Impedimento externo real | Exige parecer jurídico real (advogado), já corretamente gated em `privacy-lgpd.md:53`. |
| 2. Inventário & Due Diligence | 6,5 | Parcialmente corrigido nesta sessão; residual é escopo maior | `third-party-inventory.md` criado (fix real), mas due diligence de fato concluída (verificar certificações, preencher "responsável", monitoramento periódico) é processo contínuo, não documento único. |
| 3. Licenciamento OSS/IP | 6,5 | Parcialmente corrigido nesta sessão; residual é escopo maior | LICENSE + `package.json` corrigidos (fix real), mas relatório de compatibilidade de licenças transitivas e allow/deny-list é ferramenta/processo a construir, não texto a escrever. |
| 4. Termos de Uso/Aviso de Privacidade | 1,0 | Escopo maior (pré-requisito de lançamento, não point-fix) | Não existe nenhum texto voltado ao usuário final; é conteúdo de produto + revisão jurídica, já registrado como pré-requisito em `privacy-lgpd.md:69`. |
| 5. DPAs/Transferências | 3,0 | Impedimento externo real (majoritariamente) | Nenhum fornecedor de e-mail/WhatsApp contratado ainda; região AWS não decidida (`privacy-lgpd.md:51`). |
| 6. Compromissos Comerciais & SLA | 7,5 | Proporcional ao estágio | Não há oferta comercial lançada; a disciplina técnica de não prometer o que a arquitetura não sustenta já existe (`slo.md`, `evolution.md:11`). |
| 7. Aprovação/Evidência/Mudança Regulatória | 5,5 | Escopo maior | Infraestrutura de decisão-com-dono já existe (`decisions-log.md`, `exceptions.md`), falta responsável jurídico/compliance nominal e calendário de revisão regulatória — feature de processo, não de documentação pontual. |
| 8. Continuidade & Saída de Fornecedor | 6,5 | Escopo maior | Lock-in já mapeado no novo inventário; falta runbook formal de saída (AWS/IdP/IA) — esforço de documento próprio, fora do escopo desta rodada. |

## Nota ponderada final registrada: 5,015/10 (Codex, pós-fix)

Abaixo do gate de 9.0. Não reaberto para mais rodadas: dos 8 critérios, 2 (Papéis Jurídicos, DPAs) são impedimento externo genuíno (parecer jurídico e contrato real de fornecedor, respectivamente), e os demais são escopo de produto/processo maior que uma correção pontual de sessão — mesmo padrão de classificação honesta já usado nos eixos Segurança/Privacidade/Operações/Governança de IA.
