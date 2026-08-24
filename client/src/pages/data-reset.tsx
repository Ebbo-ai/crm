import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Download,
  Upload,
  AlertTriangle,
  ShieldCheck,
  Trash2,
  CheckCircle,
  Link2,
  FileJson,
  X,
} from "lucide-react";

interface ResetPreview {
  confirmationPhrase: string;
  willDelete: { table: string; rows: number }[];
  willPreserve: { table: string; rows: number }[];
  linksAtRisk: { communicationLinks: number; taskLinks: number };
}

interface ResetReport {
  ranAt: string;
  deleted: { table: string; rows: number }[];
  emptied: { table: string; before: number; after: number }[];
  preserved: { table: string; before: number; after: number; unchanged: boolean }[];
  communicationLinksLost: number;
  taskLinksCleared: number;
  snapshot: {
    exportedAt: string;
    counts: { communicationLinks: number; taskLinks: number; distinctClients: number };
  };
}

interface ReattachReport {
  ok: boolean;
  exportedAt: string | null;
  links: { inFile: number; restored: number; alreadyPresent: number; skippedMissingCommunication: number };
  tasks: { inFile: number; restored: number; alreadyAssigned: number; skippedMissingTask: number };
  matchedOnPadding: { fileCode: string; storedCode: string; clientName: string; links: number; tasks: number }[];
  unmatched: { clientCode: string; clientName: string; links: number; tasks: number }[];
  ambiguous: { clientCode: string; candidates: string[]; links: number; tasks: number }[];
}

function tableLabel(t: string) {
  return t.replace(/_/g, " ");
}

