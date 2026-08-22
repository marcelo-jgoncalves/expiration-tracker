/**
 * Versioned email templates (M4 residual item closed 2026-08-21, decisão do usuário: motor de
 * template = string interpolation simples versionada em código, sem motor externo/dependência
 * nova - proporcional ao estágio pré-produção/sem frontend; localização = só pt-BR por agora,
 * `NotificationPreferences.locale` fica no schema para o futuro sem template real ainda).
 *
 * Cada `templateId` é uma família de conteúdo (ex. "expiration-reminder"); cada
 * `templateVersion` dentro dela é um snapshot imutável do texto real já enviado a algum
 * destinatário - nunca editar o conteúdo de uma versão publicada, sempre incrementar a versão
 * (mesma disciplina de schema versionado já usada em `schemas/`).
 */
export interface RenderedEmailContent {
  subject: string;
  html: string;
  text: string;
}

type TemplateRenderer = (context: Record<string, unknown>) => RenderedEmailContent;

const TEMPLATES: Record<string, Record<number, Record<string, TemplateRenderer>>> = {
  "expiration-reminder": {
    1: {
      "pt-BR": (context) => {
        const name = (context["itemDisplayName"] as string | undefined) ?? "seu item";
        const dueDate = (context["dueDateLocal"] as string | undefined) ?? "";
        const subject = `Lembrete de vencimento: ${name}`;
        const text = `O item "${name}" vence em ${dueDate}.`;
        const html = `<p>O item <strong>${escapeHtml(name)}</strong> vence em ${escapeHtml(dueDate)}.</p>`;
        return { subject, html, text };
      },
    },
  },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/** Fail-closed: an unknown templateId/templateVersion/locale combination is a bug (a producer
 * referencing a template that was never published for that locale), never silently rendered
 * with a generic fallback that could ship the wrong content to a real recipient. */
export function renderEmailTemplate(
  templateId: string,
  templateVersion: number,
  locale: string,
  context: Record<string, unknown>,
): RenderedEmailContent {
  const renderer = TEMPLATES[templateId]?.[templateVersion]?.[locale];
  if (!renderer) {
    throw new Error(`Unknown email template: ${templateId} v${templateVersion} (${locale})`);
  }
  return renderer(context);
}
