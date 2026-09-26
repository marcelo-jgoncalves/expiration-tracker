/**
 * Composition root for the subject module against real DynamoDB.
 *
 * ADR-0016 Decision A (2026-09-25) retired M9's `RequirementAssignment`/`RequirementService`
 * and M10's guest-upload slice (`DocumentRequestService`/`GuestSubmissionService`/document
 * chasing) — fully substituted by `document-archive`'s `Requirement`/`DocumentRequest` (M10+,
 * status derived from real evidence). This composition root now only wires `SubjectService`
 * (`TrackedSubject` CRUD), which this decision leaves untouched.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbSubjectStore } from "../../../modules/subject/persistence/dynamodb-subject-store.js";
import { SubjectService } from "../../../modules/subject/application/subject-service.js";
import { UlidIdGenerator } from "../ids.js";

export function buildSubjectDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbSubjectStore(client, tableName);
  const ids = new UlidIdGenerator();
  const subjects = new SubjectService({ store, tableName, ids });
  return { store, subjects };
}
