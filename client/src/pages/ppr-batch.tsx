import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MONTHS } from "@/lib/constants";
import { Upload, FileText, CheckCircle, XCircle, AlertCircle, Archive, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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
  error?: string;
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
        <h1 className="text-2xl font-bold text-[#1A5276]">PPR Monthly Batch Upload</h1>
        <p className="text-sm text-[#94A3B8] mt-1">
          Upload all clients' performance reports for a given month at once. Drop a folder of files or a ZIP archive.
          The system will route each file to the correct client based on the client code in the file name (e.g. <code className="text-xs bg-gray-100 px-1 rounded">s29gainesvilleppr2026.xlsx</code>).
        </p>
      </div>

      {/* Fallback month/year */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2 pt-4 px-5">
          <h2 className="text-sm font-semibold text-[#1A5276]">Report Period</h2>
          <p className="text-xs text-[#94A3B8]">
            Required if your file names don't include the month (e.g. old-style names like <code className="bg-gray-100 px-1 rounded">s29gainesvilleppr2026.xlsx</code>).
            Files with the new naming format (<code className="bg-gray-100 px-1 rounded">S29_Gainesville_Jun2026.xlsx</code>) auto-detect the month.
          </p>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <div className="grid grid-cols-2 gap-3 max-w-xs">
            <div>
              <Label className="text-xs font-medium text-[#2C3E50]">Month</Label>
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
              <Label className="text-xs font-medium text-[#2C3E50]">Year</Label>
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
            <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
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
              dragOver ? "border-[#1A5276] bg-[#1A5276]/5" : "border-gray-200 hover:border-[#1A5276]/50"
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
            <Upload className="w-10 h-10 text-[#94A3B8] mx-auto mb-3" />
            <p className="text-sm font-medium text-[#2C3E50]">Drop files or a ZIP here, or click to browse</p>
            <p className="text-xs text-[#94A3B8] mt-1">PDF, Excel (.xlsx / .xls), or a single ZIP containing any mix — up to 200 files</p>
          </div>

          {/* Zip indicator */}
          {zipFile && (
            <div className="mt-4 flex items-center gap-3 p-3 bg-[#F0F4F8] rounded-lg">
              <Archive className="w-5 h-5 text-[#1A5276] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#2C3E50] truncate">{zipFile.name}</p>
                <p className="text-xs text-[#94A3B8]">{(zipFile.size / 1024 / 1024).toFixed(2)} MB — contents will be extracted automatically</p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setZipFile(null)} data-testid="button-remove-zip">
                <X className="w-4 h-4 text-[#94A3B8]" />
              </Button>
            </div>
          )}

          {/* File preview list */}
          {previews.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-[#1A5276] uppercase tracking-wide">{previews.length} file{previews.length !== 1 ? "s" : ""} selected</p>
                <Button size="sm" variant="ghost" className="text-xs text-[#94A3B8] h-6 px-2" onClick={() => setPreviews([])}>Clear all</Button>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-100 divide-y">
                {previews.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2" data-testid={`preview-file-${i}`}>
                    <FileText className={`w-4 h-4 flex-shrink-0 ${p.fileType === "PDF" ? "text-red-500" : "text-green-600"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[#2C3E50] truncate">{p.file.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {p.clientCode
                          ? <span className="text-[10px] text-[#94A3B8]">Client: <strong>{p.clientCode}</strong></span>
                          : <span className="text-[10px] text-amber-600">⚠ Cannot parse client code</span>
                        }
                        {p.fromName
                          ? <span className="text-[10px] text-[#94A3B8]">• {MONTHS[p.fromName.month - 1]} {p.fromName.year}</span>
                          : fallbackMonth
                            ? <span className="text-[10px] text-[#94A3B8]">• {MONTHS[parseInt(fallbackMonth) - 1]} {fallbackYear}</span>
                            : <span className="text-[10px] text-amber-600">• Month needed</span>
                        }
                        <Badge variant="outline" className="text-[9px] h-4 px-1">{p.fileType}</Badge>
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" className="w-6 h-6 flex-shrink-0" onClick={() => removePreview(i)}>
                      <X className="w-3 h-3 text-[#94A3B8]" />
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
                className="bg-[#1A5276] text-white gap-2"
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
              <h2 className="text-sm font-semibold text-[#1A5276]">Upload Results</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">{results.imported} imported</span>
              {results.skipped > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">{results.skipped} skipped</span>}
              {results.errors > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">{results.errors} errors</span>}
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="rounded-lg border border-gray-100 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#F0F4F8]">
                    <th className="px-3 py-2 text-left font-medium text-[#94A3B8] uppercase">File</th>
                    <th className="px-3 py-2 text-left font-medium text-[#94A3B8] uppercase hidden sm:table-cell">Client</th>
                    <th className="px-3 py-2 text-left font-medium text-[#94A3B8] uppercase hidden md:table-cell">Period</th>
                    <th className="px-3 py-2 text-left font-medium text-[#94A3B8] uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {results.results.map((r, i) => (
                    <tr key={i} className={`border-t ${i % 2 === 1 ? "bg-[#F0F4F8]/30" : ""}`} data-testid={`result-row-${i}`}>
                      <td className="px-3 py-2 max-w-[180px] truncate font-mono text-[11px] text-[#2C3E50]">{r.file}</td>
                      <td className="px-3 py-2 hidden sm:table-cell text-[#94A3B8]">{r.clientName || r.clientCode || "—"}</td>
                      <td className="px-3 py-2 hidden md:table-cell text-[#94A3B8]">
                        {r.reportMonth && r.reportYear ? `${MONTHS[r.reportMonth - 1]} ${r.reportYear}` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {r.status === "imported" && (
                          <span className="inline-flex items-center gap-1 text-green-700">
                            <CheckCircle className="w-3.5 h-3.5" /> Imported
                          </span>
                        )}
                        {r.status === "skipped" && (
                          <span className="inline-flex items-center gap-1 text-amber-600" title={r.error}>
                            <AlertCircle className="w-3.5 h-3.5" /> {r.error || "Skipped"}
                          </span>
                        )}
                        {r.status === "error" && (
                          <span className="inline-flex items-center gap-1 text-red-600" title={r.error}>
                            <XCircle className="w-3.5 h-3.5" /> Error
                          </span>
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
    </div>
  );
}
