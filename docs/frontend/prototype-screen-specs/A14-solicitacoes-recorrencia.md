# A14 — Solicitações e recorrência

**Rota:** `/app/:orgId/subjects/:subjectId/requests`, `/app/:orgId/subjects/:subjectId/series/:seriesId`
**Acesso:** `docarchive:series-read` (todos os papéis, inclui VIEWER); `docarchive:series-create`/`-update`/`-cancel`/`-materialize` e `docarchive:request-create` (WRITE_ROLES — OWNER/ADMIN/MEMBER); VIEWER vê tudo nesta tela, sem nenhuma ação de escrita disponível (sem botões, não apenas desabilitados sem explicação).
**Nav ativo:** "Fornecedores"

**Revisão 2026-09-10 (screen-spec-audit-2026-09-09, batch 4/6)**: reescrita completa após NOT PASS
(Functional 46.0/100, Visual 41.0/100, Consolidado 44.0/100). Ver
`docs/architecture/reviews/screen-spec-audit-2026-09-09/A14-audit-record.md`.

## Estrutura

1. `PageHeader`: `above`="← Voltar para {fornecedor}"; título "Solicitações e recorrência"; descrição "{Fornecedor} · geração de solicitações de documento a partir de Requisitos."; ações (WRITE_ROLES apenas): "Nova solicitação avulsa" (secondary), "Nova série recorrente" (primary). VIEWER não vê nenhuma das duas.
2. **Painel "Séries recorrentes"** (header: título + contagem): `DataTable` compacta, colunas:
   - Requisito (primary, link → A11/A09 filtrado nesse Requirement)
   - Status: `StatusBadge` "Ativa" (neutral) / "Cancelada" (neutral, não `critical` — histórico encerrado não é um estado de atenção, apenas informativo)
   - Recorrência: duas linhas — texto legível (ex. "Trimestral") + expressão técnica cron abaixo em fonte monoespaçada (ex. "cron: 0 0 1 */3 *"), ou "—" se cancelada
   - Próxima geração (data, "—" se cancelada)
   - Destinatário (e-mail)
   - Ações (WRITE_ROLES apenas): se ativa → "Gerar agora" (`ghost`, sm) + "Editar" (`ghost`, sm) + "Cancelar" (`ghost`, sm); se cancelada → texto "Cancelada" (`CellSecondary`, sem ações). VIEWER: coluna de ações inteira omitida (não renderizada em branco).
   - Clique na linha abre o detalhe da série em `/series/:seriesId` (ver §"Detalhe da série" abaixo).
3. **Painel "Solicitações avulsas e materializações"** (header: título + contagem): `DataTable` compacta, colunas:
   - Requisito (link → A11/A09)
   - Gerada em (data)
   - Entrega da credencial: `StatusBadge` — SENT="Aceito para envio" (neutral — nunca "Enviado": o sistema confirma apenas que o e-mail foi aceito pelo provedor, não que chegou; ver disciplina epistêmica, design-system.md §79), SEND_UNCERTAIN="Envio incerto" (warning), MANUAL="Entrega manual" (neutral)
   - Link do convidado (texto: "Ativo · expira em DD/MM/AAAA" | "Resolvido (submissão recebida)" | "Expirado" | "Revogado")
   - Ações: "Ver" (`ghost`, sm, link) → abre o detalhe da solicitação (mesmo painel de detalhe usado pelo link "Ver" de A13, reaproveitado).

## Criação — "Nova solicitação avulsa" (dialog, WRITE_ROLES)

