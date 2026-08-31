import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { MONTHS } from "@/lib/constants";
import {
  Upload, FileSpreadsheet, CheckCircle, AlertCircle, RotateCcw, Clock,
  ChevronDown, ChevronRight, Loader2, X
} from "lucide-react";
import { format } from "date-fns";

interface HeldRow {
  id?: number;
  client_code: string | null;
  plan_name: string | null;
  report_month: number | null;
  report_year: number | null;
  hold_reasons: string[];
  raw_data: Record<string, unknown>;
  status?: "PENDING" | "ACCEPTED" | "DISCARDED";
}

interface RestatedRow {
  clientId: number;
  planId: number;
  reportMonth: number;
  reportYear: number;
  priorPaidClaims: number | null;
  newPaidClaims: number | null;
  priorSubmittedCharges: number | null;
  newSubmittedCharges: number | null;
  reasonCode: string | null;
}

interface ImportResult {
  batchId: number;
  fileName: string;
  rowsAccepted: number;
  rowsUnchanged: number;
  rowsRestated: number;
  rowsHeld: number;
  restated: RestatedRow[];
  held: HeldRow[];
}

interface BatchRecord {
  id: number;
  fileName: string;
  uploadedBy: string;
  uploadedAt: string;
  rowsTotal: number;
  rowsAccepted: number;
  rowsUnchanged: number;
  rowsRestated: number;
  rowsHeld: number;
}

interface Client {
  id: number;
  clientCode: string;
  clientName: string;
}

interface Plan {
  id: number;
  clientId: number;
  planName: string;
}

