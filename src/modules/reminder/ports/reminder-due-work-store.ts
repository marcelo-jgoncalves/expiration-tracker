import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { ReminderDueWorkItem } from "../domain/reminder-due-work.js";

export interface DueWorkPage {
  items: ReminderDueWorkItem[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ReminderDueWorkStore {
  queryDuePage(input: {
    partitionKey: string;
    upperBound: string;
    exclusiveStartKey?: Record<string, unknown>;
    limit: number;
  }): Promise<DueWorkPage>;
  getMany(keys: EntityKey[]): Promise<{ items: ReminderDueWorkItem[]; unprocessedKeys: EntityKey[] }>;
}
