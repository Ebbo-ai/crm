import {
  clientStateLabel,
  deriveClientState,
  runOutEndDate,
  type ClientLifecycleState,
  type ClientStateInput,
} from "@shared/client-state";

/**
 * One badge for client lifecycle state, shared by the list and the detail page.
 *
 * The list and detail badges used to be two copies of the same inline ternary,
 * which is how they ended up disagreeing about the legacy no-status case. State
 * is derived in one place now, and so is the way it is shown.
 *
 * Terminating and run-out carry their closing date in the badge itself, because
 * the whole point is that Kim can see the account is winding down, and roughly
 * when it stops, without opening the record and working it out from a date.
 */

/**
 * Same palette as the badge, in raw hex, for the printable reports. Those build
 * HTML as strings rather than JSX, so they cannot use the component, but they
 * must not drift into showing a terminating client as flatly terminated.
 */
export const CLIENT_STATE_HEX: Record<ClientLifecycleState, { solid: string; bg: string; fg: string }> = {
  ACTIVE:      { solid: "#22C55E", bg: "#DCFCE7", fg: "#166534" },
  PROSPECT:    { solid: "#2E86C1", bg: "#DBEAFE", fg: "#1E40AF" },
  TERMINATING: { solid: "#F59E0B", bg: "#FEF3C7", fg: "#92400E" },
  RUN_OUT:     { solid: "#F97316", bg: "#FFEDD5", fg: "#9A3412" },
  CLOSED:      { solid: "#EF4444", bg: "#FEE2E2", fg: "#991B1B" },
};

const STYLES: Record<ClientLifecycleState, string> = {
  ACTIVE: "bg-success/10 text-success",
  PROSPECT: "bg-brand-accent/10 text-brand-accent",
  TERMINATING: "bg-warning/10 text-warning-strong",
  RUN_OUT: "bg-warning/10 text-warning-strong",
  CLOSED: "bg-danger/10 text-danger",
};

export function clientStateSummary(client: ClientStateInput | null | undefined) {
  const state = deriveClientState(client);
  const closes = runOutEndDate(client?.terminationDate);
  const shortClose = closes
    ? closes.toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : null;
  const longClose = closes
    ? closes.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
    : null;

  let detail: string | null = null;
  let title: string | undefined;

  if (state === "TERMINATING" && shortClose) {
    detail = `to ${shortClose}`;
    title = `Terminating. No renewal is needed. Services, PPRs and claims continue until run-out closes on ${longClose}.`;
  } else if (state === "RUN_OUT" && shortClose) {
    detail = `to ${shortClose}`;
    title = `In run-out. Run-out claims are still being paid, and PPRs continue, until ${longClose}.`;
  } else if (state === "CLOSED") {
    title = longClose
      ? `Closed. Run-out ended ${longClose}.`
      : "Closed. No termination date on file.";
  }

  return { state, label: clientStateLabel(state), detail, title, closes };
}

export function ClientStateBadge({
  client,
  className = "",
  testId,
}: {
  client: ClientStateInput | null | undefined;
  className?: string;
  testId?: string;
}) {
  const { state, label, detail, title } = clientStateSummary(client);

  return (
    <span
      className={`rounded-full font-semibold flex-shrink-0 whitespace-nowrap ${STYLES[state]} ${className}`}
      title={title}
      data-testid={testId}
    >
      {label}
      {detail && <span className="font-normal opacity-80"> {detail}</span>}
    </span>
  );
}
