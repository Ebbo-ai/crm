import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MONTHS } from "@/lib/constants";
import { Upload, FileText, CheckCircle, XCircle, AlertCircle, Archive, X, Eye, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PprViewerPanel } from "@/components/tabs/ppr-tab";

const MON_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function parseClientCodeFromName(name: string): string | null {
  const m = name.match(/^s(\d+)/i);
  return m ? `S-${m[1]}` : null;
}
function parseMonthYearFromName(name: string): { month: number; year: number } | null {
  const m = name.match(/_([A-Za-z]{3})(\d{4})\.[^.]+$/);
  if (!m) return null;
  const idx = MON_ABBR.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
  if (idx < 0) return null;
  return { month: idx + 1, year: parseInt(m[2]) };
}
function fileTypeFromName(name: string): "PDF" | "EXCEL" {
  return /\.pdf$/i.test(name) ? "PDF" : "EXCEL";
}

interface FilePreview {
  file: File;
  clientCode: string | null;
  fileType: "PDF" | "EXCEL";
  fromName: { month: number; year: number } | null;
}

interface BatchResult {
  file: string;
  status: "imported" | "skipped" | "error";
  clientCode?: string;
  clientName?: string;
  fileType?: string;
  reportMonth?: number;
  reportYear?: number;
  pprId?: number;
  error?: string;
}

interface ViewTarget {
  id: number;
  fileName: string;
  fileType: "PDF" | "EXCEL";
}

