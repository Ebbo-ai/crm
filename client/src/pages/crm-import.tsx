import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Upload, CheckCircle, XCircle, AlertTriangle, FileSpreadsheet, X, Info } from "lucide-react";

interface ImportIssue {
  severity: "error" | "warning";
  sheet: string;
  row?: number;
  ref?: string;
  message: string;
}

interface EntityCounts {
  created: number;
  updated: number;
  unchanged: number;
}

interface ImportResult {
  ok: boolean;
  mode: "validate" | "apply";
  applied: boolean;
  issues: ImportIssue[];
  counts: { clients: EntityCounts; plans: EntityCounts; rateCards: EntityCounts; brokerContacts: EntityCounts };
  brokerContactsRemoved: number;
  tiersRemoved: number;
  notInFile: { clients: string[]; plans: string[] };
  flagged: { ref: string; note: string }[];
}

function CountRow({ label, counts }: { label: string; counts: EntityCounts }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm font-medium text-brand">{label}</span>
      <div className="flex items-center gap-4 text-sm tabular-nums">
        <span className="text-success-strong">
          {counts.created} <span className="text-muted-foreground font-normal">new</span>
        </span>
        <span className="text-brand">
          {counts.updated} <span className="text-muted-foreground font-normal">updated</span>
        </span>
        <span className="text-muted-foreground">{counts.unchanged} unchanged</span>
      </div>
    </div>
  );
}

