import { useState, useRef } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { DOCUMENT_CATEGORY_LABELS } from "@/lib/constants";
import { Upload, Download, Trash2, FileText, Search, ChevronDown, ChevronRight, FileClock } from "lucide-react";
import { format } from "date-fns";

/** Categories versioned by client + category + normalizedFileName — see server/storage.ts VERSIONED_DOCUMENT_CATEGORIES. Rendered as the "Renewal documents" group instead of the flat table below. */
const VERSIONED_CATEGORIES = new Set(["RENEWAL_PROPOSAL", "EMPLOYER_ACCEPTANCE", "HANDOUT", "SUPPLEMENT"]);

const CATEGORY_COLORS: Record<string, string> = {
  CLIENT_AGREEMENT: "bg-info-tint text-brand-accent",
  PROPOSAL: "bg-warning-tint text-warning-strong",
  EMPLOYER_ACCEPTANCE: "bg-success-tint text-success-strong",
  BROKER_COMPENSATION: "bg-purple-100 text-purple-700",
  BROKER_OF_RECORD: "bg-warning-tint text-warning-strong",
  RENEWAL_PROPOSAL: "bg-teal-100 text-teal-700",
  HANDOUT: "bg-indigo-100 text-indigo-700",
  SUPPLEMENT: "bg-amber-100 text-amber-700",
  OTHER: "bg-muted text-muted-foreground",
};

