# M4 — Nota cega de Claude, Rodada 3 (confirmação)

Avaliado: `docs/architecture/m4-notification-engine-design.md` (rodada 3) com os 7 fechamentos incorporados como texto normativo. Nota cega — ainda não vi a nota do Codex para esta rodada.

## Nota: 9.2/10

Bate o gate. Os 5 achados combinados de rodada 2 (lookup pointer, correlação de callback/GSI5, REPLACEMENT vs CORRECTIVE, política UNKNOWN, rate limiting) e os 2 exclusivos de Claude (DLQ do callback, teste cross-tenant) foram todos convertidos em texto normativo fechado, não mais "proposta"/"item aberto". Nenhum deles exige mais decisão de produto ou custo — são especificação técnica suficiente para começar a implementação.

Não vejo achado novo que impeça 9.0. Duas observações menores, não bloqueantes (registro para a implementação, não para a nota):

1. O fechamento #3 (REPLACEMENT/CORRECTIVE) menciona "templates distintos" mas não especifica se o template de `REPLACEMENT` é literalmente o mesmo template do envio normal (`expiration-reminder`) ou um template novo — presumo que é o mesmo (é logicamente "a primeira comunicação real", só que atrasada por uma mudança de versão antes do envio), e só `CORRECTIVE` precisa de um template dedicado que menciona a correção. Isso deveria ficar explícito na primeira PR de implementação, mas não bloqueia o design.
2. O fechamento #2 diz que a validação das tags SES é "primeiro passo da implementação" — isso é correto, mas vale registrar que se a validação falhar (tags não sobrevivem no evento SES real), o fallback já especificado (UNMATCHED sem tenant confiável) precisa ser o comportamento *default* do dia 1 da Camada 1, não algo escrito só depois do spike. Já é isso que o texto diz, só reforçando que não deveria haver um "período de transição" sem esse fallback implementado.

## Veredito

**APPROVED** do lado de Claude, condicionado à mesma nota ≥9.0 do Codex.
