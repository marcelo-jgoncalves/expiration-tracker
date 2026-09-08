# Full-audit round2 — Eixo: Governança Jurídica, Contratual e de Terceiros — Summary

**Status**: concluído, abaixo do gate de 9,0 dos dois lados, convergido em 2 rodadas (protocolo mínimo de 3 trocas cumprido: Rodada 1 Claude → Rodada 1 Codex → Rodada 2 Claude/tréplica → Rodada 2 Codex/confirmação). Mesmo padrão honesto do round1 deste eixo: gap estrutural real (impedimento jurídico externo + escopo de processo maior), não desacordo de critério.

## Motivação da reauditoria

Desde o round1 (nota final 5,015/10), D-231 (`docs/architecture/decisions-log.md`, 2026-09-08) introduziu o **primeiro secret de vendor externo real do repositório**: Meta Cloud API (WhatsApp Business Platform) via AWS Secrets Manager, adapter real e webhook público real — evento que exige reavaliar due diligence de terceiros, licenciamento (árvore de dependências cresceu) e compliance de termos de vendor.

## Notas por rodada

| Rodada | Claude | Codex |
|---|---:|---:|
| 1 (proposta) | 4,33 (bruto) / 4,73 (pós-fix mecânico) | 5,163 |
| 2 (tréplica/confirmação, após corrigir 2 overclaims + 2 imprecisões apontados pelo Codex) | 5,247 | 5,275 |

Diferença residual entre Claude e Codex na Rodada 2 (5,247 vs 5,275) é de 0,028 e vem de uma única nota de critério (Licenciamento OSS: Claude 6,0 vs Codex 6,2) — declarado por ambos como não-material, não reabre rodada.

## Achados reais e fixes aplicados nesta sessão

### Fix 1 — Inventário desatualizado ante D-231 (nível 1-2, corrigido)
`docs/engineering/third-party-inventory.md` ainda listava "BSP WhatsApp (não escolhido)" quando D-231 já havia implementado o canal real (código) contra a Meta Cloud API. Corrigido: linha nova nomeando o fornecedor real (Meta Platforms, Inc.), com dados tratados, criticidade, lock-in e status de DPA derivados de evidência de código, e lacunas reais marcadas como "pendente"/"não decidida" (nunca omitidas).

### Fix 2 — 2 overclaims + 2 imprecisões no fix acima, achados pelo Codex na Rodada 1 (nível 1-2, corrigidos na Rodada 2)
1. A linha dizia "em dev" — D-231 registra expressamente que `terraform plan`/`apply` desta fatia nunca rodou contra `dev` real nem foi mergeado a `main`. Corrigido para distinguir "código/infra implementados" de "deployado/verificado ao vivo".
2. Nota de rodapé (lacunas conhecidas) ainda dizia "falta todo o adapter/BSP" — desatualizada desde D-229 (fatia 2/5). Corrigida.
3. "Trocar de BSP" como descrição de lock-in é impreciso — a integração é direta com a Cloud API da Meta, não via um Business Solution Provider intermediário. Corrigido.
4. Caracterização do DPA "padrão Meta" tornada precisa: existe instrumento real (WhatsApp Business Data Processing Terms, atualizado 2025-08-22), mas sua aplicabilidade é condicional ao papel contratual e o aceite/versão/entidade contratante desta conta não estão confirmados.

## Pesquisa externa real (E-014 `SIM`, executada pelo Codex via `codex exec` com acesso à internet)

Achados citados com fonte e data (2026-09-07):
- **DPA/Data Processing Terms**: existe instrumento padrão real da Meta ("WhatsApp Business Data Processing Terms", `whatsapp.com/legal/business-data-processing-terms`, atualizado 2025-08-22) equivalente em função ao AWS DPA já citado no inventário — mas aplicabilidade condicional (só vale quando os Business Terms qualificam o WhatsApp como operador) e aceite para a conta deste projeto não confirmado.
- **Transferência internacional**: addendum próprio (`business-data-transfer-addendum`, 2024-02-16) cobre EU-US DPF/SCCs — não resolve LGPD, mas mostra maturidade contratual do fornecedor.
- **Região/residência**: Meta oferece "local storage" configurável por número; Brasil é região suportada, mas não escolhida/configurada nesta sessão. Processamento transitório ("data in use", TTL até 60 min) pode ocorrer fora da região escolhida mesmo com local storage ativo.
- **Categoria de mensagem (D-4)**: confirmado que fora da janela de 24h só um template aprovado pode ser enviado — mas o Codex corrigiu uma imprecisão: "Utility, nunca Marketing" não é a regra geral da Meta (Marketing também pode iniciar conversa fora da janela, com opt-in), e existe uma terceira categoria (Authentication) não citada no comentário do código. O comportamento real do código (só envia templates Utility pré-provisionados) permanece correto e mais conservador que o mínimo exigido — o achado é de precisão do **comentário/documentação** do adapter, não do comportamento. Registrado como achado residual nível 1-2 para sessão futura que toque o módulo notification (fora do escopo desta auditoria jurídica corrigir código de produção).
- **Retenção/exclusão**: termos de distribuição exigem cessação de uso e exclusão de dados após encerramento (com ressalvas legais/backup), e notificação de incidente "without undue delay" — compatível em direção com o critério LGPD art. 39 usado neste projeto, mas sem SLA numérico equivalente.

## Achados classificados (convergência Rodada 2)

**Bloqueante real antes de habilitar WhatsApp para usuário real** (nenhum corrigível por edição de documento nesta sessão):
- Publicar aviso de privacidade/termos compatíveis com a política da Meta (opt-in/opt-out documentado ao titular).
- Confirmar e registrar formalmente o DPA/termos efetivamente aceitos pela WABA, entidade contratante e papéis Meta/WhatsApp.
- Decidir/configurar residência de dados (incluindo avaliação de "local storage" BR).
- Corrigir o comentário de `whatsapp-cloud-api-adapter.ts` sobre categoria de mensagem (achado de precisão, nível 1-2, ver acima) — registrado para sessão que toque o módulo.

**Escopo maior** (processo/ferramenta a construir, não texto a escrever):
- Governança contínua de licenças (gate de CI, allow/denylist, resolução formal de `jszip` dual-license e da licença "Custom" de `buffers@0.1.1`).
- Runbook de saída de fornecedor Meta (revogação de credencial, desregistro de webhook/número, tratamento de templates).
- Processo de recebimento/avaliação de mudanças de termos Meta (já há atualização futura anunciada para 2026-09-23 — risco de drift não é hipotético).
- Owner jurídico/compliance nominal e cadência de revisão regulatória.

**Impedimento externo genuíno**:
- Parecer jurídico sobre controlador/operador, LGPD, transferência internacional e bases legais.
- Revisão jurídica formal do DPA/Business Terms para a conta brasileira específica.
- Aceite contratual real (clickwrap) pelo titular da conta Meta, fora do alcance de uma sessão de engenharia.

## Nota ponderada final registrada: 5,275/10 (Codex, Rodada 2) / 5,247/10 (Claude, Rodada 2)

Ambas abaixo do gate de 9,0, convergentes (diferença 0,028, não-material, mesma classificação de causa). Não reaberto para Rodada 3 — mesma disciplina do round1: gap real, honestamente classificado, não fabricado para forçar uma nota mais alta.
