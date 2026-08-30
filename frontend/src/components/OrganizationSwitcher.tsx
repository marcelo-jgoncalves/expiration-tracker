/**
 * Organization switcher (Wave B2B-10, "switcher" scope item) - a native `<select>` (accessible
 * by construction, no dropdown widget to build/test) listing every Organization the user
 * belongs to (`useOrganizationsList`), with the currently active one selected
 * (`useActiveOrganization`). Reuses `.ui-field*` classes from `components/forms/Form.css`
 * (already imported by `TextField.tsx`) rather than introducing new CSS - structural shell,
 * final visual design deferred per `AppShell.tsx`'s own convention.
 *
 * Renders nothing when there is only 0 or 1 Organization (no real choice to make) or while the
 * list hasn't resolved yet - never a disabled/empty switcher taking up shell space for a user
 * who will never have more than one Organization.
 */
import { useId } from "react";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { useOrganizationsList } from "../hooks/useOrganizationsList.js";
import "./forms/Form.css";

export function OrganizationSwitcher() {
  const id = useId();
  const { organizationId, switching, select } = useActiveOrganization();
  const organizationsQuery = useOrganizationsList();

  if (!organizationsQuery.data || organizationsQuery.data.organizations.length < 2) return null;

  return (
    <div className="ui-field app-shell__org-switcher">
      <label className="ui-field__label" htmlFor={id}>
        Organização
      </label>
      <select
        id={id}
        className="ui-field__control"
        value={organizationId ?? ""}
        disabled={switching}
        aria-busy={switching ? true : undefined}
        onChange={(event) => select(event.target.value)}
      >
        {organizationsQuery.data.organizations.map((org) => (
          <option key={org.organizationId} value={org.organizationId}>
            {org.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