export default function DocumentsTab({ clientId }: { clientId: number }) {
  const { toast } = useToast();
  const [showUpload, setShowUpload] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [searchFilter, setSearchFilter] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: docs = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/clients", String(clientId), "documents", categoryFilter],
    queryFn: async () => {
      const params = categoryFilter !== "ALL" ? `?category=${categoryFilter}` : "";
      const res = await fetch(`/api/clients/${clientId}/documents${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch documents");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "documents"] });
      toast({ title: "Document deleted" });
      setDeleteId(null);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filtered = docs.filter(d =>
    !searchFilter || d.documentName.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const renewalDocs = docs.filter(d => VERSIONED_CATEGORIES.has(d.category));
  // One row per client+category+normalizedFileName group — a resend under a
  // slightly different filename (" (1)", "_v2", "_REVISED") is a version of
  // the same document, not a separate one. Falls back to the raw filename
  // when normalizedFileName isn't set (documents filed before this grouping
  // existed and never caught by the retro-typing pass).
  const renewalGroups = new Map<string, any[]>();
  for (const d of renewalDocs) {
    const key = `${d.category}::${d.normalizedFileName || d.fileName}`;
    if (!renewalGroups.has(key)) renewalGroups.set(key, []);
    renewalGroups.get(key)!.push(d);
  }
  const groupList = Array.from(renewalGroups.values())
    .map(versions => versions.slice().sort((a, b) => (b.version || 0) - (a.version || 0)))
    .sort((a, b) => {
      const aDate = a[0].sentAt || a[0].uploadedAt;
      const bDate = b[0].sentAt || b[0].uploadedAt;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });

  return (
    <div data-testid="documents-tab">
      {groupList.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-brand mb-3">Renewal Documents</h2>
          <div className="space-y-2">
            {groupList.map(versions => (
              <RenewalDocumentGroup key={`${versions[0].category}::${versions[0].normalizedFileName || versions[0].fileName}`} versions={versions} />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold text-brand">All Documents</h2>
        <Button onClick={() => setShowUpload(true)} className="bg-brand text-brand-foreground gap-2" data-testid="button-upload-document">
          <Upload className="w-4 h-4" /> Upload Document
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input type="search" placeholder="Search documents..." value={searchFilter} onChange={e => setSearchFilter(e.target.value)} className="pl-10" data-testid="input-search-documents" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-48" data-testid="select-category-filter"><SelectValue placeholder="All Categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Categories</SelectItem>
            {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!filtered.length && !isLoading ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No documents uploaded yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="bg-card rounded-lg shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-surface-subtle">
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase hidden md:table-cell">Category</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase hidden lg:table-cell">Uploaded</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc: any, i: number) => (
                <tr key={doc.id} className={`border-b hover:bg-surface-subtle/50 transition-colors ${i % 2 === 1 ? "bg-surface-subtle/30" : ""}`} data-testid={`document-row-${doc.id}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{doc.documentName}</p>
                    {doc.notes && <p className="text-xs text-muted-foreground truncate max-w-xs mt-0.5">{doc.notes}</p>}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${CATEGORY_COLORS[doc.category] || "bg-muted text-muted-foreground"}`}>
                      {DOCUMENT_CATEGORY_LABELS[doc.category]}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <p className="text-xs text-muted-foreground">{format(new Date(doc.uploadedAt), "MMM d, yyyy")}</p>
                    <p className="text-xs text-muted-foreground">by {doc.uploadedBy}</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <a href={`/api/documents/${doc.id}/download`} target="_blank" rel="noreferrer">
                        <Button size="icon" variant="ghost" data-testid={`button-download-${doc.id}`}>
                          <Download className="w-4 h-4 text-brand-accent" />
                        </Button>
                      </a>
                      <Button size="icon" variant="ghost" onClick={() => setDeleteId(doc.id)} data-testid={`button-delete-${doc.id}`}>
                        <Trash2 className="w-4 h-4 text-danger" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UploadDialog open={showUpload} onClose={() => setShowUpload(false)} clientId={clientId} />

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. The document will be permanently deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)} className="bg-danger text-danger-foreground" data-testid="button-confirm-delete">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RenewalDocumentGroup({ versions }: { versions: any[] }) {
  const [expanded, setExpanded] = useState(false);
  const current = versions[0];
  const older = versions.slice(1);

  return (
    <Card className="border-0 shadow-sm" data-testid={`renewal-group-${current.id}`}>
      <CardContent className="py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${CATEGORY_COLORS[current.category] || "bg-muted text-muted-foreground"}`}>
                {DOCUMENT_CATEGORY_LABELS[current.category]}
              </span>
              {current.version && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">v{current.version}</span>
              )}
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-success-tint text-success-strong">Current</span>
              {current.isSigned && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-info-tint text-brand-accent">Signed</span>
              )}
              {current.renewalId && (
                <Link href={`/renewals/${current.renewalId}`} className="text-xs text-brand-accent hover:underline">View renewal</Link>
              )}
            </div>
            <p className="font-medium text-foreground mt-1 truncate">{current.fileName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {current.sentAt
                ? `Sent ${format(new Date(current.sentAt), "MM/dd/yyyy")}${current.sentTo ? ` to ${current.sentTo}` : ""}`
                : `Uploaded ${format(new Date(current.uploadedAt), "MM/dd/yyyy")} by ${current.uploadedBy}`}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <a href={`/api/documents/${current.id}/download`} target="_blank" rel="noreferrer">
              <Button size="icon" variant="ghost" data-testid={`button-download-${current.id}`}>
                <Download className="w-4 h-4 text-brand-accent" />
              </Button>
            </a>
            {(older.length > 0 || current.sentAt) && (
              <Button size="icon" variant="ghost" onClick={() => setExpanded(e => !e)} data-testid={`button-expand-${current.id}`}>
                {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </Button>
            )}
          </div>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t space-y-3">
            <DocumentSendHistory documentId={current.id} />
            {older.map(doc => (
              <div key={doc.id} className="flex items-center justify-between gap-3 pl-3 border-l-2 border-border">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {doc.version && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">v{doc.version}</span>}
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-surface-subtle text-muted-foreground">Superseded</span>
                  </div>
                  <p className="text-sm text-foreground mt-0.5 truncate">{doc.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.sentAt ? `Sent ${format(new Date(doc.sentAt), "MM/dd/yyyy")}${doc.sentTo ? ` to ${doc.sentTo}` : ""}` : `Uploaded ${format(new Date(doc.uploadedAt), "MM/dd/yyyy")}`}
                  </p>
                </div>
                <a href={`/api/documents/${doc.id}/download`} target="_blank" rel="noreferrer">
                  <Button size="icon" variant="ghost" data-testid={`button-download-${doc.id}`}>
                    <Download className="w-4 h-4 text-brand-accent" />
                  </Button>
                </a>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DocumentSendHistory({ documentId }: { documentId: number }) {
  const { data: sends = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/documents", String(documentId), "sends"],
    queryFn: async () => {
      const res = await fetch(`/api/documents/${documentId}/sends`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch send history");
      return res.json();
    },
  });

  if (isLoading) return null;
  if (sends.length <= 1) return null; // only the original filing — nothing to show beyond the row above

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
        <FileClock className="w-3.5 h-3.5" /> Send history
      </p>
      <ul className="text-xs text-muted-foreground space-y-0.5">
        {sends.map((s: any) => (
          <li key={s.id}>
            {format(new Date(s.sentAt), "MM/dd/yyyy")}{s.sentTo ? ` to ${s.sentTo}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function UploadDialog({ open, onClose, clientId }: { open: boolean; onClose: () => void; clientId: number }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ documentName: "", category: "", notes: "" });
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const mutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch(`/api/clients/${clientId}/documents`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "documents"] });
      toast({ title: "Document uploaded successfully" });
      onClose();
      setForm({ documentName: "", category: "", notes: "" });
      setFile(null);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !form.documentName || !form.category) return;
    if (file.size > 25 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 25 MB", variant: "destructive" });
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("documentName", form.documentName);
    formData.append("category", form.category);
    formData.append("notes", form.notes);
    mutation.mutate(formData);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-brand">Upload Document</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Document Name <span className="text-danger">*</span></Label>
            <Input value={form.documentName} onChange={e => setForm(f => ({ ...f, documentName: e.target.value }))} data-testid="input-document-name" />
          </div>
          <div>
            <Label className="text-sm font-medium">Category <span className="text-danger">*</span></Label>
            <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
              <SelectTrigger data-testid="select-document-category"><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm font-medium">File <span className="text-danger">*</span></Label>
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                dragOver ? "border-brand bg-brand/5" : "border-border hover:border-brand"
              }`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              data-testid="dropzone"
            >
              <input ref={fileRef} type="file" className="hidden" accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg" onChange={e => setFile(e.target.files?.[0] || null)} />
              {file ? (
                <div>
                  <FileText className="w-8 h-8 text-brand-accent mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              ) : (
                <div>
                  <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Drag & drop or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, XLSX, PNG, JPG (max 25 MB)</p>
                </div>
              )}
            </div>
          </div>
          <div>
            <Label className="text-sm font-medium">Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." data-testid="input-document-notes" />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={mutation.isPending || !file || !form.documentName || !form.category} className="bg-brand text-brand-foreground" data-testid="button-upload">
              {mutation.isPending ? "Uploading..." : "Upload"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
