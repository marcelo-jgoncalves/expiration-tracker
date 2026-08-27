/**
 * UrgencyIndicator (mission §32) — urgency is NOT status, and the design system must be able
 * to show both at once without ambiguity ("Situação: Ativo" + "Urgência: Vence em 3 dias").
 *
 * It reuses the StatusBadge primitive rather than inventing a second badge shape: the visual
 * vocabulary for "a compact semantic attribute of a record" should be one vocabulary. What
 * makes it a *different* component is the semantics it carries — it is always derived from a
 * `UrgencyPresentation` (which owns the clock and the 7-day threshold), and it always
 * announces itself as urgency to assistive technology.
 */
import type { UrgencyPresentation } from "../../api/presentation.js";
import { StatusBadge } from "./StatusBadge.js";

export function UrgencyIndicator({ urgency }: { urgency: UrgencyPresentation }) {
  return <StatusBadge presentation={urgency} srPrefix="Urgência" />;
}
