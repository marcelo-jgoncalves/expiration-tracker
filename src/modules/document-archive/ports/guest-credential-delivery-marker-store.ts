/**
 * GuestCredentialDeliveryMarkerStore — D-228, closes D-222/D-227's named gap (the delivery
 * worker did not exist). A tiny, separate port from `DocumentArchiveStore` on purpose: it
 * addresses the DEDICATED `guest-credential-delivery` table (D-226 decision central item 5),
 * never the main tenant-facing table `DocumentArchiveStore` wraps — mixing them behind one
 * port would blur the exact isolation boundary that table's own header comment establishes.
 *
 * `claim` is the delivery worker's idempotency guard under DynamoDB Streams' at-least-once
 * redelivery: a conditional Put of a marker row under the SAME `PK` the delivery record
 * itself lives at (`guestCredentialDeliveryKey`'s `PK`, distinct `SK`) — `true` means this
 * exact (documentRequestId, issuanceGeneration) pair has never been claimed before (safe to
 * send), `false` means some earlier delivery (successful or not, see the worker's own
 * doc comment for the resulting trade-off) already claimed it.
 */
export interface GuestCredentialDeliveryMarkerStore {
  claim(documentRequestId: string, issuanceGeneration: number, now: string): Promise<boolean>;
}