function fmtCurrency(v: number | null | undefined) {
  if (v == null) return "—";
  return `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function DeltaCell({ before, after }: { before: number | null; after: number | null }) {
  if (before == null && after == null) return <span className="text-muted-foreground">—</span>;
  const diff = (after ?? 0) - (before ?? 0);
  const color = diff === 0 ? "text-muted-foreground" : diff > 0 ? "text-danger" : "text-success";
  return (
    <span className="space-x-1 text-xs">
      <span className="text-muted-foreground">{fmtCurrency(before)}</span>
      <span className="text-muted-foreground">→</span>
      <span className="font-semibold text-foreground">{fmtCurrency(after)}</span>
      {diff !== 0 && (
        <span className={`${color} font-semibold`}>
          ({diff > 0 ? "+" : ""}{fmtCurrency(diff)})
        </span>
      )}
    </span>
  );
}

function AcceptHeldRowDialog({
  row, batchId, onClose, onAccepted
}: {
  row: HeldRow;
  batchId: number;
  onClose: () => void;
  onAccepted: () => void;
}) {
  const { toast } = useToast();
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [reviewNote, setReviewNote] = useState("");

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ["/api/plans"],
    queryFn: () => fetch("/api/plans", { credentials: "include" }).then(r => r.json()),
    enabled: false, // We'll use plans from the held-rows batch endpoint instead
  });

  // Get plans for selected client from the clients list
  const clientPlansQuery = useQuery({
    queryKey: ["/api/clients", selectedClientId, "plans"],
    queryFn: () => selectedClientId
      ? fetch(`/api/clients/${selectedClientId}/plans`, { credentials: "include" }).then(r => r.json())
      : Promise.resolve([]),
    enabled: !!selectedClientId,
  });
  const clientPlans: Plan[] = clientPlansQuery.data ?? [];

  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!row.id) throw new Error("No row ID");
      const res = await fetch(`/api/ppr/held-rows/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          status: "ACCEPTED",
          resolvedClientId: parseInt(selectedClientId),
          resolvedPlanId: parseInt(selectedPlanId),
          reviewNote: reviewNote || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Row accepted and written to performance facts" });
      onAccepted();
      onClose();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-brand">Accept Held Row</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-warning-tint border border-warning-tint rounded-lg p-3 text-sm text-warning-strong">
            <p className="font-medium mb-1">Hold reasons:</p>
            <ul className="space-y-0.5 list-disc list-inside">
              {row.hold_reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground bg-surface-subtle rounded p-3">
            <div><span className="font-medium">From file:</span> {row.client_code || "—"}</div>
            <div><span className="font-medium">Plan:</span> {row.plan_name || "—"}</div>
            <div><span className="font-medium">Month:</span> {row.report_month ? `${MONTHS[(row.report_month ?? 1) - 1]} ${row.report_year}` : "—"}</div>
          </div>

          <div>
            <Label className="text-sm font-medium">Map to Client <span className="text-danger">*</span></Label>
            <Select value={selectedClientId} onValueChange={(v) => { setSelectedClientId(v); setSelectedPlanId(""); }}>
              <SelectTrigger><SelectValue placeholder="Select client…" /></SelectTrigger>
              <SelectContent>
                {clients.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.clientCode} — {c.clientName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedClientId && (
            <div>
              <Label className="text-sm font-medium">Map to Plan <span className="text-danger">*</span></Label>
              <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                <SelectTrigger><SelectValue placeholder="Select plan…" /></SelectTrigger>
                <SelectContent>
                  {clientPlans.map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.planName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label className="text-sm font-medium">Review Note</Label>
            <Input
              value={reviewNote}
              onChange={e => setReviewNote(e.target.value)}
              placeholder="Explain why this row is being accepted…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-brand text-brand-foreground"
            onClick={() => acceptMutation.mutate()}
            disabled={!selectedClientId || !selectedPlanId || acceptMutation.isPending}
          >
            {acceptMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Accept Row
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PprImportPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showRestated, setShowRestated] = useState(true);
  const [showHeld, setShowHeld] = useState(true);
  const [acceptTarget, setAcceptTarget] = useState<HeldRow | null>(null);
  const [heldRows, setHeldRows] = useState<HeldRow[]>([]);

  const { data: batches = [], refetch: refetchBatches } = useQuery<BatchRecord[]>({
    queryKey: ["/api/ppr/import-batches"],
  });

  const importMutation = useMutation({
    mutationFn: async (f: File) => {
      const formData = new FormData();
      formData.append("file", f);
      const res = await fetch("/api/ppr/monthly-import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<ImportResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      setHeldRows(data.held.map((h, i) => ({ ...h, id: undefined }))); // IDs come from DB
      refetchBatches();
      qc.invalidateQueries({ queryKey: ["/api/ppr/import-batches"] });
      toast({
        title: "Import complete",
        description: `${data.rowsAccepted} accepted · ${data.rowsRestated} restated · ${data.rowsHeld} held`,
      });
      // Fetch the held rows with IDs from the batch
      fetch(`/api/ppr/held-rows?batchId=${data.batchId}`, { credentials: "include" })
        .then(r => r.json())
        .then(rows => setHeldRows(rows))
        .catch(() => {});
    },
    onError: (err: any) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const discardMutation = useMutation({
    mutationFn: async (rowId: number) => {
      const res = await fetch(`/api/ppr/held-rows/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "DISCARDED" }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (updated: any) => {
      setHeldRows(prev => prev.map(r => (r.id === updated.id ? { ...r, status: "DISCARDED" } : r)));
      toast({ title: "Row discarded" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const f = files[0];
    if (/\.(csv|xlsx|xls)$/i.test(f.name)) {
      setFile(f);
      setResult(null);
      setHeldRows([]);
    } else {
      toast({ title: "Unsupported file type", description: "Upload a CSV or Excel (.xlsx / .xls) file", variant: "destructive" });
    }
  }

  const pendingHeld = heldRows.filter(r => !r.status || r.status === "PENDING");
  const resolvedHeld = heldRows.filter(r => r.status && r.status !== "PENDING");

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-brand">Monthly Performance Import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload the combined 90 Degree Benefits monthly file (one row per client · plan · month).
          The system distributes rows automatically and flags anything that needs review.
        </p>
      </div>

      {/* Upload card */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-brand">Upload File</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
              ${dragOver ? "border-brand bg-brand/5" : "border-border hover:border-brand/60"}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            data-testid="ppr-import-dropzone"
          >
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".csv,.xlsx,.xls"
              onChange={e => handleFiles(e.target.files)}
            />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileSpreadsheet className="w-8 h-8 text-success-strong flex-shrink-0" />
                <div className="text-left">
                  <p className="font-semibold text-foreground text-sm">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-2 w-6 h-6"
                  onClick={e => { e.stopPropagation(); setFile(null); setResult(null); }}
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              </div>
            ) : (
              <div>
                <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">Drop file here or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">CSV · Excel (.xlsx / .xls) · up to 100 MB</p>
              </div>
            )}
          </div>

          <div className="bg-surface-subtle rounded-lg px-4 py-3 text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-brand">Expected columns</p>
            <p className="font-mono">
              client_code · plan_name · report_month · report_year · ee_count · ee_spouse_count ·
              ee_child_count · family_count · submitted_charges · paid_claims · claim_count ·
              reason_code <span className="text-muted-foreground">(optional)</span> · reason_note
              <span className="text-muted-foreground"> (optional)</span> · release_month
              <span className="text-muted-foreground"> (optional)</span> · release_year
              <span className="text-muted-foreground"> (optional)</span>
            </p>
          </div>

          <Button
            className="bg-brand text-brand-foreground gap-2"
            onClick={() => file && importMutation.mutate(file)}
            disabled={!file || importMutation.isPending}
            data-testid="button-run-import"
          >
            {importMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
            ) : (
              <><Upload className="w-4 h-4" /> Run Import</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* ── Results ──────────────────────────────────────────────────────────── */}
      {result && (
        <div className="space-y-4" data-testid="import-results">
          {/* Summary stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <CheckCircle className="w-8 h-8 text-success flex-shrink-0" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{result.rowsAccepted}</p>
                  <p className="text-xs text-muted-foreground">New months accepted</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <Clock className="w-8 h-8 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{result.rowsUnchanged}</p>
                  <p className="text-xs text-muted-foreground">Unchanged (already on file)</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <RotateCcw className="w-8 h-8 text-warning-strong flex-shrink-0" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{result.rowsRestated}</p>
                  <p className="text-xs text-muted-foreground">Months restated</p>
                </div>
              </CardContent>
            </Card>
            <Card className={`border-0 shadow-sm ${result.rowsHeld > 0 ? "ring-1 ring-danger/30" : ""}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <AlertCircle className={`w-8 h-8 flex-shrink-0 ${result.rowsHeld > 0 ? "text-danger" : "text-muted-foreground"}`} />
                <div>
                  <p className="text-2xl font-bold text-foreground">{result.rowsHeld}</p>
                  <p className="text-xs text-muted-foreground">Rows held for review</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Restated months */}
          {result.restated.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <button
                  className="flex items-center gap-2 text-sm font-semibold text-warning-strong w-full text-left"
                  onClick={() => setShowRestated(v => !v)}
                >
                  {showRestated ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  Restated Months ({result.restated.length})
                  <span className="text-xs font-normal text-muted-foreground ml-1">
                    — prior figures are preserved in history
                  </span>
                </button>
              </CardHeader>
              {showRestated && (
                <CardContent className="pt-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-surface-subtle">
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase">Period</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase">Paid Claims</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase">Submitted Charges</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.restated.map((r, i) => (
                          <tr key={i} className="border-b hover:bg-surface-subtle/30">
                            <td className="px-4 py-2.5 font-semibold text-foreground">
                              {MONTHS[(r.reportMonth ?? 1) - 1]} {r.reportYear}
                            </td>
                            <td className="px-4 py-2.5">
                              <DeltaCell before={r.priorPaidClaims} after={r.newPaidClaims} />
                            </td>
                            <td className="px-4 py-2.5">
                              <DeltaCell before={r.priorSubmittedCharges} after={r.newSubmittedCharges} />
                            </td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">
                              {r.reasonCode || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          {/* Held rows */}
          {heldRows.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <button
                  className="flex items-center gap-2 text-sm font-semibold text-danger w-full text-left"
                  onClick={() => setShowHeld(v => !v)}
                >
                  {showHeld ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  Held Rows ({pendingHeld.length} pending
                  {resolvedHeld.length > 0 ? `, ${resolvedHeld.length} resolved` : ""})
                  <span className="text-xs font-normal text-muted-foreground ml-1">
                    — query the administrator then accept or discard each row
                  </span>
                </button>
              </CardHeader>
              {showHeld && (
                <CardContent className="pt-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-surface-subtle">
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase">Client (from file)</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase">Plan</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase">Period</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase">Hold Reasons</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {heldRows.map((r, i) => (
                          <tr
                            key={r.id ?? i}
                            className={`border-b hover:bg-surface-subtle/30 ${
                              r.status === "ACCEPTED" ? "opacity-50" :
                              r.status === "DISCARDED" ? "opacity-40 line-through" : ""
                            }`}
                            data-testid={`held-row-${r.id ?? i}`}
                          >
                            <td className="px-4 py-2.5 font-mono text-xs font-semibold text-foreground">
                              {r.client_code || "—"}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.plan_name || "—"}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                              {r.report_month ? `${MONTHS[(r.report_month ?? 1) - 1]} ${r.report_year}` : "—"}
                            </td>
                            <td className="px-4 py-2.5">
                              <ul className="space-y-0.5">
                                {r.hold_reasons.map((reason, j) => (
                                  <li key={j} className="text-xs text-danger flex items-start gap-1">
                                    <span className="mt-0.5 flex-shrink-0">•</span>
                                    <span>{reason}</span>
                                  </li>
                                ))}
                              </ul>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              {(!r.status || r.status === "PENDING") ? (
                                <div className="flex items-center justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs border-success text-success hover:bg-success/10"
                                    onClick={() => setAcceptTarget(r)}
                                    data-testid={`button-accept-held-${r.id ?? i}`}
                                  >
                                    Accept
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs border-danger text-danger hover:bg-danger/10"
                                    onClick={() => r.id && discardMutation.mutate(r.id)}
                                    disabled={discardMutation.isPending}
                                    data-testid={`button-discard-held-${r.id ?? i}`}
                                  >
                                    Discard
                                  </Button>
                                </div>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className={r.status === "ACCEPTED"
                                    ? "border-success text-success text-xs"
                                    : "border-muted-foreground text-muted-foreground text-xs"}
                                >
                                  {r.status.toLowerCase()}
                                </Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              )}
            </Card>
          )}
        </div>
      )}

      {/* ── Previous batches ─────────────────────────────────────────────────── */}
      {batches.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-brand">Previous Imports</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-surface-subtle">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase">File</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase hidden md:table-cell">Uploaded</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase">Accepted</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase">Unchanged</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase">Restated</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase">Held</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b, i) => (
                    <tr key={b.id} className={`border-b hover:bg-surface-subtle/30 ${i % 2 === 1 ? "bg-surface-subtle/10" : ""}`}>
                      <td className="px-4 py-2.5 text-xs font-medium text-foreground max-w-[180px] truncate" title={b.fileName}>
                        {b.fileName}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell whitespace-nowrap">
                        {format(new Date(b.uploadedAt), "MMM d, yyyy")} · {b.uploadedBy}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-success font-semibold">{b.rowsAccepted}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{b.rowsUnchanged}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-warning-strong font-semibold">{b.rowsRestated}</td>
                      <td className={`px-4 py-2.5 text-right text-xs font-semibold ${b.rowsHeld > 0 ? "text-danger" : "text-muted-foreground"}`}>
                        {b.rowsHeld}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Accept dialog */}
      {acceptTarget && result && (
        <AcceptHeldRowDialog
          row={acceptTarget}
          batchId={result.batchId}
          onClose={() => setAcceptTarget(null)}
          onAccepted={() => {
            setHeldRows(prev => prev.map(r =>
              r.id === acceptTarget.id ? { ...r, status: "ACCEPTED" } : r
            ));
          }}
        />
      )}
    </div>
  );
}