Formulário curto em `Dialog` (não workflow longo, per design-system.md §47):
- Campo obrigatório: Requisito (`Combobox`, busca pelos Requirements do Subject sem solicitação avulsa pendente aberta).
- Campo obrigatório: Destinatário (e-mail, `Input type="email"`, validação de formato inline).
- Nota de contexto: "Um link de convidado sem login será gerado e enviado a este e-mail (ver A14 §Regras de negócio). O envio é confirmado apenas como aceito pelo provedor — não como recebido."
- Botão "Criar solicitação" (primary) → `POST .../document-requests`. Estado de envio: botão em `loading`, formulário bloqueado.
- Sucesso: `Toast` "Solicitação criada" + fecha o dialog + nova linha aparece no painel "Solicitações avulsas" com `SEND_UNCERTAIN`/`SENT` conforme resposta.
- Erro: `InlineNotice tone="danger"` dentro do dialog (não fecha), mensagem específica (ex. "Este Requirement já tem uma solicitação avulsa pendente." se o backend rejeitar duplicidade) — nunca "Erro ao criar".

## Criação — "Nova série recorrente" (dialog, WRITE_ROLES)

- Campo obrigatório: Requisito (mesmo `Combobox`, exclui Requirements que já têm série ACTIVE).
- Campo obrigatório: Destinatário (e-mail).
- Campo obrigatório: Recorrência — seletor com opções nomeadas (Mensal/Trimestral/Semestral/Anual) que mapeiam para uma expressão cron interna; um modo avançado opcional revela o campo cron bruto para quem precisa de uma cadência não coberta pelas opções nomeadas. Preview ao vivo abaixo do seletor: "Próxima geração estimada: {data}".
- Botão "Criar série" (primary) → `POST` cria a série ACTIVE. Mesmos estados de loading/sucesso/erro do dialog avulso.
- Conflito OCC (série alterada por outra pessoa entre abrir o dialog e confirmar, relevante no fluxo de edição abaixo): `InlineNotice tone="warning"` "Esta série foi alterada por outra pessoa. Revise os valores atuais antes de salvar." + recarrega os valores atuais no formulário.

## Ação "Editar" (série ativa, WRITE_ROLES — `docarchive:series-update`)

Reabre o mesmo dialog de criação de série pré-preenchido (destinatário, recorrência). Sujeito ao mesmo conflito OCC acima. Alterar a recorrência não afeta materializações já geradas.

## Ação "Gerar agora" (série ativa, WRITE_ROLES — `docarchive:series-materialize`)

- Idempotente: uma segunda chamada de "Gerar agora" enquanto a primeira ainda está em voo é bloqueada no cliente (botão em `loading`, desabilitado) e o backend também rejeita duplicidade — nunca emite duas solicitações para a mesma janela.
- Estado `loading`: botão mostra spinner inline, label muda para "Gerando…".
- Sucesso: `Toast` "Solicitação gerada" + nova linha aparece no painel de materializações.
- Falha: `InlineNotice tone="danger"` inline na linha da série (não um toast que desaparece) — falha de geração é operacionalmente relevante e deve permanecer visível até dispensada.

## Ação "Cancelar" (série ativa, WRITE_ROLES — `docarchive:series-cancel`)

`Dialog` de confirmação (per design-system.md §48, nomeando objeto e consequência): "Cancelar série 'CND Federal — Trimestral'? Solicitações futuras não serão mais geradas automaticamente. O histórico permanece visível." Botão de confirmação `ghost` (ação reversível-adjacente — a série pode ser recriada, não é uma exclusão permanente — nunca `danger`, que é reservado a exclusões reais).

## Detalhe da solicitação avulsa / materialização ("Ver")

Painel/drawer com: Requisito, data de geração, estado de entrega, link do convidado (com botão "Copiar link" enquanto ativo), e — quando resolvido — link direto para a submissão em A13/A12. Se a solicitação em si estiver expirada/revogada/resolvida, isso é mostrado como o estado terminal da linha (a distinção entre a solicitação e o link de convidado que ela emitiu é explícita: uma solicitação pode estar `RESOLVED` mesmo que o link técnico já tenha expirado).

## Estados (painéis)

