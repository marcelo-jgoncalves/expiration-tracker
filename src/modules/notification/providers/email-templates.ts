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
  // M10 cluster 4 (D-039/D-046/D-048): reenvio automático de guest upload, tiers T7/T3 (antes
  // do deadline/expiração do token) - SEMPRE ao destinatário EXTERNO, SEMPRE com um link
  // recém-rotacionado (nunca o secret original, que nunca é persistido). Nunca envia depois de
  // EXPIRED (ver "document-request-chasing-expired-internal" abaixo).
  "document-request-chasing": {
    1: {
      "pt-BR": (context) => {
        const requirementName = sanitizeTenantText(context["requirementName"] as string | undefined, "documento solicitado");
        // D-129 (GTR-01 supersession): identidade de quem solicitou, exibida ao convidado -
        // sempre `Organization.displayName` (fallback genérico só no caso não-esperado de
        // ausência, ver resolveOrganizationDisplayName em composition/subject.ts).
        const requesterName = sanitizeTenantText(context["requesterName"] as string | undefined, "Solicitante não identificado");
        const deadlineLocal = (context["deadlineLocal"] as string | undefined) ?? "";
        const guestLink = String(context["guestLink"] ?? "");
        const subject = `Lembrete: envio de ${requirementName} pendente`;
        const text = [
          `Ainda estamos aguardando o envio de "${requirementName}".`,
          `Solicitado por: ${requesterName}.`,
          deadlineLocal ? `Prazo: ${deadlineLocal}.` : "",
          `Envie pelo link: ${guestLink}`,
          "Não encaminhe este link - ele é pessoal e expira automaticamente.",
        ]
          .filter(Boolean)
          .join("\n");
        const html = [
          `<p>Ainda estamos aguardando o envio de <strong>${escapeHtml(requirementName)}</strong>.</p>`,
          `<p>Solicitado por: ${escapeHtml(requesterName)}.</p>`,
          deadlineLocal ? `<p>Prazo: ${escapeHtml(deadlineLocal)}.</p>` : "",
          `<p><a href="${escapeHtml(guestLink)}">Enviar documento</a></p>`,
          `<p><small>Não encaminhe este link - ele é pessoal e expira automaticamente.</small></p>`,
        ]
          .filter(Boolean)
          .join("\n");
        return { subject, html, text };
      },
    },
  },
  // Tier EXPIRED (D-048): nunca envia link externo funcional (o token já expirou por design) -
  // notifica o usuário INTERNO que criou a solicitação (`requestedByUserId`), não o fornecedor.
  "document-request-chasing-expired-internal": {
    1: {
      "pt-BR": (context) => {
        const requirementName = sanitizeTenantText(context["requirementName"] as string | undefined, "documento solicitado");
        const recipientDisplayName = sanitizeTenantText(context["recipientDisplayName"] as string | undefined, "o destinatário");
        const subject = `Prazo expirado sem envio: ${requirementName}`;
        const text = `A solicitação de "${requirementName}" para ${recipientDisplayName} expirou sem envio do documento. Considere abrir uma nova solicitação.`;
        const html = `<p>A solicitação de <strong>${escapeHtml(requirementName)}</strong> para ${escapeHtml(recipientDisplayName)} expirou sem envio do documento. Considere abrir uma nova solicitação.</p>`;
        return { subject, html, text };
      },
    },
  },
  // D-049: convite inicial automatizado (feature separada, gate de kill switch/preferência de
  // tenant fora deste template) - mesmo link/sanitização do chasing, texto de primeira solicitação.
  "document-request-initial-invite": {
    1: {
      "pt-BR": (context) => {
        const requirementName = sanitizeTenantText(context["requirementName"] as string | undefined, "um documento");
        // W5-01/GTR-01 (D-060), mesma disciplina do template "document-request-chasing" acima.
        const requesterName = sanitizeTenantText(context["requesterName"] as string | undefined, "Solicitante não identificado");
        const deadlineLocal = (context["deadlineLocal"] as string | undefined) ?? "";
        const guestLink = String(context["guestLink"] ?? "");
        const subject = `Solicitação de envio: ${requirementName}`;
        const text = [
          `Foi solicitado o envio de "${requirementName}".`,
          `Solicitado por: ${requesterName}.`,
          deadlineLocal ? `Prazo: ${deadlineLocal}.` : "",
          `Envie pelo link: ${guestLink}`,
          "Não encaminhe este link - ele é pessoal e expira automaticamente.",
        ]
          .filter(Boolean)
          .join("\n");
        const html = [
          `<p>Foi solicitado o envio de <strong>${escapeHtml(requirementName)}</strong>.</p>`,
          `<p>Solicitado por: ${escapeHtml(requesterName)}.</p>`,
          deadlineLocal ? `<p>Prazo: ${escapeHtml(deadlineLocal)}.</p>` : "",
          `<p><a href="${escapeHtml(guestLink)}">Enviar documento</a></p>`,
          `<p><small>Não encaminhe este link - ele é pessoal e expira automaticamente.</small></p>`,
        ]
          .filter(Boolean)
          .join("\n");
        return { subject, html, text };
      },
    },
  },
  // Wave B2B-8 (Invitations/Team, D-099): convite para ingressar numa Organization como
  // membro de equipe - distinto de "document-request-initial-invite" acima (aquele é convite
  // de guest upload para um destinatário externo/documento; este é convite de time/produto).
  // `inviterDisplayName` nunca inferido, mesma disciplina W5-01/GTR-01 - fallback genérico
  // quando ausente.
  "organization-invitation": {
    1: {
      "pt-BR": (context) => {
        const organizationDisplayName = sanitizeTenantText(context["organizationDisplayName"] as string | undefined, "uma organização");
        const inviterDisplayName = sanitizeTenantText(context["inviterDisplayName"] as string | undefined, "Alguém");
        const invitationLink = String(context["invitationLink"] ?? "");
        const subject = `${inviterDisplayName} convidou você para ${organizationDisplayName}`;
        const text = [
          `${inviterDisplayName} convidou você para ingressar em "${organizationDisplayName}".`,
          `Aceite pelo link: ${invitationLink}`,
          "Não encaminhe este link - ele é pessoal e expira automaticamente.",
        ].join("\n");
        const html = [
          `<p>${escapeHtml(inviterDisplayName)} convidou você para ingressar em <strong>${escapeHtml(organizationDisplayName)}</strong>.</p>`,
          `<p><a href="${escapeHtml(invitationLink)}">Aceitar convite</a></p>`,
          `<p><small>Não encaminhe este link - ele é pessoal e expira automaticamente.</small></p>`,
        ].join("\n");
        return { subject, html, text };
      },
    },
  },
};

/** Sanitização de campo fornecido pelo tenant antes de interpolar num e-mail externo (D-049):
 * trim, colapsa espaços, remove caracteres de controle/CRLF (nunca injeta cabeçalho/linha nova
 * via nome), limite de 80 caracteres, cai no fallback se ficar vazio depois disso. O escape de
 * HTML acontece separadamente em cada renderer (`escapeHtml`), nunca aqui - este helper só
 * normaliza o TEXTO, não decide o formato de saída. */
export function sanitizeTenantText(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  // eslint-disable-next-line no-control-regex -- remoção deliberada de caracteres de controle/CRLF de um campo fornecido pelo tenant antes de interpolar em e-mail externo (D-049).
  const withoutControlChars = raw.replace(/[\x00-\x1F\x7F]/g, " ");
  const collapsed = withoutControlChars.replace(/\s+/g, " ").trim();
  if (!collapsed) return fallback;
  return collapsed.slice(0, 80);
}

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
