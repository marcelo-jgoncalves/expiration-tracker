**8.6/10** (registrada antes de rodar o Codex nesta rodada).

Os 3 achados diretamente dentro do escopo de D-315/D-316 (preference nunca seedado, approximate
nunca lido, agregação bloqueando a tabela) foram corrigidos com testes reais de mutação, incluindo
o caso não-trivial da reativação de Membership preservando uma `NotificationPreferences` real via
`if_not_exists()`. Os 3 achados do worker M4 (DEFERRED nunca reagendado - inclusive um comentário
de código FALSO que afirmava um mecanismo inexistente -, FAILED_RETRYABLE confirmado como sucesso,
falta de revalidação pré-envio) foram verificados como reais e registrados, não corrigidos, por
proporcionalidade de escopo. Não é mais alta porque: (1) o Achado 2 é sério o bastante (perda
silenciosa e permanente de notificações com quiet hours configurado) que registrar sem pelo menos
uma correção mínima ao comentário falso do código é desconfortável - fiz a correção do comentário,
mas não fechei o mecanismo em si; (2) ainda não tenho certeza se o Codex vai concordar que
achados 2/3/6 são genuinamente fora de proporção, ou se vai insistir que fazem parte do "a trilha
completa funciona" que ele exigiu na Rodada 1.
