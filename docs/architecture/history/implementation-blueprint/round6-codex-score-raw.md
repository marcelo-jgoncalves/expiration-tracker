# Codex — nota cega Rodada 6 (bruta)
codex
## Final blind score: 8.9/10

Three corrections landed correctly:

- §4.2 closes on the BFF session model and explicitly rejects direct Cognito use in the browser.
- §7.3 closes on the dedicated `cognitoSub → userId` mapping item.
- §3.1 and §26 consistently list the same four task Lambdas:
  `TextractTaskHandler`, `PdfParserTaskHandler`, `BedrockExtractionTaskHandler`, and `ExtractionValidationTaskHandler`.

One propagation gap remains: §12.5 does **not** name those four Lambdas or map its workflow states to them. It only lists states such as `RunTextract`, `RunDeterministicParser`, `RunBedrock`, `ValidateSchema`, `CompareExtractors`, and `PersistExtractedFields`.

This is materially ambiguous because §3.1 says “cada estado” invokes an independent named function, while §12.5 has several states intended to be served by only four handlers—especially the three validation/persistence states apparently belonging to `ExtractionValidationTaskHandler`. The exact state-to-handler mapping remains unstated.

Therefore, the claimed §12.5 edit did not actually land, and I cannot conclude that propagation is complete or award ≥9.0 yet. Adding the four function names and their state mappings to §12.5 would resolve the remaining blocker.