export default function DataResetPage() {
  const { toast } = useToast();
  const [phrase, setPhrase] = useState("");
  const [resetReport, setResetReport] = useState<ResetReport | null>(null);
  const [reattachReport, setReattachReport] = useState<ReattachReport | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [exported, setExported] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const preview = useQuery<ResetPreview>({
    queryKey: ["/api/admin/data-reset/preview"],
  });

  const linkCounts = useQuery<{ communicationLinks: number; taskLinks: number; distinctClients: number }>({
    queryKey: ["/api/admin/communication-links/preview"],
  });

  async function downloadExport() {
    const res = await fetch("/api/admin/communication-links/export", { credentials: "include" });
    if (!res.ok) {
      toast({ title: "Export failed", description: await res.text(), variant: "destructive" });
      return;
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const name = /filename="([^"]+)"/.exec(disposition)?.[1] || "communication-links.json";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    toast({ title: "Export downloaded", description: `Saved as ${name}. Keep it — the reset needs it.` });
  }

  function downloadSnapshot(report: ResetReport) {
    const stamp = report.snapshot.exportedAt.replace(/[:.]/g, "-");
    const name = `communication-links-at-reset-${stamp}.json`;
    const blob = new Blob([JSON.stringify(report.snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Snapshot saved", description: `Use ${name} in step 3.` });
  }

  const runReset = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/data-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirm: phrase }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message || "Reset failed.");
      return body as ResetReport;
    },
    onSuccess: (data) => {
      setResetReport(data);
      setPhrase("");
      queryClient.invalidateQueries();
      // Saved without being asked: this is the only copy of the links as they stood
      // at the moment of deletion, and it exists only in this response.
      downloadSnapshot(data);
      toast({
        title: "Client data reset",
        description: `${data.deleted.reduce((n, d) => n + d.rows, 0)} rows deleted. Logins, sessions and mail untouched.`,
      });
    },
    onError: (err: any) => toast({ title: "Reset failed", description: err.message, variant: "destructive" }),
  });

  const runReattach = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose the export file first.");
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/communication-links/reattach", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message || "Re-attach failed.");
      return body as ReattachReport;
    },
    onSuccess: (data) => {
      setReattachReport(data);
      queryClient.invalidateQueries();
      toast({
        title: "Links re-attached",
        description: `${data.links.restored} email links and ${data.tasks.restored} task links restored.`,
      });
    },
    onError: (err: any) => toast({ title: "Re-attach failed", description: err.message, variant: "destructive" }),
  });

  const phraseOk = preview.data ? phrase.trim() === preview.data.confirmationPhrase : false;
  const totalToDelete = preview.data?.willDelete.reduce((n, d) => n + d.rows, 0) ?? 0;

  return (
    <div data-testid="data-reset-page" className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1A5276]">Client Data Reset</h1>
        <p className="text-sm text-[#94A3B8] mt-1">
          Clears the client book so the corrected workbook can be imported into an empty database. Run the three steps
          in order. Emails, attachments and tasks are never deleted, but their links to clients are, which is what
          step one preserves.
        </p>
      </div>

      {/* ── Step 1 ─────────────────────────────────────────────────────────── */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Badge className="bg-[#1A5276]">Step 1</Badge>
            <h2 className="font-semibold text-[#1A5276]">Export the communication links</h2>
          </div>
          <p className="text-xs text-[#94A3B8] mt-1">
            Records which emails and tasks belong to which client, by client code rather than by database id, because
            the ids change when the book is re-imported.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between border border-[#E2E8F0] rounded-lg px-4 py-3 mb-4">
            <div className="flex items-center gap-3">
              <Link2 className="w-5 h-5 text-[#1A5276]" />
              <div>
                <p className="text-sm font-medium text-[#1A5276]" data-testid="text-link-counts">
                  {linkCounts.data
                    ? `${linkCounts.data.communicationLinks} email links, ${linkCounts.data.taskLinks} task links`
                    : "Counting…"}
                </p>
                <p className="text-xs text-[#94A3B8]">
                  {linkCounts.data ? `across ${linkCounts.data.distinctClients} clients` : ""}
                </p>
              </div>
            </div>
            <Button onClick={downloadExport} className="bg-[#1A5276] hover:bg-[#154360]" data-testid="button-export-links">
              <Download className="w-4 h-4 mr-2" />
              Download export
            </Button>
          </div>
          <div className="flex gap-2 text-xs text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-md px-3 py-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-px" />
            <span>
              The mailbox is still receiving. Take this export immediately before the reset — one taken yesterday will
              miss anything that arrived since.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── Step 2 ─────────────────────────────────────────────────────────── */}
      <Card className="mb-6 border-[#EF4444]">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Badge className="bg-[#EF4444]">Step 2</Badge>
            <h2 className="font-semibold text-[#EF4444]">Reset the client data</h2>
          </div>
          <p className="text-xs text-[#94A3B8] mt-1">Irreversible. There is no undo inside the application.</p>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div className="border border-[#FECACA] bg-[#FEF2F2] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Trash2 className="w-4 h-4 text-[#EF4444]" />
                <h3 className="text-sm font-semibold text-[#B91C1C]">
                  Will be deleted ({totalToDelete.toLocaleString()} rows)
                </h3>
              </div>
              <ul className="space-y-1" data-testid="list-will-delete">
                {preview.data?.willDelete.map((t) => (
                  <li key={t.table} className="flex justify-between text-xs">
                    <span className="text-[#7F1D1D]">{tableLabel(t.table)}</span>
                    <span className="tabular-nums font-medium text-[#B91C1C]">{t.rows.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border border-[#BBF7D0] bg-[#F0FDF4] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-4 h-4 text-[#059669]" />
                <h3 className="text-sm font-semibold text-[#047857]">Will be kept</h3>
              </div>
              <ul className="space-y-1" data-testid="list-will-preserve">
                {preview.data?.willPreserve.map((t) => (
                  <li key={t.table} className="flex justify-between text-xs">
                    <span className="text-[#065F46]">{tableLabel(t.table)}</span>
                    <span className="tabular-nums font-medium text-[#047857]">{t.rows.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex gap-2 text-xs text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-md px-3 py-2 mb-4">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-px" />
            <span>
              {preview.data?.linksAtRisk.communicationLinks ?? 0} email links and{" "}
              {preview.data?.linksAtRisk.taskLinks ?? 0} task links will be destroyed. The emails, attachments and
              tasks themselves survive. Step 3 puts the links back from the export file — without that file they cannot
              be rebuilt.
            </span>
          </div>

          {!exported && (
            <p className="text-xs text-[#B91C1C] mb-3" data-testid="text-export-first">
              Download the export in step 1 first.
            </p>
          )}

          <label className="block text-sm font-medium text-[#1A5276] mb-1.5">
            Type <span className="font-mono bg-[#F1F5F9] px-1.5 py-0.5 rounded">{preview.data?.confirmationPhrase}</span>{" "}
            to enable the reset
          </label>
          <div className="flex items-center gap-3">
            <Input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder={preview.data?.confirmationPhrase}
              className="font-mono max-w-sm"
              data-testid="input-confirm-phrase"
            />
            <Button
              variant="destructive"
              disabled={!phraseOk || !exported || runReset.isPending}
              onClick={() => runReset.mutate()}
              data-testid="button-run-reset"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {runReset.isPending ? "Resetting…" : "Delete client data"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {resetReport && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-[#059669]" />
              <h2 className="font-semibold text-[#1A5276]">Reset complete</h2>
            </div>
            <p className="text-xs text-[#94A3B8]">
              {new Date(resetReport.ranAt).toLocaleString()} — {resetReport.communicationLinksLost} email links and{" "}
              {resetReport.taskLinksCleared} task links were cleared, as expected.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between border border-[#BFDBFE] bg-[#EFF6FF] rounded-lg px-4 py-3 mb-6">
              <div className="flex items-start gap-3">
                <FileJson className="w-5 h-5 text-[#1D4ED8] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-[#1E3A8A]">
                    Snapshot taken at the moment of deletion — {resetReport.snapshot.counts.communicationLinks} email
                    links, {resetReport.snapshot.counts.taskLinks} task links
                  </p>
                  <p className="text-xs text-[#3B82F6] mt-0.5">
                    Downloaded automatically. Use this file in step 3 — it includes anything that arrived after the
                    step 1 export.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadSnapshot(resetReport)}
                data-testid="button-download-snapshot"
              >
                <Download className="w-4 h-4 mr-2" />
                Save again
              </Button>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-semibold text-[#1A5276] mb-2">Deleted</h3>
                <ul className="space-y-1" data-testid="list-deleted">
                  {resetReport.emptied.map((t) => (
                    <li key={t.table} className="flex justify-between text-xs">
                      <span className="text-[#334155]">{tableLabel(t.table)}</span>
                      <span className="tabular-nums text-[#64748B]">
                        {t.before.toLocaleString()} → <span className="font-medium text-[#1A5276]">{t.after}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#1A5276] mb-2">Kept</h3>
                <ul className="space-y-1" data-testid="list-preserved">
                  {resetReport.preserved.map((t) => (
                    <li key={t.table} className="flex justify-between text-xs">
                      <span className="text-[#334155]">{tableLabel(t.table)}</span>
                      <span className="tabular-nums flex items-center gap-1.5">
                        <span className="text-[#64748B]">
                          {t.before.toLocaleString()} → {t.after.toLocaleString()}
                        </span>
                        {t.unchanged ? (
                          <CheckCircle className="w-3.5 h-3.5 text-[#059669]" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-[#EF4444]" />
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 3 ─────────────────────────────────────────────────────────── */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Badge className="bg-[#1A5276]">Step 3</Badge>
            <h2 className="font-semibold text-[#1A5276]">Re-attach the links</h2>
          </div>
          <p className="text-xs text-[#94A3B8] mt-1">
            Run this after the workbook import, using the snapshot the reset produced in step 2 — it is the more
            complete of the two files. The step 1 export works too. Matches on client code. Running it twice is safe:
            links already in place are counted, not duplicated.
          </p>
        </CardHeader>
        <CardContent>
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setReattachReport(null);
            }}
            data-testid="input-reattach-file"
          />
          {!file ? (
            <div
              onClick={() => inputRef.current?.click()}
              className="border-2 border-dashed border-[#CBD5E1] rounded-lg p-8 text-center cursor-pointer hover:border-[#1A5276] transition-colors"
              data-testid="dropzone-reattach-file"
            >
              <FileJson className="w-8 h-8 mx-auto text-[#94A3B8] mb-2" />
              <p className="text-sm font-medium text-[#1A5276]">Choose the snapshot from step 2</p>
              <p className="text-xs text-[#94A3B8] mt-1">
                The communication-links JSON file. Either the one saved during the reset or the step 1 export.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between border border-[#E2E8F0] rounded-lg px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <FileJson className="w-5 h-5 text-[#1A5276] flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#1A5276] truncate">{file.name}</p>
                  <p className="text-xs text-[#94A3B8]">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setFile(null)} data-testid="button-clear-reattach-file">
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}
          <Button
            className="mt-4 bg-[#1A5276] hover:bg-[#154360]"
            disabled={!file || runReattach.isPending}
            onClick={() => runReattach.mutate()}
            data-testid="button-run-reattach"
          >
            <Upload className="w-4 h-4 mr-2" />
            {runReattach.isPending ? "Re-attaching…" : "Re-attach links"}
          </Button>
        </CardContent>
      </Card>

      {reattachReport && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              {reattachReport.unmatched.length === 0 && reattachReport.ambiguous.length === 0 ? (
                <CheckCircle className="w-5 h-5 text-[#059669]" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-[#F59E0B]" />
              )}
              <h2 className="font-semibold text-[#1A5276]">Re-attach result</h2>
            </div>
            {reattachReport.exportedAt && (
              <p className="text-xs text-[#94A3B8]">
                From an export taken {new Date(reattachReport.exportedAt).toLocaleString()}
              </p>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-4 mb-5">
              <div className="border border-[#E2E8F0] rounded-lg p-3">
                <p className="text-xs font-semibold text-[#1A5276] mb-1.5">Email links</p>
                <p className="text-2xl font-bold text-[#059669] tabular-nums" data-testid="text-links-restored">
                  {reattachReport.links.restored}
                </p>
                <p className="text-xs text-[#94A3B8] mt-1">
                  of {reattachReport.links.inFile} in file
                  {reattachReport.links.alreadyPresent > 0 && `, ${reattachReport.links.alreadyPresent} already there`}
                  {reattachReport.links.skippedMissingCommunication > 0 &&
                    `, ${reattachReport.links.skippedMissingCommunication} email no longer exists`}
                </p>
              </div>
              <div className="border border-[#E2E8F0] rounded-lg p-3">
                <p className="text-xs font-semibold text-[#1A5276] mb-1.5">Task links</p>
                <p className="text-2xl font-bold text-[#059669] tabular-nums" data-testid="text-tasks-restored">
                  {reattachReport.tasks.restored}
                </p>
                <p className="text-xs text-[#94A3B8] mt-1">
                  of {reattachReport.tasks.inFile} in file
                  {reattachReport.tasks.alreadyAssigned > 0 &&
                    `, ${reattachReport.tasks.alreadyAssigned} already assigned`}
                  {reattachReport.tasks.skippedMissingTask > 0 &&
                    `, ${reattachReport.tasks.skippedMissingTask} task no longer exists`}
                </p>
              </div>
            </div>

            {reattachReport.matchedOnPadding.length > 0 && (
              <div className="mb-5">
                <h3 className="text-sm font-semibold text-[#1A5276] mb-1">
                  Matched on a differently padded code ({reattachReport.matchedOnPadding.length})
                </h3>
                <p className="text-xs text-[#94A3B8] mb-2">
                  Expected for clients the re-import re-spelled. The stored code was not changed.
                </p>
                <ul className="space-y-1" data-testid="list-padding-matches">
                  {reattachReport.matchedOnPadding.map((m) => (
                    <li key={m.fileCode} className="text-xs flex gap-3">
                      <span className="font-mono text-[#64748B] w-40 flex-shrink-0">
                        {m.fileCode} → <span className="text-[#1A5276] font-medium">{m.storedCode}</span>
                      </span>
                      <span className="text-[#334155] flex-1 truncate">{m.clientName}</span>
                      <span className="text-[#94A3B8] tabular-nums flex-shrink-0">
                        {m.links} link{m.links === 1 ? "" : "s"}
                        {m.tasks > 0 && `, ${m.tasks} task${m.tasks === 1 ? "" : "s"}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {reattachReport.ambiguous.length > 0 && (
              <div className="mb-5 border border-[#EF4444] rounded-lg p-3">
                <h3 className="text-sm font-semibold text-[#B91C1C] mb-1">
                  Ambiguous — left unlinked ({reattachReport.ambiguous.length})
                </h3>
                <p className="text-xs text-[#94A3B8] mb-2">
                  These codes match more than one client, so nothing was attached rather than guessing.
                </p>
                <ul className="space-y-1" data-testid="list-ambiguous">
                  {reattachReport.ambiguous.map((a) => (
                    <li key={a.clientCode} className="text-xs flex gap-3">
                      <span className="font-mono text-[#B91C1C] w-24 flex-shrink-0">{a.clientCode}</span>
                      <span className="text-[#334155] flex-1">matches {a.candidates.join(", ")}</span>
                      <span className="text-[#94A3B8] tabular-nums">
                        {a.links} link{a.links === 1 ? "" : "s"}
                        {a.tasks > 0 && `, ${a.tasks} task${a.tasks === 1 ? "" : "s"}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="text-sm font-semibold text-[#1A5276] mb-1">
                No longer matches a client ({reattachReport.unmatched.length})
              </h3>
              {reattachReport.unmatched.length === 0 ? (
                <p className="text-xs text-[#059669]">Every code in the file found its client.</p>
              ) : (
                <>
                  <p className="text-xs text-[#94A3B8] mb-2">
                    Their emails and tasks still exist but are no longer tied to a client. Expected for records the
                    re-import intentionally dropped, such as seed data.
                  </p>
                  <ul className="space-y-1" data-testid="list-unmatched">
                    {reattachReport.unmatched.map((u) => (
                      <li key={u.clientCode} className="text-xs flex gap-3">
                        <span className="font-mono text-[#B45309] w-24 flex-shrink-0">{u.clientCode}</span>
                        <span className="text-[#334155] flex-1 truncate">{u.clientName}</span>
                        <span className="text-[#94A3B8] tabular-nums flex-shrink-0">
                          {u.links} link{u.links === 1 ? "" : "s"}
                          {u.tasks > 0 && `, ${u.tasks} task${u.tasks === 1 ? "" : "s"}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
