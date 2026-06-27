import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Sparkles, Loader2, Search, ChevronDown, X, Zap } from "lucide-react";

interface Client {
  id: number;
  clientName: string;
  clientCode: string;
}

interface QuickLogModalProps {
  open: boolean;
  onClose: () => void;
  defaultClientId?: number;
}

export function QuickLogModal({ open, onClose, defaultClientId }: QuickLogModalProps) {
  const { toast } = useToast();
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [senderEmail, setSenderEmail] = useState("");
  const [senderName, setSenderName] = useState("");
  const [content, setContent] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: clients = [] } = useQuery<Client[]>({ queryKey: ["/api/clients"] });

  const todayStamp = format(new Date(), "MMMM d, yyyy");
  const dateLine = `[${todayStamp}]\n`;

  useEffect(() => {
    if (open) {
      setClientSearch("");
      setShowDropdown(false);
      setSenderEmail("");
      setSenderName("");
      setContent(dateLine);

      if (defaultClientId) {
        const found = clients.find(c => c.id === defaultClientId);
        if (found) {
          setSelectedClient(found);
          setClientSearch(found.clientName);
        }
      } else {
        setSelectedClient(null);
      }

      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (open && defaultClientId && clients.length > 0) {
      const found = clients.find(c => c.id === defaultClientId);
      if (found) {
        setSelectedClient(found);
        setClientSearch(found.clientName);
      }
    }
  }, [open, defaultClientId, clients]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = clients.filter(c =>
    c.clientName.toLowerCase().includes(clientSearch.toLowerCase()) ||
    c.clientCode.toLowerCase().includes(clientSearch.toLowerCase())
  ).slice(0, 12);

  const handleSelectClient = (c: Client) => {
    setSelectedClient(c);
    setClientSearch(c.clientName);
    setShowDropdown(false);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("senderEmail", senderEmail);
      fd.append("senderName", senderName);
      fd.append("bodyText", content);
      fd.append("subject", `Quick log — ${todayStamp}`);
      if (selectedClient) fd.append("clientIds", String(selectedClient.id));
      const res = await fetch("/api/communications/manual", {
        method: "POST", body: fd, credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/communications"] });
      if (selectedClient) {
        queryClient.invalidateQueries({ queryKey: ["/api/clients", String(selectedClient.id), "communications"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/communication-tasks"] });
      toast({ title: "Communication logged", description: "AI has summarized and extracted action items." });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const canSubmit = senderEmail.trim() && content.trim().replace(dateLine, "").trim() && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl" data-testid="quick-log-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1A5276]">
            <Zap className="w-4 h-4 text-[#F5A623]" />
            Quick Log Communication
            <span className="ml-auto text-[10px] font-normal text-[#94A3B8] bg-[#F0F4F8] px-2 py-0.5 rounded font-mono">
              Ctrl+Shift+E
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-1">
          {/* Client picker */}
          <div ref={dropdownRef} className="relative">
            <Label className="text-xs font-semibold text-[#64748B] uppercase tracking-wide">Client</Label>
            <div className="relative mt-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8] pointer-events-none" />
              <Input
                ref={searchRef}
                value={clientSearch}
                onChange={e => {
                  setClientSearch(e.target.value);
                  setSelectedClient(null);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                onKeyDown={e => {
                  if (e.key === "Escape") setShowDropdown(false);
                  if (e.key === "ArrowDown" && filtered.length > 0) {
                    setShowDropdown(true);
                  }
                }}
                placeholder="Type client name or code..."
                className="pl-8 pr-8"
                data-testid="input-quicklog-client"
                autoComplete="off"
              />
              {selectedClient ? (
                <button
                  onClick={() => { setSelectedClient(null); setClientSearch(""); setShowDropdown(false); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#EF4444]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8] pointer-events-none" />
              )}
            </div>

            {showDropdown && filtered.length > 0 && (
              <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-[#E2E8F0] rounded-lg shadow-lg max-h-52 overflow-y-auto">
                {filtered.map(c => (
                  <button
                    key={c.id}
                    onMouseDown={e => { e.preventDefault(); handleSelectClient(c); }}
                    className={`w-full text-left px-3 py-2.5 hover:bg-[#F0F4F8] flex items-center justify-between transition-colors ${selectedClient?.id === c.id ? "bg-[#EBF5FB]" : ""}`}
                    data-testid={`quicklog-client-option-${c.id}`}
                  >
                    <span className="text-sm font-medium text-[#2C3E50]">{c.clientName}</span>
                    <span className="text-xs text-[#94A3B8] font-mono">{c.clientCode}</span>
                  </button>
                ))}
              </div>
            )}

            {selectedClient && (
              <p className="text-xs text-[#22C55E] mt-1 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] inline-block" />
                Linked to <strong>{selectedClient.clientName}</strong>
              </p>
            )}
            {!selectedClient && clientSearch === "" && (
              <p className="text-xs text-[#94A3B8] mt-1">Optional — leave blank for unmatched inbox</p>
            )}
          </div>

          {/* Sender info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold text-[#64748B] uppercase tracking-wide">Sender Email *</Label>
              <Input
                value={senderEmail}
                onChange={e => setSenderEmail(e.target.value)}
                placeholder="broker@example.com"
                className="mt-1"
                data-testid="input-quicklog-sender-email"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold text-[#64748B] uppercase tracking-wide">Sender Name</Label>
              <Input
                value={senderName}
                onChange={e => setSenderName(e.target.value)}
                placeholder="Jane Smith"
                className="mt-1"
                data-testid="input-quicklog-sender-name"
              />
            </div>
          </div>

          {/* Content */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs font-semibold text-[#64748B] uppercase tracking-wide">Content *</Label>
              <span className="text-[10px] text-[#94A3B8] bg-[#F0F4F8] px-2 py-0.5 rounded">
                Date auto-stamped: {todayStamp}
              </span>
            </div>
            <Textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Paste email content here..."
              rows={9}
              className="font-mono text-xs resize-none"
              data-testid="textarea-quicklog-content"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-[#94A3B8]">
              <Sparkles className="w-3 h-3 inline mr-1 text-[#F5A623]" />
              Claude will summarize and extract action items
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} data-testid="button-quicklog-cancel">
                Cancel
              </Button>
              <Button
                onClick={() => mutation.mutate()}
                disabled={!canSubmit}
                className="bg-[#1A5276] hover:bg-[#154360] text-white gap-2"
                data-testid="button-quicklog-submit"
              >
                {mutation.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                  : <><Sparkles className="w-4 h-4" /> Save & Summarize</>
                }
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function useQuickLog() {
  const [open, setOpen] = useState(false);
  const [defaultClientId, setDefaultClientId] = useState<number | undefined>();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "E") {
        e.preventDefault();
        setDefaultClientId(undefined);
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const openQuickLog = (clientId?: number) => {
    setDefaultClientId(clientId);
    setOpen(true);
  };

  return { open, defaultClientId, openQuickLog, closeQuickLog: () => setOpen(false) };
}