export default function PprBatchPage() {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();
  const fileRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fallbackMonth, setFallbackMonth] = useState("");
  const [fallbackYear, setFallbackYear] = useState(String(currentYear));
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [results, setResults] = useState<{ imported: number; skipped: number; errors: number; results: BatchResult[] } | null>(null);
  const [viewTarget, setViewTarget] = useState<ViewTarget | null>(null);

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    const zip = arr.find(f => /\.zip$/i.test(f.name));
    if (zip) {
      setZipFile(zip);
      setPreviews([]);
      return;
    }
    setZipFile(null);
    const validFiles = arr.filter(f => /\.(pdf|xlsx|xls)$/i.test(f.name));
    const newPreviews: FilePreview[] = validFiles.map(f => ({
      file: f,
      clientCode: parseClientCodeFromName(f.name),
      fileType: fileTypeFromName(f.name),
      fromName: parseMonthYearFromName(f.name),
    }));
    setPreviews(prev => {
      const existing = new Set(prev.map(p => p.file.name));
      return [...prev, ...newPreviews.filter(p => !existing.has(p.file.name))];
    });
  }

  function removePreview(idx: number) {
    setPreviews(prev => prev.filter((_, i) => i !== idx));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      if (fallbackMonth) formData.append("reportMonth", fallbackMonth);
      if (fallbackYear) formData.append("reportYear", fallbackYear);

      if (zipFile) {
        formData.append("zipFile", zipFile);
      } else {
        for (const p of previews) {
          formData.append("files", p.file);
        }
      }
      const res = await fetch("/api/ppr/batch-monthly", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      setResults(data);
      setPreviews([]);
      setZipFile(null);
      toast({ title: `Batch upload complete — ${data.imported} files imported` });
    },
    onError: (err: any) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  const totalFiles = zipFile ? "ZIP archive" : `${previews.length} file${previews.length !== 1 ? "s" : ""}`;
  const canUpload = (zipFile || previews.length > 0) && !mutation.isPending;
  const needsFallback = previews.some(p => !p.fromName) || zipFile;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand">PPR Monthly Batch Upload</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload all clients' performance reports for a given month at once. Drop a folder of files or a ZIP archive.
          The system will route each file to the correct client based on the client code in the file name (e.g. <code className="text-xs bg-muted px-1 rounded">s29gainesvilleppr2026.xlsx</code>).
        </p>
      </div>

      {/* Fallback month/year */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2 pt-4 px-5">
          <h2 className="text-sm font-semibold text-brand">Report Period</h2>
          <p className="text-xs text-muted-foreground">
            Required if your file names don't include the month (e.g. old-style names like <code className="bg-muted px-1 rounded">s29gainesvilleppr2026.xlsx</code>).
            Files with the new naming format (<code className="bg-muted px-1 rounded">S29_Gainesville_Jun2026.xlsx</code>) auto-detect the month.
          </p>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <div className="grid grid-cols-2 gap-3 max-w-xs">
            <div>
              <Label className="text-xs font-medium text-foreground">Month</Label>
              <Select value={fallbackMonth} onValueChange={setFallbackMonth}>
                <SelectTrigger data-testid="select-batch-month" className="h-9 text-sm">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium text-foreground">Year</Label>
              <Select value={fallbackYear} onValueChange={setFallbackYear}>
                <SelectTrigger data-testid="select-batch-year" className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 6 }, (_, i) => currentYear - i).map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {needsFallback && !fallbackMonth && (
            <p className="text-xs text-warning-strong mt-2 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" /> Some files don't have a month in their name — please select a fallback month above.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Drop zone */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-5">
          <div
            className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
              dragOver ? "border-brand bg-brand/5" : "border-border hover:border-brand/50"
            }`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            data-testid="batch-dropzone"
          >
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              multiple
              accept=".pdf,.xlsx,.xls,.zip"
              onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
            />
            <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">Drop files or a ZIP here, or click to browse</p>
            <p className="text-xs text-muted-foreground mt-1">PDF, Excel (.xlsx / .xls), or a single ZIP containing any mix — up to 200 files</p>
          </div>

          {/* Zip indicator */}
          {zipFile && (
            <div className="mt-4 flex items-center gap-3 p-3 bg-surface-subtle rounded-lg">
              <Archive className="w-5 h-5 text-brand flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{zipFile.name}</p>
                <p className="text-xs text-muted-foreground">{(zipFile.size / 1024 / 1024).toFixed(2)} MB — contents will be extracted automatically</p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setZipFile(null)} data-testid="button-remove-zip">
                <X className="w-4 h-4 text-muted-foreground" />
              </Button>
            </div>
          )}

          {/* File preview list */}
          {previews.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-brand uppercase tracking-wide">{previews.length} file{previews.length !== 1 ? "s" : ""} selected</p>
                <Button size="sm" variant="ghost" className="text-xs text-muted-foreground h-6 px-2" onClick={() => setPreviews([])}>Clear all</Button>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y">
                {previews.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2" data-testid={`preview-file-${i}`}>
                    <FileText className={`w-4 h-4 flex-shrink-0 ${p.fileType === "PDF" ? "text-danger-strong" : "text-success-strong"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{p.file.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {p.clientCode
                          ? <span className="text-xs text-muted-foreground">Client: <strong>{p.clientCode}</strong></span>
                          : <span className="text-xs text-warning-strong">⚠ Cannot parse client code</span>
                        }
                        {p.fromName
                          ? <span className="text-xs text-muted-foreground">• {MONTHS[p.fromName.month - 1]} {p.fromName.year}</span>
                          : fallbackMonth
                            ? <span className="text-xs text-muted-foreground">• {MONTHS[parseInt(fallbackMonth) - 1]} {fallbackYear}</span>
                            : <span className="text-xs text-warning-strong">• Month needed</span>
                        }
                        <Badge variant="outline" className="text-xs h-4 px-1">{p.fileType}</Badge>
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" className="w-6 h-6 flex-shrink-0" onClick={() => removePreview(i)}>
                      <X className="w-3 h-3 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(previews.length > 0 || zipFile) && (
            <div className="mt-4 flex gap-2">
              <Button
                onClick={() => mutation.mutate()}
                disabled={!canUpload || (needsFallback && !fallbackMonth)}
                className="bg-brand text-brand-foreground gap-2"
                data-testid="button-batch-upload"
              >
                <Upload className="w-4 h-4" />
                {mutation.isPending ? "Uploading…" : `Upload ${totalFiles}`}
              </Button>
              <Button variant="outline" onClick={() => { setPreviews([]); setZipFile(null); }}>Clear</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {results && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2 pt-4 px-5">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-brand">Upload Results</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-success-tint text-success-strong font-medium">{results.imported} imported</span>
              {results.skipped > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-warning-tint text-warning-strong font-medium">{results.skipped} skipped</span>}
              {results.errors > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-danger-tint text-danger-strong font-medium">{results.errors} errors</span>}
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-subtle">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase">File</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase hidden sm:table-cell">Client</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase hidden md:table-cell">Period</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase">Status</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase w-16">View</th>
                  </tr>
                </thead>
                <tbody>
                  {results.results.map((r, i) => (
                    <tr key={i} className={`border-t ${i % 2 === 1 ? "bg-surface-subtle/30" : ""}`} data-testid={`result-row-${i}`}>
                      <td className="px-3 py-2 max-w-[180px] truncate font-mono text-xs text-foreground">{r.file}</td>
                      <td className="px-3 py-2 hidden sm:table-cell text-muted-foreground">{r.clientName || r.clientCode || "—"}</td>
                      <td className="px-3 py-2 hidden md:table-cell text-muted-foreground">
                        {r.reportMonth && r.reportYear ? `${MONTHS[r.reportMonth - 1]} ${r.reportYear}` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {r.status === "imported" && (
                          <span className="inline-flex items-center gap-1 text-success-strong">
                            <CheckCircle className="w-3.5 h-3.5" /> Imported
                          </span>
                        )}
                        {r.status === "skipped" && (
                          <span className="inline-flex items-center gap-1 text-warning-strong" title={r.error}>
                            <AlertCircle className="w-3.5 h-3.5" /> {r.error || "Skipped"}
                          </span>
                        )}
                        {r.status === "error" && (
                          <span className="inline-flex items-center gap-1 text-danger-strong" title={r.error}>
                            <XCircle className="w-3.5 h-3.5" /> Error
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.status === "imported" && r.pprId && r.fileType ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="w-6 h-6"
                            onClick={() => setViewTarget({
                              id: r.pprId!,
                              fileName: r.file,
                              fileType: r.fileType === "PDF" ? "PDF" : "EXCEL",
                            })}
                            data-testid={`button-view-result-${i}`}
                          >
                            {r.fileType === "PDF"
                              ? <FileText className="w-3.5 h-3.5 text-danger-strong" />
                              : <FileSpreadsheet className="w-3.5 h-3.5 text-success-strong" />}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {viewTarget && (
        <PprViewerPanel
          id={viewTarget.id}
          fileName={viewTarget.fileName}
          fileType={viewTarget.fileType}
          onClose={() => setViewTarget(null)}
        />
      )}
    </div>
  );
}
