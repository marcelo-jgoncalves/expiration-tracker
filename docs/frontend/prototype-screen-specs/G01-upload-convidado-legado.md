# G01 — Upload de convidado (rastreamento legado)

**Rota:** `/guest/upload/:token`
**Acesso:** público, sem login, via link de uso único
**Layout:** sem AppShell. Fundo levemente acinzentado (`--color-surface-sunken`). Card único centralizado (max-width 480px).

## Estrutura

1. Wordmark "Expiration Tracker" acima do card (sem logo quadrado, texto simples).
2. **Card**:
   - Título H1 "Enviar documento solicitado".
   - Descrição: "{Organização} solicitou o envio de: **{Tipo de documento}**." (nome do tipo em negrito).
   - Corpo variável por estágio (`state.stage`):
     - `initial`: dropzone tracejada (ícone `upload`, "Arraste um arquivo ou" + botão "Selecionar arquivo" secondary sm, nota "PDF, JPG ou PNG · até 10 MB") + botão "Enviar" (primary, **desabilitado** até haver arquivo selecionado).
     - `uploading`: `AsyncFeedback state="PENDING"` "Enviando arquivo…".
     - `sent`: `InlineNotice tone="success"` "Envio recebido. Seu arquivo foi registrado e será analisado pela equipe responsável. Você não receberá uma confirmação de aprovação por este link." (deixa claro: não há loop de feedback de aprovação para o convidado).
   - Rodapé fixo do card: "Prazo: {data}" + "Este link é de uso único e não requer login."

## Dados de exemplo

```
Organização: Conservare Facilities ME
Documento solicitado: Certificado de Regularidade FGTS
Prazo: 20/09/2026
```

## Regras de negócio

- Fluxo de **uma única etapa** (upload direto), distinto de G02 que tem seleção de tipo + 3 etapas — usado para o fluxo de "rastreamento legado" onde o tipo de documento já é fixo/conhecido de antemão.
- Link de uso único: após envio bem-sucedido, o link deve invalidar novos envios (mostrar sempre o estado `sent` se acessado novamente, ou uma mensagem de "link já utilizado").
- Convidado nunca recebe confirmação de aprovação/rejeição por este canal — a decisão acontece na Fila de revisão (A13), notificada por outros meios se aplicável.
- Verificação de segurança (malware/tipo de arquivo) se aplica igualmente a uploads de convidado (ver A07 para os estados possíveis).
