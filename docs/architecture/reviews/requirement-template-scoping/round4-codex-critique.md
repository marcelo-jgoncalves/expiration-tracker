
**Nota Claude (cega), Rodada 4 — régua v4: 9,4/10 · design v4: 9,3/10.**

codex
Os quatro achados da R3 foram suficientemente fechados.

1. A causalidade foi corrigida de verdade: `SubjectPreconditionFailedError` descreve somente a condição composta observável, sem releitura posterior nem falsa distinção 404/409.

2. A reclassificação do fallback é legítima, não fuga. O comportamento problemático pertence à lane compartilhada, é pré-existente e não foi introduzido nem ampliado por `RequirementTemplate`. Sob a prática estabelecida do repositório, registrá-lo para uma fatia própria atende C7. Há apenas uma deficiência documental menor: a R4 afirma “dono nomeado”, mas o texto apresentado não fornece identificador nem responsável concreto. Isso não bloqueia esta decisão, desde que o registro rastreável exista no artefato final.

3. O estimador foi corrigido conceitualmente: agora promete limite superior, não exatidão. A fórmula é conservadora para os tipos enumerados. A implementação deve rejeitar explicitamente tipos não cobertos ou estender o cálculo a `boolean`, `null`, binários e sets; do contrário, o caráter “comprovadamente superior” não vale genericamente. Para o schema descrito, isso não é bloqueante.

4. O cap 30 está agora caracterizado honestamente: teto matemático 32, escolha operacional 30 e margem de sete ações. A separação da futura auditoria também remove a premissa indevida.

A sobreposição C1/C3/C7 foi substancialmente desfeita: C1 avalia decisão de produto; C3, integridade transacional; C7, interpretação de cancelamentos. Ainda existe leve preferência arquitetural em C6 (“sem mecanismo/GSI novo”) e C4 recompensa convergência externa como evidência, mas os pesos são baixos e isso já não distorce materialmente o resultado.

Não vejo achado novo material. As duas ressalvas acima são de precisão documental/implementacional e não impedem aprovação. O protocolo fecha sem arredondamento em pelo menos 9,0 nas duas dimensões.

NOTA CODEX RODADA 4 - REGUA: 9,1/10  
NOTA CODEX RODADA 4 - DESIGN: 9,0/10
