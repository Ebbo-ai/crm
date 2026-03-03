import { useState, useRef } from "react";
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
import { Upload, Download, Trash2, FileText, Search } from "lucide-react";
import { format } from "date-fns";

const CATEGORY_COLORS: Record<string, string> = {
  CLIENT_AGREEMENT: "bg-blue-100 text-blue-700",
  PROPOSAL: "bg-amber-100 text-amber-700",
  EMPLOYER_ACCEPTANCE: "bg-green-100 text-green-700",
  BROKER_COMPENSATION: "bg-purple-100 text-purple-700",
  BROKER_OF_RECORD: "bg-orange-100 text-orange-700",
  RENEWAL_PROPOSAL: "bg-teal-100 text-teal-700",
  OTHER: "bg-gray-100 text-gray-700",
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

  return (
    <div data-testid="documents-tab">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold text-[#1A5276]">Documents</h2>
        <Button onClick={() => setShowUpload(true)} className="bg-[#1A5276] text-white gap-2" data-testid="button-upload-document">
          <Upload className="w-4 h-4" /> Upload Document
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
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
            <FileText className="w-10 h-10 text-[#94A3B8] mx-auto mb-2" />
            <p className="text-sm text-[#94A3B8]">No documents uploaded yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-[#F0F4F8]">
                <th className="px-4 py-3 text-left text-xs font-medium text-[#94A3B8] uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#94A3B8] uppercase hidden md:table-cell">Category</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#94A3B8] uppercase hidden lg:table-cell">Uploaded</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[#94A3B8] uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc: any, i: number) => (
                <tr key={doc.id} className={`border-b hover:bg-[#F0F4F8]/50 transition-colors ${i % 2 === 1 ? "bg-[#F0F4F8]/30" : ""}`} data-testid={`document-row-${doc.id}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#2C3E50]">{doc.documentName}</p>
                    {doc.notes && <p className="text-xs text-[#94A3B8] truncate max-w-xs mt-0.5">{doc.notes}</p>}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${CATEGORY_COLORS[doc.category] || "bg-gray-100 text-gray-700"}`}>
                      {DOCUMENT_CATEGORY_LABELS[doc.category]}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <p className="text-xs text-[#94A3B8]">{format(new Date(doc.uploadedAt), "MMM d, yyyy")}</p>
                    <p className="text-xs text-[#94A3B8]">by {doc.uploadedBy}</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <a href={`/api/documents/${doc.id}/download`} target="_blank" rel="noreferrer">
                        <Button size="icon" variant="ghost" data-testid={`button-download-${doc.id}`}>
                          <Download className="w-4 h-4 text-[#2E86C1]" />
                        </Button>
                      </a>
                      <Button size="icon" variant="ghost" onClick={() => setDeleteId(doc.id)} data-testid={`button-delete-${doc.id}`}>
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

      <UploadDialog open={showUpload} onClose={() => setShowUpload(false)} clientId={clientId} />

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. The document will be permanently deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)} className="bg-[#EF4444] text-white" data-testid="button-confirm-delete">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
          <DialogTitle className="text-[#1A5276]">Upload Document</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Document Name <span className="text-[#EF4444]">*</span></Label>
            <Input value={form.documentName} onChange={e => setForm(f => ({ ...f, documentName: e.target.value }))} data-testid="input-document-name" />
          </div>
          <div>
            <Label className="text-sm font-medium">Category <span className="text-[#EF4444]">*</span></Label>
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
            <Label className="text-sm font-medium">File <span className="text-[#EF4444]">*</span></Label>
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                dragOver ? "border-[#1A5276] bg-[#1A5276]/5" : "border-gray-300 hover:border-[#1A5276]"
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
                  <FileText className="w-8 h-8 text-[#2E86C1] mx-auto mb-2" />
                  <p className="text-sm font-medium text-[#2C3E50]">{file.name}</p>
                  <p className="text-xs text-[#94A3B8]">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              ) : (
                <div>
                  <Upload className="w-8 h-8 text-[#94A3B8] mx-auto mb-2" />
                  <p className="text-sm text-[#94A3B8]">Drag & drop or click to browse</p>
                  <p className="text-xs text-[#94A3B8] mt-1">PDF, DOCX, XLSX, PNG, JPG (max 25 MB)</p>
                </div>
              )}
            </div>
          </div>
          <div>
            <Label className="text-sm font-medium">Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." data-testid="input-document-notes" />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={mutation.isPending || !file || !form.documentName || !form.category} className="bg-[#1A5276] text-white" data-testid="button-upload">
              {mutation.isPending ? "Uploading..." : "Upload"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
