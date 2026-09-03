/**
 * RequirementTemplate — P0.1 do roadmap de lançamento, design `APPROVED` em
 * `docs/architecture/reviews/requirement-template-scoping/estado-final-consolidado.md`
 * (protocolo Claude↔Codex, 4 rodadas, Claude 9,4/9,3 · Codex 9,1/9,0).
 *
 * Conjunto reutilizável de requisitos documentais aplicável a um Subject. A semântica de
 * aplicação é SNAPSHOT, nunca live-link: aplicar copia o conteúdo para `Requirement` novos, e
 * nenhuma edição posterior do template alcança um `Requirement` já criado — o padrão convergente
 * das 5 fontes externas da declaração E-014 (Drata "will never modify your policies without your
 * involvement", Vanta, Asana, Jira `Clone`, HighLevel snapshots). Os campos de proveniência que
 * o apply grava em `Requirement` (`sourceTemplateId`/`sourceTemplateItemId`/
 * `sourceTemplateAppliedVersion`) são rastro auditável e NUNCA são lidos por nenhum caminho de
 * leitura, derivação ou worker.
 *
 * Itens são EMBUTIDOS (não uma coleção de linhas próprias) porque 100% dos access patterns desta
 * decisão — preview, apply, edição, duplicação — leem e escrevem o template como uma unidade; o
 * `version` do próprio template já é o OCC da lista inteira.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import { normalizeDisplayName } from "../../../shared/text/normalize-display-name.js";
import { ValidationError } from "../../../shared/errors/app-error.js";
import type { RequirementApplicability } from "./requirement.js";

export type RequirementTemplateStatus = "ACTIVE" | "ARCHIVED";

/**
 * Cap de itens por template. Derivação honesta (§4 do design; o Codex corrigiu uma afirmação
 * anterior de que 30 era "matematicamente derivado"): a transação do apply custa `2N + 3` hoje
 * (N Put(Requirement) + N Put(pointer) + ConditionCheck do template + ConditionCheck do Subject
 * + fence de tenant). O pior caso PREVISTO é `3N + 3` — um evento de auditoria por `Requirement`
 * criado, lacuna conhecida deste módulo (`document-archive-service.ts` ainda não emite
 * `SubjectAuditEvent`, ao contrário do `RequirementService` legado) — o que impõe um TETO de
 * `N <= 32` contra o limite duro de 100 ações de `TransactWriteItems`. 30 é a escolha operacional
 * abaixo do teto, com 7 ações de margem, para que fechar aquela lacuna depois não exija revisitar
 * este cap.
 */
export const MAX_TEMPLATE_ITEMS = 30;

/** Limites em BYTES UTF-8, não em caracteres (achado do Codex Rodada 2: 200 "caracteres" podem
 * ocupar até 4× isso em UTF-8, o que tornava o teste-sentinela capaz de reprovar um valor que o
 * schema aceita). O `maxLength` do JSON Schema conta code points e é a primeira barreira barata;
 * a barreira que DECIDE é a de bytes, aplicada aqui. */
export const MAX_NAME_BYTES = 200;
export const MAX_NOTES_BYTES = 2000;

export interface RequirementTemplateItem {
  /** ULID estável através de edições do template. Uma DUPLICAÇÃO gera ids novos — uma cópia é um
   * template independente, não um alias do original. */
  templateItemId: string;
  name: string;
  notes?: string;
  applicability: RequirementApplicability;
  position: number;
}

export interface RequirementTemplate extends EntityKey {
  SK: "METADATA";
  entityType: "RequirementTemplate";
  templateId: string;
  tenantId: string;
  /** Renomeável — nunca a identidade (o `templateId` é, imutável, ULID, nunca reusado). */
  displayName: string;
  description?: string;
  status: RequirementTemplateStatus;
  items: RequirementTemplateItem[];
  createdAt: string;
  updatedAt: string;
  version: number;
  GSI1PK: string;
  GSI1SK: string;
}

export function requirementTemplateKey(tenantId: string, templateId: string): { PK: string; SK: "METADATA" } {
  return { PK: `TENANT#${tenantId}#REQTEMPLATE#${templateId}`, SK: "METADATA" };
}

/** GSI1 discriminado por prefixo — mesmo índice físico já compartilhado por Document
 * (`DOCSTATUS`), Requirement (`REQSTATUS`) e DocumentType (`DOCTYPESTATUS`). Nenhum índice novo.
 * Ordenado por nome normalizado, então uma listagem de catálogo sai alfabética de graça. */
export function requirementTemplateGsi1Keys(
  tenantId: string,
  status: RequirementTemplateStatus,
  normalizedName: string,
  templateId: string,
): { GSI1PK: string; GSI1SK: string } {
  return {
    GSI1PK: `TENANT#${tenantId}#REQTEMPLATESTATUS#${status}`,
    GSI1SK: `NAME#${normalizedName}#REQTEMPLATE#${templateId}`,
  };
}

