# G02 — Solicitação de documento (convidado)

**Rota:** `/guest/request/:token`
**Acesso:** público, sem login, via link de uso único
**Layout:** sem AppShell. Fundo levemente acinzentado. Card único centralizado (max-width 520px). Wizard de 3 etapas + tela final.

## Estrutura

1. Wordmark "Expiration Tracker".
2. **Badges de etapa** (fora do card): "1. Tipo de documento", "2. Arquivo", "3. Revisar e enviar" — etapa atual destacada.
3. **Card**: título H1 = nome da etapa atual (ou "Evidência enviada" na tela final); descrição fixa: "{Fornecedor} solicitou evidência para o requisito: **{Requisito}**."; corpo por etapa (`state.step`):

### Etapa 1 — Tipo de documento
- `<select>` obrigatório "Tipo de documento *" com opções (ex. CND Federal, CND Estadual, CNDT).
- Se nenhum selecionado: `InlineNotice tone="neutral"` "Campo obrigatório — não é possível avançar sem selecionar um tipo."
- Botão "Continuar" (primary, desabilitado até selecionar).

### Etapa 2 — Arquivo
- Dropzone tracejada (ícone `upload`, "Arraste um arquivo ou" + botão "Selecionar arquivo" secondary sm, nota "PDF, JPG ou PNG · até 10 MB").
- Botões: "Voltar" (tertiary) → etapa 1; "Continuar" (primary) → etapa 3.

### Etapa 3 — Revisar e enviar
- Resumo rótulo/valor: "Tipo de documento" (label legível escolhido), "Arquivo" (nome do arquivo enviado).
- `InlineNotice tone="neutral"`: "Revise antes de enviar. Após o envio, você pode ser solicitado a corrigir um campo, mas não poderá reverter esta submissão." (envio é definitivo, mas pode haver pedido de correção pontual posterior).
- Botões: "Voltar" (tertiary) → etapa 2; "Enviar evidência" (primary) → etapa final.

### Etapa final — "Evidência enviada"
- `InlineNotice tone="success"`: "Recebemos seu envio. Ele será analisado pela equipe responsável — esta confirmação não significa que o documento foi aprovado."

## Dados de exemplo

```
Fornecedor: Atlas Schindler
Requisito: CND Federal
Opções de tipo: CND Federal (Receita Federal) | CND Estadual | CNDT — Débitos Trabalhistas
```

## Regras de negócio

- Distinto de G01: aqui o convidado **escolhe o tipo de documento** dentre opções compatíveis com o Requisito solicitado (o requisito pode aceitar mais de um tipo de documento como evidência válida).
- Submissão é definitiva (não pode ser desfeita pelo convidado), mas o processo de revisão humana pode solicitar correções pontuais depois — deixar claro na UI que isso é possível sem contradizer "não pode reverter".
- Mesmo texto de aviso de G01 sobre não haver confirmação de aprovação via este canal.
