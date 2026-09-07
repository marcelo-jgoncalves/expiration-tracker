NOTA: 8.6

A Rodada 2 resolve a maior parte das críticas, mas ainda não está pronta para liberação de
implementação.

- Mutabilidade: resolvida conceitualmente. `updateSeriesRecipient` evita quebrar identidade e
  histórico. Falta explicitar que `null` gera `REMOVE recipientEmail` no DynamoDB, não persistência
  de `null`, preservando o tipo `recipientEmail?: string`.
- Snapshot: resolvido. Captura na materialização, atualização só para requests futuros, nenhuma
  alteração retroativa.
- Mudança após materialização: resolvida, com teste de preservação do request anterior e uso do
  novo valor no ciclo seguinte.
- Action de autorização: reuso confirmado e apropriado. `docarchive:series-update` já existe, está
  em `WRITE_ROLES`, distingue precisamente edição interativa de materialização. Action dedicada não
  acrescentaria separação de privilégio útil agora.
- PII/exposição: parcialmente resolvida. "Não é dado sensível de terceiro" é incorreto — continua
  sendo PII de terceiro. A conclusão de não mascarar pode ficar, mas a justificativa precisa ser
  "tratamento autorizado e necessário ao tenant", não "ausência de PII". Faltam testes de exposição
  em `getSeries`/`listSeries` (pedidos na Rodada 1, omitidos na Rodada 2).
- Normalização: parcialmente resolvida. Falta definir ordem (normalizar antes ou depois da
  validação de schema) e testes para espaços/caixa/string vazia/remoção. Lowercase de todo o
  endereço é uma política a declarar conscientemente — a parte local do e-mail não é universalmente
  case-insensitive.
- Plano de testes: substancialmente melhor, mas ainda falta `getSeries`/`listSeries`, casos de
  normalização, e a representação persistida após `null`.
- Estado da série: lacuna nova — não diz se `updateSeriesRecipient` pode alterar série `CANCELLED`.
  Sem reativação, o mais coerente é rejeitar.
- Classificação de risco: a defesa via D-228 não fecha a objeção. D-228 classificou SUA PRÓPRIA
  implementação 3-4, mas registrou ESTE ponto como pendência de produto — não o aprovou. Há agora
  semântica nova de mutabilidade/remoção/snapshot + rota HTTP nova + schema novo. Pela redação da
  própria régua ("muda contrato", "novo formato de schema") e a regra de subir na dúvida, deveria
  ser Nível 5. D-228 é evidência técnica, não exceção normativa à escala.

Antes de implementar: (1) reclassificar Nível 5; (2) especificar `null`→remoção de atributo; (3)
decidir comportamento para série cancelada; (4) corrigir caracterização de PII; (5) fechar
ordem/semântica de normalização; (6) acrescentar testes ausentes; (7) cumprir rodada 3 e gate
mínimo 9.0 de ambos, exigido pelo protocolo para Nível 5.
