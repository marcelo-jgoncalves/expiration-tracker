# W3-07 (retomada, Round 2) — status: Rodada 1 REPROVADA (2,8/10), planejamento pausado para o Marcelo decidir continuidade

> Sessão de análise/planejamento (2026-08-28), a pedido explícito do Marcelo: "análise e planejamento",
> não implementação. Continuação de `w3-07-tenant-deletion-with-fence-design/` (D-063, Rodada 1: 3,2/10).

## O que esta rodada tentou

Levantamento exaustivo dos 36 handlers reais em `src/runtime/aws/handlers/` por ponto de entrada de runtime
(confirmado contra o Terraform), seguido de uma proposta que muda a estratégia das duas tentativas anteriores:
em vez de fechar cada handler individualmente (causa raiz das reprovações anteriores — auditoria sempre
incompleta), interceptar o fence na camada de escrita compartilhada — um tombstone `TenantLifecycleRecord`
fora do universo apagável pela cascata, mais wrappers (`fencedTransactWrite`/`fencedSingleWrite`) que toda
escrita DynamoDB de dado de tenant passaria a usar. Ver `claude-proposal-round1.md` para o desenho completo.

## Resultado: Rodada 1, nota **2,8/10**, REPROVADA

Nota absoluta pior que qualquer rodada de D-062/D-063, mas com uma diferença qualitativa real: o Codex
confirmou que a **direção conceitual está certa** (tombstone separado, fora da cascata, resolve de fato o
achado mais grave de D-063 — o fence não é mais a mesma linha que a cascata apaga). O que falhou foi a
execução do desenho, não a ideia central. Ver `codex-round1-critique-full.txt` para o texto completo.

### Achados bloqueantes reais (confirmados contra código, não hipotéticos)

1. **Autocontradição do próprio wrapper**: `fencedSingleWrite` exige lifecycle `ACTIVE` para qualquer
   escrita — mas então não consegue escrever `DELETING`/`DELETED` (guard nunca satisfeito) nem permitir o
   `create` inicial (`attribute_not_exists` falharia sempre depois do primeiro tenant existir). Precisa de um
   primitivo administrativo separado, fora do fence normal.
2. **Bootstrap do primeiro tenant quebrado**: `resolve-request-context.ts:50` cria `IdentityMapping` antes de
   qualquer checagem de lifecycle — um tenant novo não tem lifecycle ainda, "toda escrita exige ACTIVE"
   bloquearia o primeiro login de qualquer usuário novo do sistema.
3. **`dependency-cruiser` não pode implementar a regra proposta** — só analisa grafo de imports, não
   construção AST; não distingue `new PutCommand` de `new GetCommand`. Precisa ser regra ESLint
   (`no-restricted-syntax`).
4. **Inventário "19 arquivos" errado** (são 14) **e incompleto de qualquer forma**: escritores S3 diretos
   (`import-parse-service.ts:129`, `s3-ocr-artifact-store.ts:17`, `s3-document-object-store.ts:38`), SQS, e
   o disparo de Step Functions ficam fora da superfície que os wrappers DynamoDB fechariam.
5. **Janela do protocolo "claim antes do efeito" (SES/Bedrock/Textract) é real e maior que o assumido** —
   minutos, não milissegundos (throttling, lease de 5min); o código real do Bedrock **ignora deliberadamente**
   um erro de quota já reservada e chama o modelo mesmo assim, quebrando a premissa do protocolo proposto.
6. **URLs presignadas**: a transação fenced em `GuestSubmissionService.startSubmission`/
   `ImportService.reserveImport` roda **antes** da emissão da URL — uma invocação em curso ainda devolve URL
   válida mesmo com o tenant já `DELETING`.
7. **Sem prova de descoberta/limpeza de objeto S3 tardio** após a cascata declarar `DELETED`.

## O que sobrevive desta rodada (reusar, não redescobrir)

- Tombstone `TenantLifecycleRecord` separado, fora do Scan da cascata — **conceito validado pelo Codex**,
  resolve de fato (não só desloca) o achado central de D-063.
- Estratégia de interceptar na camada de escrita compartilhada em vez de por handler — direção correta,
  precisa de primitivos corrigidos (bootstrap / write normal / transição administrativa, três casos
  distintos, não um wrapper único).
- Inventário real de escritores fora do DynamoDB (S3 direto, SQS, Step Functions) agora levantado — não
  precisa ser redescoberto na próxima rodada.

## Próxima sessão — como retomar

1. Separar três primitivos: bootstrap atômico (`IdentityMapping`+`TenantLifecycleRecord`+`User` juntos, sem
   dependência circular), escrita normal fenced (ConditionCheck contra `ACTIVE`), transição administrativa do
   lifecycle (ConditionCheck contra o status *anterior* esperado, nunca `ACTIVE` fixo).
2. Trocar a proposta de enforcement para ESLint AST, com fixtures positivas/negativas reais.
3. Expandir o inventário de escritores para S3/SQS/SFN/SES/Bedrock/Textract, não só DynamoDB.
4. Resolver a janela de claim→efeito para SES/Bedrock/Textract com drenagem real (aguardar claims em voo
   antes de declarar `DELETED`) — e corrigir o bug real encontrado en passant no Bedrock (ignora
   `QuotaExceededError` de reserva prévia).
5. Mover a emissão de URL presignada para **depois** da escrita fenced, não antes, nos dois call sites
   identificados (`GuestSubmissionService.startSubmission`, `ImportService.reserveImport`).
6. Especificar o contrato de "convergência" incluindo objetos S3 tardios (lifecycle real, prazo máximo,
   descoberta pelo mecanismo de convergência) — `DELETED` não pode ser declarado sem isso.

## Registro de decisão

D-064 em `docs/architecture/decisions-log.md`: Rodada 1 reprovada (2,8/10), pausada por ser sessão de
planejamento (não implementação) — decisão do Marcelo sobre continuar para Rodada 2 imediatamente ou agendar
sessão dedicada fica em aberto.
