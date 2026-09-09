# A18 — Minhas preferências de notificação

**Rota:** `/settings/notifications`
**Acesso:** qualquer usuário autenticado, edita apenas as próprias preferências (não afeta outros)
**Nav ativo:** "Configurações"
**Layout:** coluna única, max-width `var(--layout-reading-max)`.

## Estrutura

1. `PageHeader`: título "Minhas preferências de notificação", descrição "Como você, pessoalmente, recebe lembretes. Não afeta outros usuários."
2. **Painel único**, lista de linhas rótulo + controle:
   - **E-mail**: nota "Canal sempre disponível" + checkbox "Ativado" (marcado, sempre disponível — pode ser o único canal obrigatório).
   - **WhatsApp**: nota "Indisponível no momento — sem rota de consentimento ainda" + `StatusBadge` "Indisponível" (neutral, sem controle editável).
   - **Idioma dos lembretes**: `<select>` com opções "Português (Brasil)" (padrão) / "English (US)".
   - **Horário silencioso**: nota "Nenhum lembrete enviado neste intervalo" + dois campos `time` ("das" / "até", ex. 21:00 até 07:00).
3. Rodapé: botão "Salvar preferências" (primary), alinhado à direita.

## Regras de negócio

- Esta tela é **por-usuário**, distinta da Política de Lembrete (A06), que é por-vencimento/por-organização. Um lembrete só chega ao usuário se: (a) a política do vencimento o dispara, E (b) está dentro do canal habilitado aqui, E (c) fora do horário silencioso pessoal.
- WhatsApp aparece na lista para comunicar roadmap, mas é inoperante nesta versão.
