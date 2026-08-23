/**
 * DocumentChasingMaterializer — M10 cluster 4 (D-039/D-046). Simplificação deliberada frente a
 * `ReminderMaterializer`: sem timezone/local-time/DST (não há preferência de horário local por
 * `DocumentRequest` em v1 — só o preset fechado `document-request-standard-v1`, D-039 "sem
 * condições arbitrárias... presets versionados"), offsets sempre em UTC, ancorados em
 * `tokenExpiresAt` (não em `deadline` diretamente — `tokenExpiresAt` já incorpora o cap de
 * `deadline` quando presente, é o instante real em que o link do convidado morre, ver
 * `document-request-service.ts`).
 *
 * Idempotente do mesmo jeito que `ReminderMaterializer`: `occurrenceId` derivado
 * deterministicamente (hash da chave de idempotência), criação via `putIfAbsent`.
 */
import { chasingGsi3Keys, documentChasingOccurrenceKey, type DocumentChasingOccurrence, type DocumentChasingTier } from "../domain/document-chasing.js";
import { stableHash } from "../../reminder/domain/reminder-occurrence.js";
import { activeGenerations, type ShardConfig } from "../../reminder/domain/shard-config.js";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

/** Porta deliberadamente estreita (mesmo espírito de `ReminderProducerStore` vs. `ReminderStore`)
 * — o materializer só precisa de `putIfAbsent`, nunca do resto de `SubjectStore`. */
export interface ChasingMaterializerStore {
  putIfAbsent<T extends EntityKey>(item: T): Promise<boolean>;
}

/** T7/T3 antes de `tokenExpiresAt`; EXPIRED exatamente em `tokenExpiresAt` (preset
 * `document-request-standard-v1` simplificado — D-039 lista T-30/T-14/T-7/T-3+EXPIRED, mas a
 * janela real de um DocumentRequest é ≤14 dias, então T-30/T-14 raramente teriam efeito; T7/T3
 * cobrem o caso real). */
const TIER_OFFSETS_MS: Record<Exclude<DocumentChasingTier, "EXPIRED">, number> = {
  T7: 7 * 24 * 60 * 60_000,
  T3: 3 * 24 * 60 * 60_000,
};

function idempotencyKey(input: { tenantId: string; documentRequestId: string; documentRequestVersion: number; tier: DocumentChasingTier; scheduledAt: string }): string {
  return [input.tenantId, input.documentRequestId, input.documentRequestVersion, input.tier, input.scheduledAt].join("|");
}

export interface MaterializeChasingInput {
  tenantId: string;
  subjectId: string;
  assignmentId: string;
  documentRequestId: string;
  documentRequestVersion: number;
  tokenExpiresAt: string;
  shardConfig: ShardConfig;
}

export interface MaterializeChasingResult {
  created: DocumentChasingOccurrence[];
  skippedExisting: number;
  skippedPast: DocumentChasingTier[];
}

export class DocumentChasingMaterializer {
  constructor(
    private readonly store: ChasingMaterializerStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Materializa os 3 tiers para um `DocumentRequest`. Tiers cujo horário calculado já passou
   * no momento da materialização são pulados (nunca criam ocorrência "fantasma" que o
   * lookback de 5min do producer nunca alcançaria) — EXCETO EXPIRED, que por definição nunca
   * está no passado no momento da criação (`tokenExpiresAt` é sempre futuro nesse instante). */
  async materialize(input: MaterializeChasingInput): Promise<MaterializeChasingResult> {
    const created: DocumentChasingOccurrence[] = [];
    const skippedPast: DocumentChasingTier[] = [];
    let skippedExisting = 0;

    const generation = activeGenerations(input.shardConfig, this.now())[0]!;
    const nowMs = Date.parse(this.now());
    const expiresAtMs = Date.parse(input.tokenExpiresAt);

    const tiers: { tier: DocumentChasingTier; scheduledAtMs: number }[] = [
      { tier: "T7", scheduledAtMs: expiresAtMs - TIER_OFFSETS_MS.T7 },
      { tier: "T3", scheduledAtMs: expiresAtMs - TIER_OFFSETS_MS.T3 },
      { tier: "EXPIRED", scheduledAtMs: expiresAtMs },
    ];

    for (const { tier, scheduledAtMs } of tiers) {
      if (tier !== "EXPIRED" && scheduledAtMs <= nowMs) {
        skippedPast.push(tier);
        continue;
      }

      const scheduledAt = new Date(scheduledAtMs).toISOString();
      const key = idempotencyKey({
        tenantId: input.tenantId,
        documentRequestId: input.documentRequestId,
        documentRequestVersion: input.documentRequestVersion,
        tier,
        scheduledAt,
      });
      const occurrenceId = `chase_${stableHash(key).toString(16)}`;
      const now = this.now();
      const gsi3 = chasingGsi3Keys({
        tenantId: input.tenantId,
        occurrenceId,
        scheduledAt,
        shardCount: generation.shardCount,
      });

      const occurrence: DocumentChasingOccurrence = {
        ...documentChasingOccurrenceKey(input.tenantId, input.subjectId, input.assignmentId, input.documentRequestId, scheduledAt, occurrenceId),
        entityType: "DocumentChasingOccurrence",
        occurrenceId,
        tenantId: input.tenantId,
        subjectId: input.subjectId,
        assignmentId: input.assignmentId,
        documentRequestId: input.documentRequestId,
        tier,
        scheduledAt,
        documentRequestVersion: input.documentRequestVersion,
        shard: gsi3.shard,
        shardFnVersion: generation.shardFnVersion,
        status: "SCHEDULED",
        version: 1,
        createdAt: now,
        updatedAt: now,
        GSI3PK: gsi3.GSI3PK,
        GSI3SK: gsi3.GSI3SK,
      };

      const wasCreated = await this.store.putIfAbsent(occurrence);
      if (wasCreated) {
        created.push(occurrence);
      } else {
        skippedExisting += 1;
      }
    }

    return { created, skippedExisting, skippedPast };
  }
}
