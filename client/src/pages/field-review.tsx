import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, XCircle, ExternalLink, ListChecks, Undo2, AlertTriangle, History,
  ChevronDown, ChevronRight, GitBranch, Clock,
} from "lucide-react";

interface Candidate {
  proposalId: number;
  proposedValue: string;
  coercedValue: string | null;
  documentId: number;
  documentName: string;
  effectiveDate: string | null;
  sourceLocation: string | null;
}

interface GroupedField {
  key: string;
  clientId: number;
  targetTable: string;
  targetId: number | null;
  targetField: string;
  fieldKey: string;
  fieldLabel: string;
  mappingStatus: "MAPPED" | "UNMAPPED";
  confidence: "normal" | "low";
  isPlanDesignField: boolean;
  state: "CONFLICT" | "NEEDS_REVIEW" | "UNMAPPED" | "MATCHED";
  currentValue: string | null;
  candidates: Candidate[];
  superseded: Candidate[];
}

interface GroupedClient {
  clientId: number;
  clientName: string;
  clientCode: string;
  needsReviewCount: number;
  conflictCount: number;
  unmappedCount: number;
  fields: GroupedField[];
}

interface GroupedResult {
  clients: GroupedClient[];
  totals: { totalProposals: number; superseded: number; matched: number; needsReview: number; conflicts: number; unmapped: number };
}

interface FieldChangeHistoryEntry {
  id: number;
  clientId: number;
  clientName: string;
  clientCode: string;
  targetTable: string;
  targetField: string;
  fieldLabel: string;
  oldValue: string | null;
  newValue: string;
  sourceDocumentName: string | null;
  confirmedBy: string;
  confirmedAt: string;
  undoneBy: string | null;
  undoneAt: string | null;
}

