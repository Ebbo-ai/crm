import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Printer, Search, ArrowUp, ArrowDown } from "lucide-react";
import { parseLocalDate } from "@/lib/constants";
import { clientStateLabel } from "@shared/client-state";
import type { ClientRosterResponse, RosterRow } from "@shared/roster";

/**
 * Client roster — every active client on one printable page.
 *
 * Two rules shape everything here. Missing data renders blank, never a zero or
 * a dash, so a gap in the record looks like a gap and can be chased. And no
 * client is silently dropped: clients outside the active window are listed
 * separately with the reason rather than quietly filtered away.
 */

/** Clients this far along are still serviced, so they stay on the roster, marked. */
const WINDING_DOWN_STATES = new Set(["TERMINATING", "RUN_OUT"]);

type SortKey = "clientName" | "anniversary";
type SortDir = "asc" | "desc";

/**
 * Group numbers are inconsistently padded in the source data — both "S-020" and
 * "S-20" exist and both are correct as stored. Matching normalises the padding
 * so either spelling finds the client; the stored code is never rewritten.
 */
function normalizeCode(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(?<=[a-z])0+(?=\d)/g, "");
}

/** Month and day only: the anniversary's year is incidental to when it recurs. */
function formatAnniversary(value: string | null): string {
  if (!value) return "";
  try {
    return parseLocalDate(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

/** Sortable position in the year, so anniversaries order by when they come round. */
function anniversarySortValue(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY; // blanks last, both directions
  try {
    const d = parseLocalDate(value);
    return d.getMonth() * 100 + d.getDate();
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const COLUMNS: { key: string; label: string; sortKey?: SortKey; align?: string }[] = [
  { key: "clientName", label: "Client", sortKey: "clientName" },
  { key: "groupNumber", label: "Group #" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "employees", label: "Employees", align: "right" },
  { key: "planType", label: "Plan Type" },
  { key: "anniversary", label: "Anniversary", sortKey: "anniversary" },
  { key: "broker", label: "Broker" },
  { key: "brokerEmail", label: "Broker Email" },
  { key: "brokerPhone", label: "Broker Phone" },
];

const PRINT_STYLES = `
@page { size: landscape; margin: 0.4in; }
@media print {
  body * { visibility: hidden; }
  #client-roster-print, #client-roster-print * { visibility: visible; }
  #client-roster-print {
    position: absolute; left: 0; top: 0; width: 100%;
    font-size: 8.5pt; color: #000;
  }
  .roster-no-print { display: none !important; }
  .roster-print-only { display: block !important; }
  /* Repeat the header on every page so column meaning survives the page break. */
  #client-roster-print thead { display: table-header-group; }
  #client-roster-print tr { page-break-inside: avoid; }
  #client-roster-print th, #client-roster-print td {
    padding: 3px 5px !important; border-bottom: 1px solid #ccc;
  }
  #client-roster-print th { border-bottom: 1.5px solid #000; font-weight: 700; }
}
`;

export function ClientRosterReport() {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("clientName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const { data, isLoading, isError } = useQuery<ClientRosterResponse>({
    queryKey: ["/api/reports/client-roster"],
    queryFn: () =>
      fetch("/api/reports/client-roster", { credentials: "include" }).then(r => {
        if (!r.ok) throw new Error("Failed to load the client roster");
        return r.json();
      }),
  });

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const q = filter.trim();
    const filtered = !q
      ? all
      : all.filter(r => {
          const name = r.clientName.toLowerCase().includes(q.toLowerCase());
          const code = r.groupNumber
            ? normalizeCode(r.groupNumber).includes(normalizeCode(q))
            : false;
          return name || code;
        });

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "anniversary") {
        const av = anniversarySortValue(a.anniversaryDate);
        const bv = anniversarySortValue(b.anniversaryDate);
        // Blanks stay at the bottom regardless of direction.
        if (av !== bv) {
          if (!isFinite(av)) return 1;
          if (!isFinite(bv)) return -1;
          return (av - bv) * dir;
        }
        return a.clientName.localeCompare(b.clientName);
      }
      return a.clientName.localeCompare(b.clientName) * dir;
    });
  }, [data, filter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full max-w-sm rounded-lg" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        Could not load the client roster. Try reloading the page.
      </div>
    );
  }

  const { summary, excluded } = data;
  const generated = new Date(data.generatedAt).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  return (
    <div className="space-y-5">
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

      <div className="roster-no-print flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter by client name or group number…"
            className="pl-9"
            data-testid="input-roster-filter"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground" data-testid="text-roster-count">
            {rows.length === summary.totalRows
              ? `${summary.totalRows} clients`
              : `${rows.length} of ${summary.totalRows} clients`}
          </span>
          <Button
            variant="outline"
            className="gap-2 text-sm"
            onClick={() => window.print()}
            data-testid="button-print-roster"
          >
            <Printer className="w-4 h-4" /> Print
          </Button>
        </div>
      </div>

      <div id="client-roster-print">
        <div className="roster-print-only hidden mb-3">
          <h1 style={{ fontSize: "14pt", fontWeight: 700, margin: 0 }}>Client Roster</h1>
          <p style={{ fontSize: "8.5pt", margin: "2px 0 0" }}>
            {rows.length} {rows.length === 1 ? "client" : "clients"} · Generated {generated}
          </p>
        </div>

        <div className="rounded-xl border bg-card overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/40">
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    className={`px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap ${
                      col.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {col.sortKey ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.sortKey!)}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        data-testid={`button-sort-${col.key}`}
                      >
                        {col.label}
                        {sortKey === col.sortKey &&
                          (sortDir === "asc"
                            ? <ArrowUp className="w-3 h-3" />
                            : <ArrowDown className="w-3 h-3" />)}
                      </button>
                    ) : col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <RosterTableRow key={row.clientId} row={row} />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-3 py-10 text-center text-muted-foreground">
                    No clients match "{filter}".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <RosterNotes summary={summary} excludedCount={excluded.length} />
      </div>

      {excluded.length > 0 && (
        <details className="roster-no-print rounded-xl border bg-card p-4" data-testid="details-roster-excluded">
          <summary className="cursor-pointer text-sm font-semibold">
            {excluded.length} {excluded.length === 1 ? "client" : "clients"} not on this roster
          </summary>
          <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
            {excluded.map(e => (
              <li key={e.clientId}>
                <span className="font-medium text-foreground">{e.clientName}</span>
                {e.groupNumber ? ` (${e.groupNumber})` : ""} — {e.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function RosterTableRow({ row }: { row: RosterRow }) {
  const windingDown = WINDING_DOWN_STATES.has(row.clientState);

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-roster-${row.clientId}`}>
      <td className="px-3 py-2 font-medium">
        {row.clientName}
        {windingDown && (
          <span
            className="ml-2 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-warning/15 text-warning-strong whitespace-nowrap"
            data-testid={`badge-roster-state-${row.clientId}`}
          >
            {clientStateLabel(row.clientState as any)}
          </span>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{row.groupNumber ?? ""}</td>
      <td className="px-3 py-2">{row.city ?? ""}</td>
      <td className="px-3 py-2 whitespace-nowrap">{row.state ?? ""}</td>
      {/* Blank, never zero: no client has a recorded headcount yet, and a zero
          would read as a real number rather than a gap in the record. */}
      <td className="px-3 py-2 text-right tabular-nums">
        {row.numberOfEmployees != null ? row.numberOfEmployees.toLocaleString() : ""}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{row.planType ?? ""}</td>
      <td className="px-3 py-2 whitespace-nowrap">{formatAnniversary(row.anniversaryDate)}</td>
      <td className="px-3 py-2">
        {row.brokerName ?? ""}
        {row.brokerFirmName && (
          <span className="block text-xs text-muted-foreground">{row.brokerFirmName}</span>
        )}
      </td>
      <td className="px-3 py-2 break-all">{row.brokerEmail ?? ""}</td>
      <td className="px-3 py-2 whitespace-nowrap">{row.brokerPhone ?? ""}</td>
    </tr>
  );
}

/** Data-quality footnotes, so a printed roster says what it does not know. */
function RosterNotes({
  summary,
  excludedCount,
}: {
  summary: ClientRosterResponse["summary"];
  excludedCount: number;
}) {
  const notes: string[] = [];
  if (summary.missingEmployeeCount > 0) {
    notes.push(`${summary.missingEmployeeCount} without a recorded employee count`);
  }
  if (summary.blankCity > 0 || summary.blankState > 0) {
    notes.push(`${Math.max(summary.blankCity, summary.blankState)} without a city or state`);
  }
  if (summary.noBrokerOnFile > 0) notes.push(`${summary.noBrokerOnFile} with no broker on file`);
  if (summary.brokerMissingEmail > 0) {
    notes.push(`${summary.brokerMissingEmail} with a broker but no email`);
  }
  if (summary.brokerMissingPhone > 0) {
    notes.push(`${summary.brokerMissingPhone} with a broker but no phone`);
  }
  if (summary.planTypeUnresolved.length > 0) {
    notes.push(`no plan type derivable for ${summary.planTypeUnresolved.join(", ")}`);
  }
  if (excludedCount > 0) notes.push(`${excludedCount} closed clients not listed`);

  const planTypes = Object.entries(summary.planTypeCounts).filter(([, n]) => n > 0);

  return (
    <div className="mt-3 text-xs text-muted-foreground space-y-1" data-testid="text-roster-notes">
      {planTypes.length > 0 && (
        <p>Plan type: {planTypes.map(([t, n]) => `${t} ${n}`).join(" · ")}</p>
      )}
      {notes.length > 0 && <p>Blank fields: {notes.join(" · ")}.</p>}
    </div>
  );
}
