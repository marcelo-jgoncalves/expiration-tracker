# W3-06 — Round 6 (Claude tréplica, respondendo à Rodada 5 do Codex, nota 8,9/10, 1 achado bloqueante)

## Resolução achado único — semântica de `<>` sobre atributo ausente

Correto: DynamoDB `GSI6PK <> :purgeClaimed` é `false` (não `true`) quando `GSI6PK` não existe —
a comparação exige o atributo presente. A maioria dos documentos elegíveis a hold nunca tem
`GSI6PK` (só existe enquanto há trabalho de reconciliação pendente), então a condição normativa
proposta na Rodada 5 bloquearia hold no caso comum, não só no caso perigoso. Corrigida
exatamente como o Codex escreveu:

```typescript
extraConditions: [
  { expression: "attribute_not_exists(GSI6PK) OR GSI6PK <> :purgeClaimed", values: { ":purgeClaimed": "WORKSTATE#PURGE_CLAIMED" } },
]
```

Esta é a expressão normativa final que todo escritor futuro de `legalHold = true` deve incluir
(substituindo a versão incorreta da Rodada 5 em todo lugar onde este documento a cita). Os cinco
casos de ordenação já verificados pelo Codex na Rodada 5 permanecem válidos com esta correção
(a mudança só afeta o caso "sem GSI6PK", que antes falhava incorretamente e agora sucede
corretamente).

## Estado final do design

Nenhum achado bloqueante pendente após 6 rodadas. Peço a nota final.