- **Carregando**: skeleton de tabela (linhas placeholder), não spinner de página inteira.
- **Vazio — nenhuma série**: "Nenhuma série recorrente configurada" + "Crie uma série para receber este documento periodicamente sem ação manual." + botão "Nova série recorrente" (se WRITE_ROLES).
- **Vazio — nenhuma solicitação avulsa**: mensagem equivalente, ação "Nova solicitação avulsa".
- **Erro ao carregar**: `InlineNotice tone="danger"` + "Tentar novamente".
- **Sem destinatário definido** (dado herdado de uma série criada antes de exigir destinatário, ou removido): célula de Destinatário mostra "Não definido" em texto de atenção (não em branco), e "Gerar agora"/agendamento automático ficam desabilitados com tooltip "Defina um destinatário para gerar solicitações desta série" até "Editar" ser usado.
- **Materialização ainda não ocorreu** (série recém-criada, antes da primeira geração): painel de materializações mostra uma linha de placeholder "Aguardando a primeira geração em {próxima data}" em vez de omitir a série totalmente desse contexto.

## Responsivo

Full parity (per plano). `DataTable` de ambos os painéis vira lista de cards empilhados abaixo de 768px: cada card mostra Requisito como título, badges de status/entrega, recorrência (as duas formas, texto e cron, empilhadas) e ações como um menu overflow de 3 pontos (ícone-only com nome acessível "Mais ações para {requisito}"). Dialogs de criação/edição ocupam a largura total da viewport em mobile (`Drawer` de baixo para cima em vez de `Dialog` centralizado), mantendo a mesma sequência de campos.

## Teclado e foco

Linhas de tabela navegáveis por teclado (`role="row"` com foco programático, não uma linha inteira envolta num `<button>`); abrir "Ver"/detalhe por Enter na linha focada. Ao fechar um dialog (sucesso ou cancelamento), o foco retorna ao elemento que abriu o dialog (o botão "Nova solicitação avulsa"/"Nova série recorrente"/"Editar" correspondente), nunca ao topo da página.

## Motion

Transição de estado (linha nova aparecendo após "Gerar agora"/criação) usa `motion.normal` fade-in sem deslocamento de layout das linhas existentes — nunca um "salto" de reordenação brusca. Abertura/fechamento de `Dialog`/`Drawer` usa o token de motion padrão do componente. `prefers-reduced-motion`: fade substituído por troca instantânea de estado, mantendo o foco e o toast de confirmação.

## Dados de exemplo

```
Séries:
  s1 CND Federal, ACTIVE, Trimestral (cron 0 0 1 */3 *), próxima 01/12/2026, financeiro@atlasschindler.com
  s2 Contrato de manutenção, CANCELLED, —, —, contratos@atlasschindler.com

Solicitações avulsas:
  r1 CND Federal, criada 01/09/2026, entrega SENT, link "Ativo · expira em 12/09/2026"
  r2 CND Federal, criada 01/06/2026, entrega SEND_UNCERTAIN, link "Resolvido (submissão recebida)"
  r3 Contrato de manutenção, criada 15/03/2026, entrega MANUAL, link "Expirado"
```

## Regras de negócio

- "Série recorrente" gera solicitações automaticamente conforme um cron; "solicitação avulsa" é um disparo único — ambos os caminhos usam o mesmo endpoint de emissão de credencial por baixo (`POST .../document-requests`), a série apenas o dispara automaticamente.
- Cada solicitação gera um link de convidado sem login (ver G02) com prazo de expiração.
- `SEND_UNCERTAIN` sinaliza que o sistema não confirma se o e-mail de convite chegou (ex. bounce desconhecido) — não é um erro definitivo, mas precisa de atenção humana eventual. `SENT` também não é uma confirmação de entrega — apenas de aceitação pelo provedor de envio (disciplina epistêmica).
- Uma série/solicitação cancelada permanece no histórico, nunca é excluída.
- "Gerar agora" é idempotente: repetir a chamada para a mesma janela nunca emite duas solicitações.
- Uma solicitação resultante segue seu próprio ciclo de vida independente do link técnico que ela emitiu — pode estar `RESOLVED` (submissão recebida) mesmo que o link já tenha expirado depois disso.

## Conecta-se com

A09 (origem); uma solicitação emitida → um link de convidado G02; o Requirement alvo → A11/A09; uma submissão recebida → A13/A12.
