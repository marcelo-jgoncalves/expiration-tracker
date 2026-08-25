/**
 * Maps a backend VALIDATION ApiError's `details.errors` (an array of Ajv-produced strings,
 * `${instancePath} ${message}` - src/shared/contracts/schema-validator.ts's `validate()`) back
 * to a per-field shape a form can actually use (mission §34: identify field/problem, preserve
 * entered values, allow correction - never just a single generic error string). Client-side
 * validation (validateCreateItemDraft below) is the first line of defense and covers the
 * common cases before a request is even sent; this exists for the residual cases only the
 * backend schema can catch (or a future schema change this form hasn't been updated for yet).
 */
import { ApiError } from "./errors.js";
import type { CreateItemInput } from "./types.js";

export interface FieldErrors {
  /** Keyed by top-level field name (Ajv's instancePath minus its leading slash). */
  fields: Record<string, string>;
  /** Errors that couldn't be attributed to one known field (nested paths, whole-body rules). */
  general: string[];
}

const KNOWN_TOP_LEVEL_FIELDS = new Set([
  "name",
  "category",
  "description",
  "dueDate",
  "issueDate",
  "periodicity",
  "issuer",
  "number",
  "assigneeUserId",
  "tags",
  "priority",
  "newDueDate",
  "cycle",
]);

export function parseValidationErrors(err: ApiError): FieldErrors {
  const raw = err.details?.["errors"];
  const result: FieldErrors = { fields: {}, general: [] };
  if (!Array.isArray(raw)) {
    result.general.push(err.message);
    return result;
  }
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const spaceIndex = entry.indexOf(" ");
    const path = spaceIndex === -1 ? entry : entry.slice(0, spaceIndex);
    const message = spaceIndex === -1 ? entry : entry.slice(spaceIndex + 1);
    const field = path.startsWith("/") ? path.slice(1) : "";
    if (field && !field.includes("/") && KNOWN_TOP_LEVEL_FIELDS.has(field)) {
      result.fields[field] = message;
    } else {
      result.general.push(entry);
    }
  }
  return result;
}

export function isValidationError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.category === "VALIDATION";
}

/**
 * Create Expiration draft (mission §26 - the smallest correct form: only name/category/
 * dueDate are required, matching CreateItemInput/create-item-request.v1.json exactly, never
 * Subject/Requirement/Document/Reminder). Date fields hold a plain `<input type="date">`
 * value (`YYYY-MM-DD`); `tags` holds the raw comma-separated text the user typed, parsed only
 * at submit time (`parseTagsInput`) so mid-typing a tag never looks like a validation error.
 */
export interface CreateItemDraft {
  name: string;
  category: string;
  dueDate: string;
  description: string;
  issueDate: string;
  periodicity: string;
  issuer: string;
  number: string;
  assigneeUserId: string;
  tags: string;
  priority: string;
}

export const EMPTY_CREATE_ITEM_DRAFT: CreateItemDraft = {
  name: "",
  category: "",
  dueDate: "",
  description: "",
  issueDate: "",
  periodicity: "",
  issuer: "",
  number: "",
  assigneeUserId: "",
  tags: "",
  priority: "",
};

/** Mirrors schemas/api/create-item-request.v1.json's length limits exactly - client-side
 * validation is the first line of defense, but must never diverge from what the backend will
 * actually accept (a form that "passes" locally and then 400s is worse than no client
 * validation at all). */
const MAX_LENGTH = {
  name: 200,
  category: 100,
  description: 2000,
  periodicity: 50,
  issuer: 200,
  number: 100,
  assigneeUserId: 100,
  priority: 50,
  tag: 50,
} as const;
const MAX_TAGS = 20;

export function parseTagsInput(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

export function validateCreateItemDraft(draft: CreateItemDraft): FieldErrors {
  const fields: Record<string, string> = {};

  if (!draft.name.trim()) {
    fields["name"] = "Informe um nome.";
  } else if (draft.name.length > MAX_LENGTH.name) {
    fields["name"] = `Use no máximo ${MAX_LENGTH.name} caracteres.`;
  }

  if (!draft.category.trim()) {
    fields["category"] = "Informe uma categoria.";
  } else if (draft.category.length > MAX_LENGTH.category) {
    fields["category"] = `Use no máximo ${MAX_LENGTH.category} caracteres.`;
  }

  if (!draft.dueDate) {
    fields["dueDate"] = "Informe a data de vencimento.";
  }

  if (draft.description.length > MAX_LENGTH.description) {
    fields["description"] = `Use no máximo ${MAX_LENGTH.description} caracteres.`;
  }
  if (draft.periodicity.length > MAX_LENGTH.periodicity) {
    fields["periodicity"] = `Use no máximo ${MAX_LENGTH.periodicity} caracteres.`;
  }
  if (draft.issuer.length > MAX_LENGTH.issuer) {
    fields["issuer"] = `Use no máximo ${MAX_LENGTH.issuer} caracteres.`;
  }
  if (draft.number.length > MAX_LENGTH.number) {
    fields["number"] = `Use no máximo ${MAX_LENGTH.number} caracteres.`;
  }
  if (draft.assigneeUserId.length > MAX_LENGTH.assigneeUserId) {
    fields["assigneeUserId"] = `Use no máximo ${MAX_LENGTH.assigneeUserId} caracteres.`;
  }
  if (draft.priority.length > MAX_LENGTH.priority) {
    fields["priority"] = `Use no máximo ${MAX_LENGTH.priority} caracteres.`;
  }

  const tags = parseTagsInput(draft.tags);
  if (tags.length > MAX_TAGS) {
    fields["tags"] = `No máximo ${MAX_TAGS} tags.`;
  } else if (tags.some((tag) => tag.length > MAX_LENGTH.tag)) {
    fields["tags"] = `Cada tag deve ter no máximo ${MAX_LENGTH.tag} caracteres.`;
  }

  return { fields, general: [] };
}

/** A plain `<input type="date">` value has no time component - the backend requires a full
 * date-time (schemas/api/create-item-request.v1.json's `format: "date-time"`). Midnight UTC is
 * an arbitrary but stable choice: this app only ever displays the date portion
 * (formatAbsoluteDate/formatRelativeDueDate), so the time-of-day is never shown or compared
 * against anything that would make the choice visible or consequential. */
export function toIsoDateTime(dateOnly: string): string {
  return `${dateOnly}T00:00:00.000Z`;
}

export function draftToCreateItemInput(draft: CreateItemDraft): CreateItemInput {
  return {
    name: draft.name.trim(),
    category: draft.category.trim(),
    dueDate: toIsoDateTime(draft.dueDate),
    description: draft.description.trim() || undefined,
    issueDate: draft.issueDate ? toIsoDateTime(draft.issueDate) : undefined,
    periodicity: draft.periodicity.trim() || undefined,
    issuer: draft.issuer.trim() || undefined,
    number: draft.number.trim() || undefined,
    assigneeUserId: draft.assigneeUserId.trim() || undefined,
    tags: parseTagsInput(draft.tags),
    priority: draft.priority.trim() || undefined,
  };
}
