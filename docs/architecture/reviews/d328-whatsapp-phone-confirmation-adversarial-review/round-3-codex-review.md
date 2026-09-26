# D-328 — Codex, rodada 3

Nota cega: 7.2/10. Não aprovo nesta rodada. O arquivo de autoavaliação do Claude não foi aberto.

## Achados reproduzidos

1. **Alta — identidade do desafio ainda vulnerável a reutilização de versão.** Em `whatsapp-phone-confirmation-service.ts:122,142`, o reenvio calcula v+1 a partir de uma leitura e depois faz Put incondicional. Reprodução: reenvio lê A/v1 e pausa em send; tentativa errada avança A para v2; confirmação correta de A lê v2 e pausa antes da transação; reenvio grava B/v2; confirmação de A grava confirmedAt sobre B e executa setPhoneNumber/recordOptIn. Nenhum conflito ocorre, logo a comparação de hashes do retry não roda. Tornar a substituição condicional e identificar cada geração do desafio; incremento calculado no cliente sozinho não garante monotonicidade.
2. **Média — orçamento não respeitado sob concorrência.** `incrementAttemptCountWithRetry` não revalida o limite, e `setConfirmedAtWithRetry` tampouco revalida attemptCount. Dez códigos errados distintos, iniciados com attemptCount=4, deixam attemptCount=9. Outro cenário: confirmação correta lê count=4, quinta falha é persistida, confirmação perde OCC mas retenta e sucede com count=5. Consumir/reservar o orçamento atomicamente antes de permitir a verificação e revalidar as precondições após conflito. Cinco retries não equivalem a cinco tentativas de código.
3. **Média — retry de confirmação ignora expiração.** `setConfirmedAtWithRetry:253-269` captura now uma vez, relê o desafio depois de conflito e retenta sem checar expiresAt. Reprodução avança o relógio para +11min depois do conflito e ainda obtém sucesso, com confirmedAt retrodatado. Revalidar a expiração com relógio atual a cada nova tentativa. O replay +24h no atalho já confirmado foi, de fato, corrigido e passou na verificação positiva.
4. **Alta — logout global retorna sucesso sem revogar após esgotar retries.** `global-user-repository.ts:136-154` termina o laço sem throw. Cinco chamadas reais concorrentes a setPhoneNumber causam cinco conflitos: logoutAll resolve e globalLogoutAfter continua ausente. O BFF prossegue para logout apenas da sessão atual. Propagar falha ao esgotar retries; só retornar sucesso com revogação persistida ou já satisfeita.
5. **Alta — watermark de logout pode retroceder.** `logoutAll:135,141,151` reutiliza now inicial depois de reler um watermark mais novo. Reprodução: logout A captura 00:00 e pausa; B persiste 00:01; A perde OCC, relê e sobrescreve com 00:00. O resolver compara issuedAt com globalLogoutAfter (`resolve-request-context.ts:92`), logo tokens entre os dois instantes voltam a passar esse bloqueio. Preservar o máximo entre watermark existente e solicitado. O overwrite anterior também permitia esse problema; a conversão atual não o fecha.

## Correções reconhecidas e testes

- A expiração no atalho confirmedAt rejeita o replay correto +24h sem chamar setPhoneNumber novamente.
- O SET parcial de logoutAll preserva phoneE164; o tableName foi propagado no BFF corretamente.
- logoutDevice escreve SESSION#deviceId, não PROFILE: não é o concorrente apontado.
- O teste de reenvio detecta a mutação específica version=1, mas não intercala o envio pendente com incremento e confirmação reais.
- O primeiro teste novo de logout prepara o telefone antes da leitura de logoutAll: o antigo Put integral também preservaria esse telefone nesse cenário. O segundo força um conflito real na chamada do método, mas não cobre esgotamento nem watermark regressivo. O teste antigo de setPhoneNumber continua construindo a escrita obsoleta no próprio teste.

## Evidência

Reprodução local com serviços reais e stores em memória, sem modificar src ou os testes existentes:

```powershell
node --require ./docs/architecture/reviews/d328-whatsapp-phone-confirmation-adversarial-review/round-3-codex-loader.cjs docs/architecture/reviews/d328-whatsapp-phone-confirmation-adversarial-review/round-3-codex-repro.ts
```

Resultado: seis contraexemplos reproduzidos (REPRO 1-6), uma verificação positiva PASS. São asserções do comportamento defeituoso atual, não uma suíte de regressão que certifica correções. O loader usa TypeScript.transpileModule e não executa typecheck.

`npm test -- test/unit/notification/whatsapp-phone-confirmation-service.test.ts test/unit/notification/whatsapp-phone-confirmation.test.ts test/unit/identity/global-user-repository.test.ts` não iniciou: esbuild recebeu Access denied ao resolver vitest.config.ts no sandbox. Não declaro a suíte verde nem validação em DynamoDB real.

Semântica de substituição do Put e necessidade de condição verificadas na [API oficial PutItem](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html) e na [documentação oficial de optimistic locking](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBMapper.OptimisticLocking.html).

DoD: item=revisão adversarial D-328 R3; risco=entregável de revisão de segurança submetido ao protocolo, sem alteração de produção; evidência=inspeção e seis contraexemplos locais, replay +24h rejeitado; lacunas=cinco achados abertos, Vitest impedido pelo sandbox, protocolo não convergido. Skill task-checklist aplicada: não há implementação concluída nem milestone fechado nesta revisão.

NOTA_CODEX: 7.2
