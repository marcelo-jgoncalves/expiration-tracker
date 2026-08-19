/** Parses `GSI3SK = TENANT#<tenantId>#OCCURRENCE#<occurrenceId>` back into its parts - used by the ReminderProducer to reconstruct tenant context from a GSI3 query result before the strongly-consistent base-item read (data-model.md §3: "tenantId preservado... para reconstrução segura do contexto"). */
export function parseGsi3Sk(gsi3sk: string): { tenantId: string; occurrenceId: string } {
  const match = /^TENANT#(.+)#OCCURRENCE#(.+)$/.exec(gsi3sk);
  if (!match) {
    throw new Error(`Malformed GSI3SK: ${gsi3sk}`);
  }
  return { tenantId: match[1] as string, occurrenceId: match[2] as string };
}
