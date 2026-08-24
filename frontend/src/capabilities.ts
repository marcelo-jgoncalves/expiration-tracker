/**
 * Capability flags (mission §71-73) - a plain constant object, not a feature-flag framework
 * (mission §71: "não criar feature flag framework complexo"). Each flag maps 1:1 to a known
 * backend blocker (mission §72); flipping one to true is only correct once its blocker is
 * actually resolved server-side - the UI must never present an action that promises
 * behavior the backend doesn't have (mission §73).
 */
export const CAPABILITIES = {
  /** BLOCKER-A: no route reads/lists Document/DocumentSubmission - only upload/delete exist. */
  documentsReadEnabled: false,
  /** BLOCKER-B: ReminderOccurrence materialization is disconnected from the normal item
   * create/edit path - saving a reminder policy does not yet guarantee delivery. */
  remindersEnabled: false,
  /** BLOCKER-C: the external document-collection loop does not close on its own (no
   * automatic transition, no submission-review queue read route). */
  externalClosureEnabled: false,
  /** GTR-01: no route exposes the requesting organization's identity to an external guest
   * submitter - real (not simulated) requester identity is a backend gap. */
  guestRequesterIdentityEnabled: false,
} as const;

export type CapabilityKey = keyof typeof CAPABILITIES;