export default function CrmImportPage() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const run = useMutation({
    mutationFn: async (mode: "validate" | "apply") => {
      if (!file) throw new Error("Choose a file first.");
      const form = new FormData();
      form.append("file", file);
      form.append("mode", mode);
      const res = await fetch("/api/admin/crm-import", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok && !body?.issues) throw new Error(body?.message || "Import failed.");
      return body as ImportResult;
    },
    onSuccess: (data) => {
      setResult(data);
      if (data.applied) {
        queryClient.invalidateQueries();
        const { clients, plans, rateCards } = data.counts;
        toast({
          title: "Import complete",
          description:
            `Clients ${clients.created} new / ${clients.updated} updated. ` +
            `Plans ${plans.created} new / ${plans.updated} updated. ` +
            `Rate rows ${rateCards.created} new / ${rateCards.updated} updated.`,
        });
      } else if (!data.ok) {
        toast({
          title: "File rejected",
          description: "Nothing was written. See the problems listed below.",
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const errors = result?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = result?.issues.filter((i) => i.severity === "warning") ?? [];
  const checked = result !== null && result.mode === "validate" && result.ok;

  function chooseFile(f: File | null) {
    setFile(f);
    setResult(null);
  }

  return (
    <div data-testid="crm-import-page">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand">CRM Data Import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Load the Clients, Plans and Rate Cards workbook. Records are matched on client code, and on plan name,
          coverage and plan year, so a corrected file can be run again to update what is already stored.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <h2 className="font-semibold text-brand">Workbook</h2>
        </CardHeader>
        <CardContent>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            data-testid="input-crm-file"
          />

          {!file ? (
            <div
              onClick={() => inputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-brand transition-colors"
              data-testid="dropzone-crm-file"
            >
              <FileSpreadsheet className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium text-brand">Choose a spreadsheet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Needs Clients, Plans and Rate Cards sheets. All three must carry coverage type.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between border border-border rounded-lg px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <FileSpreadsheet className="w-5 h-5 text-brand flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => chooseFile(null)} data-testid="button-clear-file">
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          <div className="flex items-center gap-3 mt-4">
            <Button
              variant="outline"
              disabled={!file || run.isPending}
              onClick={() => run.mutate("validate")}
              data-testid="button-check-file"
            >
              {run.isPending && run.variables === "validate" ? "Checking…" : "Check file"}
            </Button>
            <Button
              disabled={!checked || run.isPending}
              onClick={() => run.mutate("apply")}
              className="bg-brand hover:bg-brand-dark"
              data-testid="button-apply-import"
            >
              <Upload className="w-4 h-4 mr-2" />
              {run.isPending && run.variables === "apply" ? "Importing…" : "Import"}
            </Button>
            {!checked && file && (
              <span className="text-xs text-muted-foreground">Check the file before importing.</span>
            )}
          </div>
        </CardContent>
      </Card>

      {result && (
        <>
          {errors.length > 0 && (
            <Card className="mb-6 border-danger">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <XCircle className="w-5 h-5 text-danger" />
                  <h2 className="font-semibold text-danger">
                    {errors.length} problem{errors.length === 1 ? "" : "s"} — nothing was written
                  </h2>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2" data-testid="list-errors">
                  {errors.map((e, i) => (
                    <li key={i} className="text-sm flex gap-3">
                      <Badge variant="outline" className="flex-shrink-0 font-mono text-xs">
                        {e.sheet}
                        {e.row ? ` r${e.row}` : ""}
                      </Badge>
                      <span className="text-foreground">
                        {e.ref && <span className="font-medium">{e.ref}: </span>}
                        {e.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {result.ok && (
            <Card className="mb-6">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  {result.applied ? (
                    <CheckCircle className="w-5 h-5 text-success-strong" />
                  ) : (
                    <Info className="w-5 h-5 text-brand" />
                  )}
                  <h2 className="font-semibold text-brand">
                    {result.applied ? "Imported" : "Preview — nothing written yet"}
                  </h2>
                </div>
              </CardHeader>
              <CardContent>
                <CountRow label="Clients" counts={result.counts.clients} />
                <CountRow label="Plans" counts={result.counts.plans} />
                <CountRow label="Rate card rows" counts={result.counts.rateCards} />
                <CountRow label="Broker contacts" counts={result.counts.brokerContacts} />
                {result.tiersRemoved > 0 && (
                  <p className="text-xs text-muted-foreground mt-3">
                    {result.tiersRemoved} tier{result.tiersRemoved === 1 ? "" : "s"} no longer listed for a plan in the
                    workbook {result.applied ? "were removed" : "will be removed"}.
                  </p>
                )}
                {result.brokerContactsRemoved > 0 && (
                  <p className="text-xs text-muted-foreground mt-3">
                    {result.brokerContactsRemoved} broker contact
                    {result.brokerContactsRemoved === 1 ? "" : "s"} no longer listed for a client in the workbook{" "}
                    {result.applied ? "were removed" : "will be removed"}.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {warnings.length > 0 && (
            <Card className="mb-6">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-warning" />
                  <h2 className="font-semibold text-brand">
                    {warnings.length} thing{warnings.length === 1 ? "" : "s"} worth knowing
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground">These do not stop the import.</p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2" data-testid="list-warnings">
                  {warnings.map((w, i) => (
                    <li key={i} className="text-sm flex gap-3">
                      <Badge variant="outline" className="flex-shrink-0 font-mono text-xs">
                        {w.sheet}
                        {w.row ? ` r${w.row}` : ""}
                      </Badge>
                      <span className="text-foreground">
                        {w.ref && <span className="font-medium">{w.ref}: </span>}
                        {w.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {result.flagged.length > 0 && (
            <Card className="mb-6">
              <CardHeader className="pb-3">
                <h2 className="font-semibold text-brand">Rows the workbook flags ({result.flagged.length})</h2>
                <p className="text-xs text-muted-foreground">
                  Notes carried in the file itself. Imported as given; listed here so they are not lost.
                </p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 max-h-72 overflow-y-auto" data-testid="list-flagged">
                  {result.flagged.map((f, i) => (
                    <li key={i} className="text-sm flex gap-3">
                      <span className="font-mono text-xs text-brand flex-shrink-0 w-56 truncate">{f.ref}</span>
                      <span className="text-muted-foreground">{f.note}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {(result.notInFile.clients.length > 0 || result.notInFile.plans.length > 0) && (
            <Card className="mb-6">
              <CardHeader className="pb-3">
                <h2 className="font-semibold text-brand">Already stored, not in this workbook</h2>
                <p className="text-xs text-muted-foreground">
                  Left exactly as they are. The import never deletes a client or a plan, because a workbook covering
                  part of the book is not a statement that everything else has ended.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.notInFile.clients.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-brand mb-1">
                      Clients ({result.notInFile.clients.length})
                    </p>
                    <p className="text-sm text-muted-foreground font-mono">{result.notInFile.clients.join(", ")}</p>
                  </div>
                )}
                {result.notInFile.plans.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-brand mb-1">Plans ({result.notInFile.plans.length})</p>
                    <ul className="text-sm text-muted-foreground font-mono max-h-48 overflow-y-auto space-y-0.5">
                      {result.notInFile.plans.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
