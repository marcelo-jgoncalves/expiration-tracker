---
status: review-complete-protocol-pending
owner: engineering
authority: evidence
---

# D-328 — Rodada 5, parecer Codex

**Nota técnica: 9.0/10.** R4-1 e R4-3 fechados; R4-2 fecha o cenário reportado, mas tem um residual raro de baixa severidade. Não encontrei novo bloqueador de segurança nas três mudanças. A nota não representa fechamento formal de D-328.

**Nota cega comprometida:** não abri `round-5-claude-selfgrade.md`. Depois de ler os três arquivos solicitados na ordem indicada, li `NEXT_SESSION_PROMPT.md` conforme o início de sessão do repositório. O item 26 expõe a auto-nota desta rodada. Portanto, este parecer não pode ser registrado como avaliação estritamente cega. A nota acima é sustentada pelas evidências abaixo, mas isso não restaura o isolamento perdido.

## Correções

- **R4-1 fechado:** a expiração do estado fresco é checada antes do retorno por `confirmedAt`. Reprodução independente na borda: confirmação pausada às 00:09:59, duplicata confirma, primeira chamada retoma às 00:10:01; rejeita e não repete a escrita do telefone.
- **R4-2 fechado no interleaving original:** B pausa na escrita; C persiste com timestamp posterior e código diferente; B adota C, sem modificar o registro. Uma nova chamada imediata é rejeitada pelo cooldown. Reproduzi também duas criações iniciais concorrentes pelo caminho `putIfAbsent`.
- **R4-3 fechado:** telefone inválido rejeita sem envio. A expressão “antes de qualquer I/O” é imprecisa: `isWhatsAppChannelEnabled()` ainda é aguardado antes da validação. A garantia relevante, antes do envio e da leitura/escrita do desafio, está cumprida.

## Residual R5-1 — Baixa: repetição do código original neutraliza a adoção

Em `whatsapp-phone-confirmation-service.ts:196`, `fresh.codeHash !== initial.codeHash` distingue valores de código, não gerações de desafio. O HMAC recebe apenas o código de seis dígitos; repetir o código repete o hash, sem exigir colisão criptográfica.

Reprodução determinística, substituindo somente o sorteio no processo de teste:

1. A tem código `111111`.
2. B gera `222222` às 00:01:01 e pausa antes da escrita.
3. C gera `111111` às 00:02:02 e persiste.
4. B retoma, perde OCC, encontra hash igual ao de A e sobrescreve C com `createdAt=00:01:01`.
5. Outro envio às 00:02:02 é aceito imediatamente.

A chance de um sorteio uniforme repetir aquele código específico é 1 em 1.000.000; o interleaving concorrente também precisa ocorrer. Por isso classifico como baixa severidade, não reabro os quatro achados graves anteriormente fechados e não trato este residual como bloqueador isolado. Ainda assim, “createdAt nunca regride” não está plenamente demonstrado. A correção deve distinguir a geração do desafio independentemente do segredo curto; `version` isolado não serve, pois também muda em tentativas e confirmação. Acrescentar regressão com sorteio repetido.

## Julgamento sobre o código perdedor

Aceito manter apenas o desafio vencedor como compromisso limitado, junto da limitação já registrada de envio duplo. **O vencedor é quem persiste primeiro, não necessariamente a solicitação ou mensagem mais recente.** Reproduzi B enviando antes de C, C pausando na escrita, B persistindo e C adotando B: o código da última mensagem enviada é inválido.

Registrar explicitamente essa semântica; não orientar “use sempre o último código” como garantia. Um aviso isolado não identifica qual mensagem venceu. Se o requisito de produto for que a última solicitação sempre tenha código utilizável, esta implementação não o satisfaz: será necessário arbitrar os envios. Não considero necessário redesenhar o envio nesta rodada apenas para aprovar as correções locais.

## Evidência e limites

- 21/21 testes do serviço passaram via API programática `vitest/node`, configuração inline, após o comando convencional falhar ao carregar a configuração por acesso negado do sandbox.
- [Reprodução independente](round-5-codex-repro.ts): serviços reais com stores in-memory, pausas assíncronas, relógio injetado; seis cenários executados com assertions, incluindo o residual e a ordem inversa da corrida. Executar com o loader já registrado na rodada 3:

```powershell
node --require ./docs/architecture/reviews/d328-whatsapp-phone-confirmation-adversarial-review/round-3-codex-loader.cjs ./docs/architecture/reviews/d328-whatsapp-phone-confirmation-adversarial-review/round-5-codex-repro.ts
```

- Sem execução contra AWS/WhatsApp reais, sem reexecução própria das mutações declaradas pelo Claude e sem alteração funcional. Esta rodada não repete a auditoria de logout.
- As ressalvas de cobertura da rodada 4 sobre o teste de orçamento e o interleaving de três atores não foram corrigidas pelos três testes novos; permanecem oportunidades de reforço, sem evidência de regressão funcional nesta revisão.

Skill `/task-checklist` aplicada ao escopo de revisão/evidência, sem fechamento da implementação. Eixos avaliados: consistência/concorrência, qualidade dos testes, segurança, contexto e integridade da nota cega; demais eixos não alterados. Sem novo padrão AWS ou decisão arquitetural implementada.

DoD: item=revisão D-328 R5; risco=avaliação e artefatos de evidência, sem alteração funcional; evidência=21/21 testes e seis cenários independentes; lacunas=residual R5-1 baixo, limitações de cobertura herdadas, nota cega comprometida; D-328 permanece em protocolo.

Pela exigência de duas rodadas consecutivas indicada nesta submissão, 8.4 na R4 e 9.0 na R5 não constituem convergência. Além disso, a exposição da nota impede contar esta avaliação como rodada cega válida sem tratar explicitamente esse incidente de processo.

NOTA_CODEX: 9.0