/** Ponteiro de dedupe do NOME DO TEMPLATE — cópia exata do mecanismo de
 * `DocumentTypeNamePointer` (D-173 §2). */
export interface RequirementTemplateNamePointer extends EntityKey {
  SK: "POINTER";
  entityType: "RequirementTemplateNamePointer";
  tenantId: string;
  normalizedName: string;
  templateId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function requirementTemplateNamePointerKey(tenantId: string, normalizedName: string): { PK: string; SK: "POINTER" } {
  return { PK: `TENANT#${tenantId}#REQTEMPLATENAME#${normalizedName}`, SK: "POINTER" };
}

/**
 * Ponteiro de dedupe do NOME DE UM `Requirement`, escopado ao Subject — o mecanismo que torna a
 * "prevenção de duplicidade óbvia" do roadmap TRANSACIONAL em vez de um read-then-write.
 *
 * Decisão de produto deliberada (§3 do design; o Codex corrigiu o enquadramento original, que a
 * apresentava como consequência lógica da entidade): **o nome de um `Requirement` é único por
 * Subject**. Consequências declaradas: homônimos com `notes`/`applicability` diferentes são
 * inválidos; NOT_APPLICABLE reserva o nome (é o mesmo dever, só marcado como dispensado); não
 * existe estado "arquivado" para `Requirement` (`deleteRequirement` é `Delete` físico), logo
 * apagar libera o nome; renomear pode colidir com outro requisito (409). Gatilho de reversão
 * nomeado: se a distinção período/jurisdição precisar ser estrutural (um campo `period`), ela
 * entra NESTA chave — evolução da chave, não reversão da regra.
 */
export interface RequirementNamePointer extends EntityKey {
  SK: "POINTER";
  entityType: "RequirementNamePointer";
  tenantId: string;
  subjectId: string;
  normalizedName: string;
  requirementId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function requirementNamePointerKey(tenantId: string, subjectId: string, normalizedName: string): { PK: string; SK: "POINTER" } {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}#REQNAME#${normalizedName}`, SK: "POINTER" };
}

/**
 * Chave física do `TrackedSubject` — reimplementada aqui, NÃO importada de
 * `subject/domain/tracked-subject.ts`: `.dependency-cruiser.cjs` proíbe `document-archive`
 * alcançar `subject/**` (mesma fronteira que fez `normalizeDisplayName()` ser promovido para
 * `shared/text/` em D-174, e a mesma classe de violação que D-188 pegou ao escrever
 * `transient-purge-gsi8.ts`). O formato é estável e já é assumido por `requirementKey()` logo
 * acima, que constrói a MESMA `PK` — duplicar só o sufixo `SK: "META"` é mais barato e mais
 * honesto que inverter a fronteira de módulo por uma constante.
 */
export function trackedSubjectKeyForFence(tenantId: string, subjectId: string): { PK: string; SK: "META" } {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: "META" };
}

/** Único status de `TrackedSubject` que aceita a criação de um `Requirement`. Enumerado, nunca
 * `<> DELETED` — o enum real é `ACTIVE | ARCHIVED | DELETED` (verificado), e `<> DELETED` deixava
 * `ARCHIVED` passar (achado do Codex Rodada 2, confirmado por leitura do enum). */
export const SUBJECT_STATUS_ACCEPTING_REQUIREMENTS = "ACTIVE";

export interface CreateRequirementTemplateInput {
  displayName: string;
  description?: string;
  items: Array<{ name: string; notes?: string; applicability?: RequirementApplicability }>;
}

export interface UpdateRequirementTemplateInput {
  displayName?: string;
  description?: string;
  items?: Array<{ name: string; notes?: string; applicability?: RequirementApplicability }>;
}

/**
 * Achado do Codex Rodada 1 (o mais perigoso dos 12): dois itens que normalizam para o mesmo nome
 * produziriam dois `Put` sobre a MESMA chave de ponteiro dentro de uma única
 * `TransactWriteItems`, que o DynamoDB rejeita com `ValidationException` — um 500 opaco, não o
 * 409 de domínio prometido. Esta validação impede que esse template chegue a ser persistido, e é
 * chamada também pelo planejador como proteção contra um template gravado antes dela existir.
 */
export function assertTemplateItemNamesUnique(items: ReadonlyArray<{ name: string }>): void {
  const seen = new Map<string, number>();
  for (const [index, item] of items.entries()) {
    const normalized = normalizeDisplayName(item.name);
    const previous = seen.get(normalized);
    if (previous !== undefined) {
      throw new ValidationError("Two template items normalize to the same requirement name.", {
        normalizedName: normalized,
        positions: [previous, index],
      });
    }
    seen.set(normalized, index);
  }
}

