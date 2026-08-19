# Codex — nota cega Rodada 4 (bruta)
codex
## Score: 8.8/10

The merged blueprint is coherent, highly traceable, security-conscious, and substantially implementation-ready. The principal Round 2 technical defects were genuinely corrected:

- GSI3 now uses a queryable global minute/shard partition key, with tenant identity in the sort key, restricted IAM, minimal projection, global capacity modeling, and versioned reshard migration.
- Reminder dispatch now persists `NotificationIntent`, the occurrence transition, idempotency record, and outbox event atomically.
- Cancellation no longer assumes an unbounded `TransactWriteItems`; version invalidation and bounded idempotent reconciliation handle fan-out.
- Failed scheduler ticks are covered by lookback, while expired claims are repaired.
- Audit delivery now has a DLQ, controlled redrive, and reconciliation.
- AWS corrections are present, including DynamoDB transaction limits, CloudWatch’s inability to expose metrics per logical partition-key value, partial `PutEvents` failures, and static CSP constraints.
- Module boundaries are considerably clearer: domain modules use ports/contracts, workers do not import HTTP or one another’s adapters, audit writes are isolated, and arbitrary outbound HTTP is prohibited.
- Milestone ordering is mostly consistent, and quantitative reminder load gates were added.

I did not find a reappearance of the central GSI3, outbox, cancellation-limit, or AWS-factual defects.

However, the document does not yet meet the rubric’s strict 9-point condition:

1. Section 23 explicitly leaves several materially relevant ADRs open, including browser session architecture, provider idempotency, S3 backup/RPO, PDF sandbox limits, DST semantics, retention, and formal ratification of the global GSI3 exception. Under the stated rubric, materially relevant ADRs must be closed for a score of 9 or above.

2. The GSI3 correction is technically sound here but remains explicitly unratified in the normative data model and decision log. That is a real remaining governance gap for a Type 1 decision.

3. The notification text retains a contradiction: §10.3 says every delivery worker first checks the channel kill switch, while §17.3 explicitly says email has no kill switch. M4 also lists a generic “kill switch” although email is its blocking channel and WhatsApp is a later submilestone. This needs “when configured/applicable” wording and milestone clarification.

4. The load gate requires success in only “at least one” of the three modeled drainage scenarios, while the acceptable drainage SLO remains unresolved in `UNK-CAP-006`. This is useful load modeling, but not yet a closed capacity acceptance decision.

5. Section 26 describes itself as a function × trigger × concurrency/DLQ reference, but its table contains no concurrency column or values. Reserved-concurrency protection is required elsewhere, so the promised operational mapping is incomplete.

6. The header prematurely declares the blueprint approved and includes supposed Claude/Codex scores before this blind-scoring step has concluded. That is procedurally inconsistent with blind evaluation, even though it does not invalidate the technical body.

Therefore, this is an excellent 8-range design—very close to 9—but the open Type 1/material ADRs and the remaining internal inconsistencies prevent an honest score of 9.0 or higher.
