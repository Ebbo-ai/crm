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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { MONTHS } from "@/lib/constants";
import { Upload, Download, Trash2, FileText, TrendingUp, TrendingDown, Minus, RefreshCw, FileSpreadsheet } from "lucide-react";
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

interface PprFile {
  id: number;
  fileName: string;
  filePath: string;
  fileType: string | null;
  uploadedAt: string;
  uploadedBy: string;
  notes: string | null;
}
interface PprGroup {
  reportYear: number;
  reportMonth: number;
  pdf: PprFile | null;
  excel: PprFile | null;
  notes: string | null;
  uploadedAt: string;
}

export default function PprTab({ clientId }: { clientId: number }) {
  const { toast } = useToast();
  const [showUpload, setShowUpload] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<{ reportMonth: number; reportYear: number; fileType: "PDF" | "EXCEL" } | null>(null);

  const { data: groups = [], isLoading } = useQuery<PprGroup[]>({
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
      toast({ title: "File deleted" });
      setDeleteTarget(null);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

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

      {/* PPR File History */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-[#1A5276]">Performance Reports (PPR)</h2>
        <Button onClick={() => setShowUpload(true)} className="bg-[#1A5276] text-white gap-2" data-testid="button-upload-ppr">
          <Upload className="w-4 h-4" /> Upload PPR
        </Button>
      </div>

      {!groups.length && !isLoading ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <FileText className="w-10 h-10 text-[#94A3B8] mx-auto mb-2" />
            <p className="text-sm text-[#94A3B8]">No performance reports uploaded yet</p>
            <p className="text-xs text-[#94A3B8] mt-1">Use "Upload PPR" above or the PPR Batch Upload page to add reports</p>
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-[#F0F4F8]">
                <th className="px-4 py-3 text-left text-xs font-medium text-[#94A3B8] uppercase">Period</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#94A3B8] uppercase">PDF</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#94A3B8] uppercase">Excel</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#94A3B8] uppercase hidden lg:table-cell">Notes</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#94A3B8] uppercase hidden md:table-cell">Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <tr key={`${g.reportYear}-${g.reportMonth}`} className={`border-b hover:bg-[#F0F4F8]/30 transition-colors ${i % 2 === 1 ? "bg-[#F0F4F8]/20" : ""}`} data-testid={`ppr-row-${g.reportYear}-${g.reportMonth}`}>
                  <td className="px-4 py-3 font-semibold text-[#2C3E50] whitespace-nowrap">
                    {MONTHS[g.reportMonth - 1]} {g.reportYear}
                  </td>
                  <td className="px-4 py-3">
                    <FileCell
                      record={g.pdf}
                      fileType="PDF"
                      reportMonth={g.reportMonth}
                      reportYear={g.reportYear}
                      onDelete={(id) => setDeleteTarget({ id, label: `PDF for ${MONTHS[g.reportMonth - 1]} ${g.reportYear}` })}
                      onReplace={() => setReplaceTarget({ reportMonth: g.reportMonth, reportYear: g.reportYear, fileType: "PDF" })}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <FileCell
                      record={g.excel}
                      fileType="EXCEL"
                      reportMonth={g.reportMonth}
                      reportYear={g.reportYear}
                      onDelete={(id) => setDeleteTarget({ id, label: `Excel for ${MONTHS[g.reportMonth - 1]} ${g.reportYear}` })}
                      onReplace={() => setReplaceTarget({ reportMonth: g.reportMonth, reportYear: g.reportYear, fileType: "EXCEL" })}
                    />
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <p className="text-xs text-[#94A3B8] max-w-[180px] truncate" title={g.notes ?? ""}>{g.notes || "—"}</p>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <p className="text-xs text-[#94A3B8]">{format(new Date(g.uploadedAt), "MMM d, yyyy")}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PprUploadDialog open={showUpload} onClose={() => setShowUpload(false)} clientId={clientId} />

      {replaceTarget && (
        <PprReplaceDialog
          open={true}
          onClose={() => setReplaceTarget(null)}
          clientId={clientId}
          reportMonth={replaceTarget.reportMonth}
          reportYear={replaceTarget.reportYear}
          fileType={replaceTarget.fileType}
        />
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete File</AlertDialogTitle>
            <AlertDialogDescription>Delete {deleteTarget?.label}? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-[#EF4444] text-white"
              data-testid="button-confirm-delete-ppr"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FileCell({ record, fileType, reportMonth, reportYear, onDelete, onReplace }: {
  record: PprFile | null;
  fileType: "PDF" | "EXCEL";
  reportMonth: number;
  reportYear: number;
  onDelete: (id: number) => void;
  onReplace: () => void;
}) {
  if (!record) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-[#94A3B8] text-xs">—</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" className="w-6 h-6 opacity-40 hover:opacity-100" onClick={onReplace} data-testid={`button-upload-${fileType.toLowerCase()}-${reportYear}-${reportMonth}`}>
              <Upload className="w-3 h-3 text-[#1A5276]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Upload {fileType}</TooltipContent>
        </Tooltip>
      </div>
    );
  }
  const Icon = fileType === "PDF" ? FileText : FileSpreadsheet;
  return (
    <div className="flex items-center gap-1 group">
      <a
        href={`/api/ppr/${record.id}/download`}
        target="_blank"
        rel="noreferrer"
        className={`inline-flex items-center gap-1 text-xs hover:underline max-w-[140px] truncate ${fileType === "PDF" ? "text-red-600" : "text-green-700"}`}
        title={record.fileName}
        data-testid={`link-download-${fileType.toLowerCase()}-${record.id}`}
      >
        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate">{record.fileName}</span>
      </a>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Tooltip>
          <TooltipTrigger asChild>
            <a href={`/api/ppr/${record.id}/download`} target="_blank" rel="noreferrer">
              <Button size="icon" variant="ghost" className="w-6 h-6" data-testid={`button-download-${fileType.toLowerCase()}-${record.id}`}>
                <Download className="w-3 h-3 text-[#2E86C1]" />
              </Button>
            </a>
          </TooltipTrigger>
          <TooltipContent>Download</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" className="w-6 h-6" onClick={onReplace} data-testid={`button-replace-${fileType.toLowerCase()}-${record.id}`}>
              <RefreshCw className="w-3 h-3 text-[#F5A623]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Replace {fileType}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" className="w-6 h-6" onClick={() => onDelete(record.id)} data-testid={`button-delete-${fileType.toLowerCase()}-${record.id}`}>
              <Trash2 className="w-3 h-3 text-[#EF4444]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function PprUploadDialog({ open, onClose, clientId }: { open: boolean; onClose: () => void; clientId: number }) {
  const { toast } = useToast();
  const pdfRef = useRef<HTMLInputElement>(null);
  const excelRef = useRef<HTMLInputElement>(null);
  const currentYear = new Date().getFullYear();
  const [form, setForm] = useState({ reportMonth: "", reportYear: String(currentYear), notes: "" });
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [dragOverPdf, setDragOverPdf] = useState(false);
  const [dragOverExcel, setDragOverExcel] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("reportMonth", form.reportMonth);
      formData.append("reportYear", form.reportYear);
      formData.append("notes", form.notes);
      if (pdfFile) formData.append("pdf", pdfFile);
      if (excelFile) formData.append("excel", excelFile);
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
      setPdfFile(null);
      setExcelFile(null);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const canSubmit = (pdfFile || excelFile) && form.reportMonth && form.reportYear && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-[#1A5276]">Upload PPR</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
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

          <div className="grid grid-cols-2 gap-3">
            {/* PDF drop zone */}
            <div>
              <Label className="text-sm font-medium mb-1 block flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-red-500" /> PDF
              </Label>
              <div
                className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${dragOverPdf ? "border-[#1A5276] bg-[#1A5276]/5" : "border-gray-300 hover:border-[#1A5276]"}`}
                onClick={() => pdfRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOverPdf(true); }}
                onDragLeave={() => setDragOverPdf(false)}
                onDrop={e => { e.preventDefault(); setDragOverPdf(false); setPdfFile(e.dataTransfer.files[0] || null); }}
                data-testid="ppr-dropzone-pdf"
              >
                <input ref={pdfRef} type="file" className="hidden" accept=".pdf" onChange={e => setPdfFile(e.target.files?.[0] || null)} />
                {pdfFile ? (
                  <div>
                    <FileText className="w-6 h-6 text-red-500 mx-auto mb-1" />
                    <p className="text-xs font-medium text-[#2C3E50] truncate">{pdfFile.name}</p>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-6 h-6 text-[#94A3B8] mx-auto mb-1" />
                    <p className="text-xs text-[#94A3B8]">Drop PDF here</p>
                  </div>
                )}
              </div>
            </div>

            {/* Excel drop zone */}
            <div>
              <Label className="text-sm font-medium mb-1 block flex items-center gap-1">
                <FileSpreadsheet className="w-3.5 h-3.5 text-green-600" /> Excel
              </Label>
              <div
                className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${dragOverExcel ? "border-[#1A5276] bg-[#1A5276]/5" : "border-gray-300 hover:border-[#1A5276]"}`}
                onClick={() => excelRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOverExcel(true); }}
                onDragLeave={() => setDragOverExcel(false)}
                onDrop={e => { e.preventDefault(); setDragOverExcel(false); setExcelFile(e.dataTransfer.files[0] || null); }}
                data-testid="ppr-dropzone-excel"
              >
                <input ref={excelRef} type="file" className="hidden" accept=".xlsx,.xls" onChange={e => setExcelFile(e.target.files?.[0] || null)} />
                {excelFile ? (
                  <div>
                    <FileSpreadsheet className="w-6 h-6 text-green-600 mx-auto mb-1" />
                    <p className="text-xs font-medium text-[#2C3E50] truncate">{excelFile.name}</p>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-6 h-6 text-[#94A3B8] mx-auto mb-1" />
                    <p className="text-xs text-[#94A3B8]">Drop Excel here</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <Label className="text-sm font-medium">Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." data-testid="input-ppr-notes" />
          </div>
          <div className="flex gap-2 pt-1">
            <Button onClick={() => mutation.mutate()} disabled={!canSubmit} className="bg-[#1A5276] text-white" data-testid="button-upload-ppr-submit">
              {mutation.isPending ? "Uploading…" : "Upload PPR"}
            </Button>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PprReplaceDialog({ open, onClose, clientId, reportMonth, reportYear, fileType }: {
  open: boolean; onClose: () => void; clientId: number;
  reportMonth: number; reportYear: number; fileType: "PDF" | "EXCEL";
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("reportMonth", String(reportMonth));
      formData.append("reportYear", String(reportYear));
      if (fileType === "PDF") formData.append("pdf", file!);
      else formData.append("excel", file!);
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
      toast({ title: `${fileType} replaced successfully` });
      onClose();
      setFile(null);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const Icon = fileType === "PDF" ? FileText : FileSpreadsheet;
  const accept = fileType === "PDF" ? ".pdf" : ".xlsx,.xls";
  const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[#1A5276]">Replace {fileType} — {MONTHS_SHORT[reportMonth - 1]} {reportYear}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${dragOver ? "border-[#1A5276] bg-[#1A5276]/5" : "border-gray-300 hover:border-[#1A5276]"}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); setFile(e.dataTransfer.files[0] || null); }}
            data-testid="replace-dropzone"
          >
            <input ref={fileRef} type="file" className="hidden" accept={accept} onChange={e => setFile(e.target.files?.[0] || null)} />
            {file ? (
              <div>
                <Icon className={`w-8 h-8 mx-auto mb-2 ${fileType === "PDF" ? "text-red-500" : "text-green-600"}`} />
                <p className="text-sm font-medium text-[#2C3E50]">{file.name}</p>
              </div>
            ) : (
              <div>
                <Upload className="w-8 h-8 text-[#94A3B8] mx-auto mb-2" />
                <p className="text-sm text-[#94A3B8]">Drop new {fileType} here or click to browse</p>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={() => mutation.mutate()} disabled={!file || mutation.isPending} className="bg-[#F5A623] text-white" data-testid="button-replace-submit">
              {mutation.isPending ? "Replacing…" : `Replace ${fileType}`}
            </Button>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
