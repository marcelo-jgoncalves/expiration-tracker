# G01 — Upload de convidado (rastreamento legado)

**Rota:** `/guest/document-requests/:token`
**Acesso:** público, sem login, via link de uso único. Validado **apenas** por um token opaco na
URL — nunca por `Role` ou qualquer conceito de Organization/Membership. Esta tela é estruturalmente
separada do app autenticado: **sem AppShell, sem nav de Organization, sem lógica baseada em papel
em nenhum ponto** — nem mesmo referências indiretas ("switch de org", "convidado com papel X").
**Layout:** sem AppShell. Fundo levemente acinzentado (`--color-surface-sunken`). Card único centralizado (max-width 480px).

## Estrutura

1. Wordmark "Expiration Tracker" acima do card (sem logo quadrado, texto simples).
2. **Card**:
   - Título H1 "Enviar documento solicitado".
   - Descrição: "{Organização} solicitou o envio de: **{Tipo de documento}**." (nome do tipo em negrito; nome de organização longo quebra em até 2 linhas, nunca trunca de forma que oculte a identidade do solicitante).
   - Corpo variável por estágio (`state.stage`):
     - `unavailable` (**estado único e obrigatório** — ver "Segurança: colapso anti-enumeração" abaixo): `EmptyState` com ícone neutro (não um ícone de erro/alerta que sugira causa), título "Este link não está disponível", descrição "O link pode ter expirado, sido revogado, já utilizado, ou não existir mais. Solicite um novo link a quem pediu o documento." Sem botão de ação (não há "tentar novamente" — o problema é o próprio link).
     - `initial`: dropzone tracejada (ícone `upload`, "Arraste um arquivo ou" + botão "Selecionar arquivo" secondary sm, nota "PDF, JPG ou PNG · até 10 MB") + botão "Enviar" (primary, **desabilitado** até haver arquivo selecionado).
       - Alternativa não-drag-and-drop: a dropzone inteira é também um `<label>` associado a um `<input type="file">` nativo focável por teclado (Tab) e ativável por Enter/Espaço ou toque — nunca apenas uma área de drop sem equivalente de clique/teclado. Em mobile, o seletor nativo oferece câmera e galeria.
       - Arquivo selecionado: nome do arquivo exibido acima do botão "Enviar", com um botão "Remover" (ghost, sm) para trocar de arquivo antes de enviar; foco move-se para o nome do arquivo ao selecionar, anunciado via `aria-live="polite"`.
     - `uploading`: `AsyncFeedback state="PENDING"` "Enviando arquivo…" com o nome do arquivo preservado visível (não desaparece); progresso (se disponível pelo transporte) anunciado incrementalmente via `aria-live="polite"`; botão "Enviar" permanece desabilitado durante o envio, prevenindo duplo submit por clique repetido.
     - `upload-error` (arquivo inválido, tamanho excedido, malha/tipo rejeitado, falha de rede, timeout): `InlineNotice tone="danger"` com mensagem específica ao motivo (ex. "Arquivo maior que 10 MB.", "Não foi possível enviar — verifique sua conexão e tente novamente.") + botão "Tentar novamente" que retorna ao estado `initial` com o arquivo ainda selecionado quando possível (falha de rede) ou pede novo arquivo (arquivo rejeitado).
     - `sent`: `InlineNotice tone="success"` "Envio recebido. Seu arquivo foi registrado e será analisado pela equipe responsável. Você não receberá uma confirmação de aprovação por este link." (deixa claro: não há loop de feedback de aprovação para o convidado).
   - Rodapé fixo do card: "Prazo: {data}" + "Este link é de uso único e não requer login." (omitido no estado `unavailable`, que não tem prazo relevante a mostrar).

### Segurança: colapso anti-enumeração (obrigatório)

Token inválido, expirado, revogado, não encontrado, **e** um link de uso único já utilizado
(reacesso após `sent`) são **cinco causas internas que produzem exatamente UM estado externo**:
`unavailable`, descrito acima — mesma cópia, mesmo ícone, mesmo tratamento visual em todos os
casos, sem exceção. A UI nunca deve revelar, por texto, ícone ou aparência, qual das cinco causas
se aplica — isto é uma propriedade de segurança deliberada (anti-enumeração), não uma lacuna de
produto a ser "melhorada" com mensagens mais específicas. Um link já utilizado **não** mostra o
estado `sent` novamente (isso revelaria "este link já foi usado com sucesso", distinguindo-o de um
token simplesmente inválido) — mostra `unavailable`, como qualquer outra causa.

### Movimento

- Transição entre estágios (`initial` → `uploading` → `sent`/`upload-error`): fade cross-dissolve em `motion.normal` (180ms), sem deslocamento de layout do card (altura mínima reservada para o corpo).
- Foco move-se para o título do `InlineNotice`/`EmptyState` recém-exibido ao final de cada transição de estágio, anunciado via `aria-live="polite"`.
- Respeita `prefers-reduced-motion`: troca de estágio torna-se instantânea, sem fade.

## Dados de exemplo

```
Organização: Conservare Facilities ME
Documento solicitado: Certificado de Regularidade FGTS
Prazo: 20/09/2026
```

## Regras de negócio

- Fluxo de **uma única etapa** (upload direto), distinto de G02 que tem seleção de tipo + 3 etapas — usado para o fluxo de "rastreamento legado" onde o tipo de documento já é fixo/conhecido de antemão.
- Link de uso único: após envio bem-sucedido, uma nova tentativa de acesso sempre mostra `unavailable` (nunca `sent` novamente) — ver "Segurança: colapso anti-enumeração" acima.
- Convidado nunca recebe confirmação de aprovação/rejeição por este canal — a decisão acontece na Fila de revisão (A13), notificada por outros meios se aplicável.
- Verificação de segurança (malware/tipo de arquivo) se aplica igualmente a uploads de convidado; um arquivo rejeitado por esse motivo cai no estado `upload-error` acima com mensagem genérica de arquivo inválido (não expõe detalhes do mecanismo de verificação).
- Alcançável apenas por um link emitido a partir de A10; ao concluir (`sent`), a tela nunca navega para o app autenticado — permanece uma confirmação in-page.
