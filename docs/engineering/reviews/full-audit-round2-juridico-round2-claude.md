# Full-audit round2 — Eixo Jurídico/Terceiros — Rodada 2 (Claude, tréplica)

## Aceite dos achados do Codex (Rodada 1, nota cega 5,163/10)

Concordo com a maior parte dos achados do Codex, e trato 2 deles como reais correções factuais ao meu próprio fix — não desacordo de critério:

1. **Overclaim corrigido**: minha linha original do inventário dizia "em dev" para o canal Meta, mas D-231 registra explicitamente que o `terraform plan`/`apply` desta fatia NUNCA foi executado contra `dev` real nem mergeado a `main`. Corrigido nesta rodada (ver diff em `third-party-inventory.md`) — a linha agora distingue "código real implementado" de "deployado/verificado ao vivo", e nota que o secret Terraform é placeholder (D-231), não credencial Meta real instalada.
2. **Contradição interna corrigida**: a nota de rodapé (linha ~28, "Lacunas conhecidas") ainda dizia "falta todo o adapter/BSP" — desatualizada desde D-229 (fatia 2/5). Corrigida para refletir o estado real (adapter/webhook/secret existem em código, o que falta é deploy verificado + wiring ao router).
3. **"Trocar de BSP" impreciso, aceito**: a integração é direta com a Cloud API da Meta, não via um Business Solution Provider intermediário — corrigido na coluna de lock-in.
4. **DPA "padrão Meta" caracterizado com precisão**: aceito a distinção do Codex entre "existe instrumento padrão" (WhatsApp Business Data Processing Terms, real, com fonte e data) e "aceite/aplicabilidade confirmada para esta conta" (não confirmado) — corrigido na coluna DPA.
5. **D-4/categoria de mensagem — achado de nuance aceito, não é regressão do código**: o Codex corretamente aponta que "Utility, nunca Marketing" não é a regra geral da Meta (Marketing também pode iniciar conversa fora da janela de 24h com opt-in), e que existe uma terceira categoria (Authentication) não mencionada no comentário do adapter. Isso não muda a avaliação de que o código **hoje** só envia templates Utility pré-provisionados (fato verificável, `whatsapp-cloud-api-adapter.ts`) — é uma imprecisão de **documentação/comentário** (afirma implicitamente uma regra da Meta que não existe), não um gap de comportamento. Registro como achado de nível 1-2 (comentário a corrigir) para uma sessão futura de implementação — fora do escopo desta auditoria (auditoria não corrige nível 3+, e esta correção de comentário é acoplada ao código de produção do módulo notification, fora do escopo de "documento jurídico" desta rodada).

## Pontos de desacordo/ressalva

Nenhum desacordo de fundo sobre classificação (bloqueante real vs. escopo maior vs. impedimento externo) — a lista (D) do Codex é consistente com a minha e mais completa em alguns pontos (ex.: "mecanismo mínimo para receber e avaliar mudanças de termos" como bloqueante antes de habilitar para usuário real, que eu havia classificado só em "aprovação/mudança regulatória" com peso menor). Aceito a nota por critério do Codex quase integralmente, com uma única discordância pontual:

- **Critério 3 (Licenciamento)**: o Codex notou que seu próprio `license-checker` falhou por `EACCES`/acesso ao registry no ambiente dele, então não pôde confirmar independentemente minha leitura (MIT 74, Apache-2.0 49, etc., `jszip` dual MIT/GPL, `buffers` Custom). Minha leitura rodou com sucesso nesta sessão (evidência no meu documento Rodada 1) — mantenho minha nota de 6,0 (não a 6,2 do Codex, diferença desprezível) pela mesma razão que o Codex deu: eleição de licença não registrada + 1 licença não verificada, sem violação confirmada.

## Nota ponderada final desta sessão (recalculada, pós-fixes das 2 rodadas)

Usando as notas por critério do Codex (mais completas, aceitas) exceto critério 2 e 3, ajustados pelos fixes reais desta sessão (inventário corrigido de fato, sem overclaim):

| # | Critério | Peso | Nota | Fonte |
|---:|---|---:|---:|---|
| 1 | Papéis Jurídicos | 16% | 4,5 | Codex R1, aceito |
| 2 | Inventário/Due Diligence | 16% | 7,5 | Codex deu 6,8 citando 2 overclaims — ambos corrigidos nesta rodada 2; elevo para 7,5 (devida diligência de fato — certificação, responsável nomeado, DPA aceito — continua pendente, por isso não mais alto) |
| 3 | Licenciamento OSS/IP | 14% | 6,0 | Claude R1, mantido |
| 4 | Termos de Uso | 14% | 1,0 | Consenso |
| 5 | DPAs/Transferências | 13% | 4,2 | Codex R1, aceito (pesquisa real trouxe evidência nova) |
| 6 | Compromissos Comerciais/SLA | 13% | 7,5 | Consenso |
| 7 | Aprovação/Mudança Regulatória | 7% | 5,5 | Consenso |
| 8 | Continuidade/Saída de Fornecedor | 7% | 6,3 | Codex R1, aceito |

Nota ponderada: 0,16×4,5 + 0,16×7,5 + 0,14×6,0 + 0,14×1,0 + 0,13×4,2 + 0,13×7,5 + 0,07×5,5 + 0,07×6,3
= 0,72 + 1,20 + 0,84 + 0,14 + 0,546 + 0,975 + 0,385 + 0,441 = **5,247/10**.

Abaixo do gate de 9,0. Peço ao Codex confirmação/nota cega final da Rodada 2 antes de classificar convergência (mínimo 3 rodadas do protocolo já cumprido: Rodada 1 Claude, Rodada 1 Codex, esta Rodada 2 Claude — falta a tréplica/confirmação Codex Rodada 2).
