import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { MONTHS } from "@/lib/constants";
import { Upload, Download, Trash2, FileText, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { format } from "date-fns";

function LossRatioBadge({ value }: { value: string | null }) {
  if (value == null) return <span className="text-[#94A3B8]">—</span>;
  const pct = parseFloat(value);
  const color = pct >= 100 ? "text-[#EF4444]" : pct >= 85 ? "text-[#F5A623]" : "text-[#22C55E]";
  const Icon = pct >= 100 ? TrendingUp : pct >= 85 ? Minus : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${color}`}>
      <Icon className="w-3.5 h-3.5" />
      {pct.toFixed(1)}%
    </span>
  );
}

function SurplusBadge({ value }: { value: string | null }) {
  if (value == null) return <span className="text-[#94A3B8]">—</span>;
  const amt = parseFloat(value);
  const color = amt >= 0 ? "text-[#22C55E]" : "text-[#EF4444]";
  const sign = amt >= 0 ? "+" : "";
  return (
    <span className={`font-semibold ${color}`}>
      {sign}${Math.abs(amt).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

export default function PprTab({ clientId }: { clientId: number }) {
  const { toast } = useToast();
  const [showUpload, setShowUpload] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: pprs = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/clients", String(clientId), "ppr"],
  });

  const { data: metrics = [] } = useQuery<any[]>({
    queryKey: ["/api/clients", String(clientId), "ppr-metrics"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ppr/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "ppr"] });
      toast({ title: "PPR deleted" });
      setDeleteId(null);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // Latest metrics entry
  const latest = metrics[0] ?? null;

  return (
    <div data-testid="ppr-tab">

      {/* Key Metrics Panel */}
      {latest && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-[#1A5276] mb-3 uppercase tracking-wide">
            Latest Performance — {MONTHS[(latest.reportMonth ?? 1) - 1]} {latest.reportYear}
            {latest.planName && <span className="ml-2 font-normal text-[#94A3B8] normal-case tracking-normal">({latest.planName})</span>}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="border-0 shadow-sm" data-testid="metric-monthly-lr">
              <CardContent className="p-4">
                <p className="text-xs text-[#94A3B8] font-medium mb-1">Monthly Loss Ratio</p>
                <div className="text-xl"><LossRatioBadge value={latest.monthlyLossRatio} /></div>
                <p className="text-[10px] text-[#94A3B8] mt-1">Current month vs. budget</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm" data-testid="metric-ytd-lr">
              <CardContent className="p-4">
                <p className="text-xs text-[#94A3B8] font-medium mb-1">YTD Loss Ratio</p>
                <div className="text-xl"><LossRatioBadge value={latest.ytdLossRatio} /></div>
                <p className="text-[10px] text-[#94A3B8] mt-1">Plan-year average</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm" data-testid="metric-surplus">
              <CardContent className="p-4">
                <p className="text-xs text-[#94A3B8] font-medium mb-1">YTD Surplus / Deficit</p>
                <div className="text-xl"><SurplusBadge value={latest.ytdSurplusDeficit} /></div>
                <p className="text-[10px] text-[#94A3B8] mt-1">Cumulative to date</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* History Table */}
      {metrics.length > 1 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-[#1A5276] mb-3">Monthly History</h3>
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#1A5276] text-white">
                  <th className="px-4 py-2.5 text-left text-xs font-medium">Period</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium hidden sm:table-cell">Plan</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium">Monthly LR</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium">YTD LR</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium">Surplus / Deficit</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m: any, i: number) => (
                  <tr key={m.id} className={`border-b ${i % 2 === 0 ? "bg-white" : "bg-[#F0F4F8]/40"}`} data-testid={`ppr-metric-row-${m.id}`}>
                    <td className="px-4 py-2.5 font-medium text-[#2C3E50] text-sm">
                      {MONTHS[(m.reportMonth ?? 1) - 1]} {m.reportYear}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#94A3B8] hidden sm:table-cell">{m.planName ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right"><LossRatioBadge value={m.monthlyLossRatio} /></td>
                    <td className="px-4 py-2.5 text-right"><LossRatioBadge value={m.ytdLossRatio} /></td>
                    <td className="px-4 py-2.5 text-right"><SurplusBadge value={m.ytdSurplusDeficit} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* File Uploads Section */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-[#1A5276]">Performance Reports (PPR)</h2>
        <Button onClick={() => setShowUpload(true)} className="bg-[#1A5276] text-white gap-2" data-testid="button-upload-ppr">
          <Upload className="w-4 h-4" /> Upload PPR
        </Button>
      </div>

      {!pprs.length && !isLoading ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <FileText className="w-10 h-10 text-[#94A3B8] mx-auto mb-2" />
            <p className="text-sm text-[#94A3B8]">No performance reports uploaded yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-[#F0F4F8]">
                <th className="px-4 py-3 text-left text-xs font-medium text-[#94A3B8] uppercase">Period</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#94A3B8] uppercase">File</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#94A3B8] uppercase hidden md:table-cell">Uploaded</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#94A3B8] uppercase hidden lg:table-cell">Notes</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[#94A3B8] uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pprs.map((ppr: any, i: number) => (
                <tr key={ppr.id} className={`border-b hover:bg-[#F0F4F8]/50 transition-colors ${i % 2 === 1 ? "bg-[#F0F4F8]/30" : ""}`} data-testid={`ppr-row-${ppr.id}`}>
                  <td className="px-4 py-3 font-medium text-[#2C3E50]">
                    {MONTHS[ppr.reportMonth - 1]} {ppr.reportYear}
                  </td>
                  <td className="px-4 py-3">
                    <a href={`/api/ppr/${ppr.id}/download`} target="_blank" rel="noreferrer" className="text-[#2E86C1] hover:underline text-sm">
                      {ppr.fileName}
                    </a>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <p className="text-xs text-[#94A3B8]">{format(new Date(ppr.uploadedAt), "MMM d, yyyy")}</p>
                    <p className="text-xs text-[#94A3B8]">by {ppr.uploadedBy}</p>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <p className="text-xs text-[#94A3B8] truncate max-w-xs">{ppr.notes || "-"}</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <a href={`/api/ppr/${ppr.id}/download`} target="_blank" rel="noreferrer">
                        <Button size="icon" variant="ghost" data-testid={`button-download-ppr-${ppr.id}`}>
                          <Download className="w-4 h-4 text-[#2E86C1]" />
                        </Button>
                      </a>
                      <Button size="icon" variant="ghost" onClick={() => setDeleteId(ppr.id)} data-testid={`button-delete-ppr-${ppr.id}`}>
                        <Trash2 className="w-4 h-4 text-[#EF4444]" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PprUploadDialog open={showUpload} onClose={() => setShowUpload(false)} clientId={clientId} />

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete PPR</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)} className="bg-[#EF4444] text-white" data-testid="button-confirm-delete-ppr">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PprUploadDialog({ open, onClose, clientId }: { open: boolean; onClose: () => void; clientId: number }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const currentYear = new Date().getFullYear();
  const [form, setForm] = useState({ reportMonth: "", reportYear: String(currentYear), notes: "" });
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const mutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch(`/api/clients/${clientId}/ppr`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "ppr"] });
      toast({ title: "PPR uploaded successfully" });
      onClose();
      setForm({ reportMonth: "", reportYear: String(currentYear), notes: "" });
      setFile(null);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !form.reportMonth || !form.reportYear) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("reportMonth", form.reportMonth);
    formData.append("reportYear", form.reportYear);
    formData.append("notes", form.notes);
    mutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[#1A5276]">Upload PPR</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium">Report Month <span className="text-[#EF4444]">*</span></Label>
              <Select value={form.reportMonth} onValueChange={v => setForm(f => ({ ...f, reportMonth: v }))}>
                <SelectTrigger data-testid="select-ppr-month"><SelectValue placeholder="Select month" /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium">Report Year <span className="text-[#EF4444]">*</span></Label>
              <Select value={form.reportYear} onValueChange={v => setForm(f => ({ ...f, reportYear: v }))}>
                <SelectTrigger data-testid="select-ppr-year"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 6 }, (_, i) => currentYear - i).map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-sm font-medium">File <span className="text-[#EF4444]">*</span></Label>
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                dragOver ? "border-[#1A5276] bg-[#1A5276]/5" : "border-gray-300 hover:border-[#1A5276]"
              }`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); setFile(e.dataTransfer.files[0] || null); }}
              data-testid="ppr-dropzone"
            >
              <input ref={fileRef} type="file" className="hidden" accept=".pdf,.xlsx,.csv" onChange={e => setFile(e.target.files?.[0] || null)} />
              {file ? (
                <div>
                  <FileText className="w-8 h-8 text-[#2E86C1] mx-auto mb-2" />
                  <p className="text-sm font-medium text-[#2C3E50]">{file.name}</p>
                  <p className="text-xs text-[#94A3B8]">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              ) : (
                <div>
                  <Upload className="w-8 h-8 text-[#94A3B8] mx-auto mb-2" />
                  <p className="text-sm text-[#94A3B8]">Drag & drop or click to browse</p>
                  <p className="text-xs text-[#94A3B8] mt-1">PDF, XLSX, CSV (max 25 MB)</p>
                </div>
              )}
            </div>
          </div>
          <div>
            <Label className="text-sm font-medium">Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." data-testid="input-ppr-notes" />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={mutation.isPending || !file || !form.reportMonth || !form.reportYear} className="bg-[#1A5276] text-white" data-testid="button-upload-ppr-submit">
              {mutation.isPending ? "Uploading..." : "Upload PPR"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