/** Limites em bytes (ver `MAX_NAME_BYTES`). Aplicado no serviço, não só no schema. */
export function assertTemplateItemSizes(items: ReadonlyArray<{ name: string; notes?: string }>): void {
  for (const [index, item] of items.entries()) {
    if (Buffer.byteLength(item.name, "utf8") > MAX_NAME_BYTES) {
      throw new ValidationError(`Template item name exceeds ${MAX_NAME_BYTES} UTF-8 bytes.`, { position: index });
    }
    if (item.notes !== undefined && Buffer.byteLength(item.notes, "utf8") > MAX_NOTES_BYTES) {
      throw new ValidationError(`Template item notes exceed ${MAX_NOTES_BYTES} UTF-8 bytes.`, { position: index });
    }
  }
}

/** Um `Requirement` já existente no Subject, na forma mínima que o planejador precisa — nunca o
 * tipo `Requirement` inteiro, para que o planejador continue puro e testável isolado. */
export interface ExistingRequirementForPlan {
  requirementId: string;
  name: string;
  sourceTemplateItemId?: string;
}

export type TemplateApplicationSkipReason = "DUPLICATE_NAME";

export interface TemplateApplicationPlan {
  create: RequirementTemplateItem[];
  skip: Array<{
    templateItemId: string;
    name: string;
    reason: TemplateApplicationSkipReason;
    /** O `Requirement` já existente que causou o skip. */
    existingRequirementId: string;
    /** `true` quando o requisito colidente veio do MESMO item deste template (reaplicação);
     * `false` quando é uma colisão com um requisito criado por outro caminho. Só melhora a
     * mensagem — nunca é a chave da exclusão, que é sempre o nome normalizado. */
    sameTemplateItem: boolean;
  }>;
}

/**
 * Planejador puro — sem I/O, sem relógio, sem tenant. UMA implementação, DOIS call sites
 * (`previewTemplateApplication` e `applyTemplate`).
 *
 * Contrato de honestidade declarado (condição do Codex Rodadas 2/3): preview e apply **não podem
 * divergir algoritmicamente; podem divergir temporalmente**. `skip` significa "observado como
 * duplicado durante o planejamento" e NÃO é protegido transacionalmente — só `create` é. Um skip
 * obsoleto custa um requisito a menos criado, nunca uma duplicata nem dado corrompido.
 *
 * A dedupe é por NOME NORMALIZADO, não por `templateItemId`: a "duplicidade óbvia" que o roadmap
 * pede é a que o usuário enxerga — "CND Federal" já existe neste Subject, tanto faz por qual
 * caminho foi criada.
 */
export function planTemplateApplication(
  items: ReadonlyArray<RequirementTemplateItem>,
  existing: ReadonlyArray<ExistingRequirementForPlan>,
): TemplateApplicationPlan {
  assertTemplateItemNamesUnique(items);

  const byNormalizedName = new Map<string, ExistingRequirementForPlan>();
  for (const requirement of existing) {
    const normalized = normalizeDisplayName(requirement.name);
    if (!byNormalizedName.has(normalized)) byNormalizedName.set(normalized, requirement);
  }

  const plan: TemplateApplicationPlan = { create: [], skip: [] };
  for (const item of items) {
    const collision = byNormalizedName.get(normalizeDisplayName(item.name));
    if (collision) {
      plan.skip.push({
        templateItemId: item.templateItemId,
        name: item.name,
        reason: "DUPLICATE_NAME",
        existingRequirementId: collision.requirementId,
        sameTemplateItem: collision.sourceTemplateItemId === item.templateItemId,
      });
    } else {
      plan.create.push(item);
    }
  }
  return plan;
}

/**
 * LIMITE SUPERIOR do tamanho contabilizado pelo DynamoDB — nunca uma medição exata (a régua da
 * Rodada 3 prometia exatidão e o Codex mostrou que "soma de nomes + valores" não modela o
 * overhead estrutural de listas/mapas/tipos; a régua foi corrigida, não o design forçado a caber
 * nela). O nome carrega `UpperBound` para que nenhum call site futuro o leia como exato.
 *
 * Um tipo não coberto LANÇA em vez de contribuir zero — sem isso a propriedade "comprovadamente
 * superior" não valeria genericamente (condição explícita do Codex na Rodada 4).
 */
export function estimateDynamoItemBytesUpperBound(item: Record<string, unknown>): number {
  let total = 0;
  for (const [name, value] of Object.entries(item)) {
    total += Buffer.byteLength(name, "utf8") + dynamoValueBytesUpperBound(value) + 4;
  }
  return total;
}

function dynamoValueBytesUpperBound(value: unknown): number {
  if (value === null || value === undefined) return 1;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number") return 21;
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  if (Array.isArray(value)) return value.reduce<number>((sum, element) => sum + 1 + dynamoValueBytesUpperBound(element), 3);
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).reduce<number>(
      (sum, [key, nested]) => sum + Buffer.byteLength(key, "utf8") + 1 + dynamoValueBytesUpperBound(nested),
      3,
    );
  }
  throw new Error(`estimateDynamoItemBytesUpperBound: unsupported value type "${typeof value}" — cannot bound its size.`);
}