function fmtDate(iso: string | null) {
  if (!iso) return "undated";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function CandidateConfirm({
  candidate,
  fieldLabel,
  disabledConfirm,
  selected,
  onToggleSelect,
  showSelect,
}: {
  candidate: Candidate;
  fieldLabel: string;
  disabledConfirm?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  showSelect?: boolean;
}) {
  const { toast } = useToast();
  const [editedValue, setEditedValue] = useState(candidate.proposedValue);
  const [overwriteWarning, setOverwriteWarning] = useState<{ currentValue: string } | null>(null);

  const accept = useMutation({
    mutationFn: (force: boolean) =>
      apiRequest("POST", `/api/field-proposals/${candidate.proposalId}/accept`, { value: editedValue, force }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-proposals/grouped"] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-proposals/history"] });
      setOverwriteWarning(null);
      toast({ title: "Applied", description: `${fieldLabel} written to the record.` });
    },
    onError: (err: any) => {
      let payload: any = null;
      try { payload = JSON.parse(err.message.slice(err.message.indexOf("{"))); } catch { /* not structured */ }
      if (payload?.currentValue !== undefined) {
        setOverwriteWarning({ currentValue: payload.currentValue });
        return;
      }
      toast({ title: "Failed", description: payload?.message || err.message, variant: "destructive" });
    },
  });

  const reject = useMutation({
    mutationFn: () => apiRequest("POST", `/api/field-proposals/${candidate.proposalId}/reject`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-proposals/grouped"] });
      toast({ title: "Rejected", description: `${fieldLabel} dismissed.` });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const busy = accept.isPending || reject.isPending;

  return (
    <div className="flex items-start justify-between gap-3 border border-border rounded-md px-3 py-2.5" data-testid={`candidate-${candidate.proposalId}`}>
      <div className="flex items-start gap-2 min-w-0 flex-1">
        {showSelect && (
          <Checkbox checked={!!selected} onCheckedChange={onToggleSelect} disabled={disabledConfirm} className="mt-1" data-testid={`checkbox-select-${candidate.proposalId}`} />
        )}
        <div className="min-w-0 flex-1">
          {disabledConfirm ? (
            <p className="text-sm font-semibold text-brand mt-0.5">{candidate.proposedValue}</p>
          ) : (
            <Input
              value={editedValue}
              onChange={(e) => setEditedValue(e.target.value)}
              className="h-8 text-sm font-semibold text-brand max-w-xs"
              disabled={busy}
              data-testid={`input-value-${candidate.proposalId}`}
            />
          )}
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {fmtDate(candidate.effectiveDate)} · {candidate.documentName}
          </p>
          {candidate.sourceLocation && <p className="text-xs text-muted-foreground mt-0.5">Source: {candidate.sourceLocation}</p>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Button size="sm" variant="outline" className="border-danger text-danger-strong hover:bg-danger-tint h-7 px-2" disabled={busy} onClick={() => reject.mutate()} data-testid={`button-reject-${candidate.proposalId}`}>
          <XCircle className="w-3.5 h-3.5" />
        </Button>
        {!disabledConfirm && (
          <Button size="sm" className="bg-brand hover:bg-brand-dark h-7" disabled={busy || !editedValue.trim()} onClick={() => accept.mutate(false)} data-testid={`button-accept-${candidate.proposalId}`}>
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            Confirm
          </Button>
        )}
      </div>

      <Dialog open={!!overwriteWarning} onOpenChange={(open) => !open && setOverwriteWarning(null)}>
        <DialogContent data-testid={`dialog-overwrite-${candidate.proposalId}`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning-strong" />
              Overwrite existing value?
            </DialogTitle>
            <DialogDescription>
              {fieldLabel} is currently <strong>{overwriteWarning?.currentValue}</strong> on the record. Confirming will
              replace it with <strong>{editedValue}</strong>. This is logged and can be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverwriteWarning(null)}>Cancel</Button>
            <Button className="bg-brand hover:bg-brand-dark" onClick={() => accept.mutate(true)}>Overwrite</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FieldRow({
  field,
  selected,
  onToggleSelect,
}: {
  field: GroupedField;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [showSuperseded, setShowSuperseded] = useState(false);
  const isConflict = field.state === "CONFLICT";
  const isUnmapped = field.state === "UNMAPPED";
  const isMatched = field.state === "MATCHED";
  const isLowConfidence = field.confidence === "low";
  const canBulkSelect = field.state === "NEEDS_REVIEW" && !isLowConfidence;

  return (
    <div className="border border-border rounded-lg px-4 py-3" data-testid={`field-row-${field.key}`}>
      <div className="flex items-start gap-3">
        {canBulkSelect && (
          <Checkbox checked={selected} onCheckedChange={onToggleSelect} className="mt-1" data-testid={`checkbox-field-${field.key}`} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="text-sm font-medium text-foreground">{field.fieldLabel}</p>
            {isConflict && (
              <Badge variant="outline" className="text-xs border-danger text-danger-strong gap-1">
                <GitBranch className="w-3 h-3" />
                Conflict — recent documents disagree
              </Badge>
            )}
            {isUnmapped && (
              <Badge variant="outline" className="text-xs border-muted-foreground text-muted-foreground">
                Unmapped — no matching field on record
              </Badge>
            )}
            {isMatched && (
              <Badge variant="outline" className="text-xs border-success text-success gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Matches record
              </Badge>
            )}
            {isLowConfidence && (
              <Badge variant="outline" className="text-xs border-warning text-warning-strong gap-1">
                <AlertTriangle className="w-3 h-3" />
                Low confidence — from PPR, verify against plan doc/signed renewal
              </Badge>
            )}
          </div>
          {field.currentValue && !isMatched && (
            <p className="text-xs text-muted-foreground mb-2">Currently on file: {field.currentValue}</p>
          )}

          <div className="space-y-2">
            {field.candidates.map((c) => (
              <CandidateConfirm
                key={c.proposalId}
                candidate={c}
                fieldLabel={field.fieldLabel}
                disabledConfirm={isUnmapped || isMatched}
                selected={selected}
                onToggleSelect={onToggleSelect}
                showSelect={false}
              />
            ))}
          </div>

          {field.superseded.length > 0 && (
            <div className="mt-2">
              <button
                className="text-xs text-muted-foreground hover:text-brand flex items-center gap-1"
                onClick={() => setShowSuperseded((v) => !v)}
                data-testid={`button-toggle-superseded-${field.key}`}
              >
                {showSuperseded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {field.superseded.length} earlier version{field.superseded.length === 1 ? "" : "s"} (superseded)
              </button>
              {showSuperseded && (
                <div className="mt-2 space-y-1.5 pl-4 border-l-2 border-border">
                  {field.superseded.map((s) => (
                    <p key={s.proposalId} className="text-xs text-muted-foreground" data-testid={`superseded-${s.proposalId}`}>
                      <span className="line-through">{s.proposedValue}</span> — {fmtDate(s.effectiveDate)} · {s.documentName}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ClientCard({ client, defaultOpen }: { client: GroupedClient; defaultOpen: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(defaultOpen);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const bulkAccept = useMutation({
    mutationFn: (ids: number[]) => apiRequest("POST", "/api/field-proposals/bulk-accept", { ids }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      const okCount = data.results.filter((r: any) => r.ok).length;
      const failCount = data.results.length - okCount;
      queryClient.invalidateQueries({ queryKey: ["/api/field-proposals/grouped"] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-proposals/history"] });
      setSelected(new Set());
      toast({
        title: "Bulk confirm complete",
        description: failCount > 0 ? `${okCount} applied, ${failCount} skipped (see individual rows).` : `${okCount} field(s) applied.`,
      });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const toggle = (proposalId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(proposalId)) next.delete(proposalId); else next.add(proposalId);
      return next;
    });
  };

  return (
    <Card data-testid={`client-card-${client.clientId}`}>
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {open ? <ChevronDown className="w-4 h-4 text-brand flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-brand flex-shrink-0" />}
            <Link href={`/clients/${client.clientId}`} onClick={(e) => e.stopPropagation()}>
              <span className="text-sm font-semibold text-brand hover:underline inline-flex items-center gap-1">
                {client.clientName} ({client.clientCode})
                <ExternalLink className="w-3 h-3" />
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={bulkAccept.isPending}
                onClick={(e) => { e.stopPropagation(); bulkAccept.mutate(Array.from(selected)); }}
                data-testid={`button-bulk-confirm-${client.clientId}`}
              >
                Confirm {selected.size} selected
              </Button>
            )}
            <Badge variant="outline" data-testid={`badge-count-${client.clientId}`}>
              {client.needsReviewCount} field{client.needsReviewCount === 1 ? "" : "s"}
              {client.conflictCount > 0 ? `, ${client.conflictCount} conflict${client.conflictCount === 1 ? "" : "s"}` : ""}
            </Badge>
            {client.unmappedCount > 0 && (
              <Badge variant="outline" className="text-muted-foreground" data-testid={`badge-unmapped-${client.clientId}`}>
                {client.unmappedCount} unmapped
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-2">
          {client.fields.map((f) => (
            <FieldRow
              key={f.key}
              field={f}
              selected={f.candidates.length === 1 && selected.has(f.candidates[0].proposalId)}
              onToggleSelect={() => toggle(f.candidates[0].proposalId)}
            />
          ))}
        </CardContent>
      )}
    </Card>
  );
}

function HistoryPanel() {
  const { toast } = useToast();
  const { data: history, isLoading } = useQuery<FieldChangeHistoryEntry[]>({
    queryKey: ["/api/field-proposals/history"],
  });

  const undo = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/field-proposals/history/${id}/undo`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-proposals/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-proposals/grouped"] });
      toast({ title: "Reverted", description: "The field was restored to its prior value." });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-24" />;
  if (!history || history.length === 0) return null;

  return (
    <Card data-testid="field-history-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-brand" />
          <p className="text-sm font-semibold text-brand">Recent confirmed changes</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {history.map((h) => (
          <div
            key={h.id}
            className="flex items-start justify-between gap-4 border border-border rounded-lg px-4 py-2.5 text-sm"
            data-testid={`history-row-${h.id}`}
          >
            <div className="min-w-0">
              <p className="font-medium text-foreground">
                {h.fieldLabel} <span className="text-muted-foreground font-normal">on {h.clientName} ({h.clientCode})</span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {h.oldValue ?? "(blank)"} → <span className="text-brand font-semibold">{h.newValue}</span>
                {" · "}from {h.sourceDocumentName || "document"}
                {" · "}confirmed by {h.confirmedBy} on {new Date(h.confirmedAt).toLocaleString()}
              </p>
              {h.undoneAt && (
                <p className="text-xs text-warning-strong mt-0.5">
                  Reverted by {h.undoneBy} on {new Date(h.undoneAt).toLocaleString()}
                </p>
              )}
            </div>
            {!h.undoneAt && (
              <Button size="sm" variant="outline" disabled={undo.isPending} onClick={() => undo.mutate(h.id)} data-testid={`button-undo-${h.id}`}>
                <Undo2 className="w-3.5 h-3.5 mr-1.5" />
                Undo
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

type SortMode = "count_desc" | "count_asc" | "name";

export default function FieldReviewPage() {
  const { data, isLoading } = useQuery<GroupedResult>({
    queryKey: ["/api/field-proposals/grouped"],
  });
  const [sortMode, setSortMode] = useState<SortMode>("count_desc");

  const clients = useMemo(() => {
    const list = data?.clients ? [...data.clients] : [];
    if (sortMode === "count_asc") list.sort((a, b) => a.needsReviewCount - b.needsReviewCount);
    else if (sortMode === "name") list.sort((a, b) => a.clientName.localeCompare(b.clientName));
    else list.sort((a, b) => b.needsReviewCount - a.needsReviewCount);
    return list;
  }, [data, sortMode]);

  return (
    <div data-testid="field-review-page" className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand">Field Review</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Fields Claude read out of imported PPRs, renewal letters, and rate sheets, grouped by client and deduplicated
          across every version of a document. Only the newest proposal per field counts toward review — older versions
          are kept as history, and a value that already matches the record is cleared automatically.
        </p>
      </div>

      {!isLoading && data && (
        <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground" data-testid="totals-bar">
          <span>{data.totals.totalProposals} proposals total</span>
          <span>·</span>
          <span>{data.totals.superseded} superseded</span>
          <span>·</span>
          <span>{data.totals.matched} already matched</span>
          <span>·</span>
          <span className="font-semibold text-foreground">{data.totals.needsReview} need review</span>
          <span>·</span>
          <span className="font-semibold text-danger-strong">{data.totals.conflicts} conflicts</span>
          <span>·</span>
          <span>{data.totals.unmapped} unmapped (no matching record field)</span>
        </div>
      )}

      {!isLoading && clients.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Sort clients by</span>
          <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
            <SelectTrigger className="h-8 w-52 text-xs" data-testid="select-sort-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="count_desc">Most fields to review first</SelectItem>
              <SelectItem value="count_asc">Fewest fields to review first</SelectItem>
              <SelectItem value="name">Client name</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {isLoading && <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>}

      {!isLoading && clients.length === 0 && (
        <div className="py-16 text-center" data-testid="empty-field-review">
          <ListChecks className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Nothing waiting for review.</p>
        </div>
      )}

      <div className="space-y-3">
        {clients.map((c, i) => (
          <ClientCard key={c.clientId} client={c} defaultOpen={i === 0 && c.needsReviewCount > 0} />
        ))}
      </div>

      <HistoryPanel />
    </div>
  );
}
