import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Loader2, Mail } from "lucide-react";

interface SendingIdentity {
  id: number;
  email: string;
  displayName: string;
  signature: string | null;
  isActive: boolean;
}

interface User {
  id: number;
  fullName: string;
  email: string;
  isActive: boolean;
}

interface Grant {
  userId: number;
  sendingIdentityId: number;
}

function AddIdentityDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ email: "", displayName: "", signature: "" });

  const create = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sending-identities", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sending-identities"] });
      toast({ title: "Sending identity added" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Could not add it", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a sending address</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <Label className="text-xs">Email *</Label>
            <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="name@simple.us" className="mt-1" data-testid="input-identity-email" />
          </div>
          <div>
            <Label className="text-xs">Display name *</Label>
            <Input value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
              placeholder="Jane Doe" className="mt-1" data-testid="input-identity-name" />
          </div>
          <div>
            <Label className="text-xs">Default signature</Label>
            <Textarea value={form.signature} onChange={e => setForm(f => ({ ...f, signature: e.target.value }))}
              rows={4} className="mt-1 text-sm" data-testid="textarea-identity-signature" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={!form.email.trim() || !form.displayName.trim() || create.isPending}
              className="bg-brand text-brand-foreground gap-2" data-testid="button-save-identity">
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SettingsSendingPage() {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);

  const { data: identities = [] } = useQuery<SendingIdentity[]>({ queryKey: ["/api/sending-identities"] });
  const { data: users = [] } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const { data: grants = [] } = useQuery<Grant[]>({ queryKey: ["/api/sending-permissions"] });

  const save = useMutation({
    mutationFn: ({ userId, identityIds }: { userId: number; identityIds: number[] }) =>
      apiRequest("PUT", `/api/sending-permissions/${userId}`, { identityIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sending-permissions"] });
      toast({ title: "Permissions updated" });
    },
    onError: (e: any) => toast({ title: "Could not update", description: e.message, variant: "destructive" }),
  });

  const toggle = (userId: number, identityId: number, checked: boolean) => {
    const current = grants.filter(g => g.userId === userId).map(g => g.sendingIdentityId);
    const next = checked ? [...current, identityId] : current.filter(id => id !== identityId);
    save.mutate({ userId, identityIds: next });
  };

  const activeUsers = users.filter(u => u.isActive);

  return (
    <div data-testid="settings-sending-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand">Sending Identities</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Which addresses exist, and which users may send from each one. Every send from the CRM is checked against this table.
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="bg-brand text-brand-foreground gap-2" data-testid="button-add-identity">
          <Plus className="w-4 h-4" /> Add Address
        </Button>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-brand" />
            <span className="text-sm font-semibold text-brand">Permission matrix</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-surface-subtle">
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">User</th>
                  {identities.map(i => (
                    <th key={i.id} className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase">
                      {i.displayName}<br /><span className="normal-case font-normal">{i.email}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeUsers.map(u => (
                  <tr key={u.id} className="border-b hover:bg-surface-subtle/50" data-testid={`sending-row-${u.id}`}>
                    <td className="px-4 py-3 font-medium text-foreground">{u.fullName}</td>
                    {identities.map(i => {
                      const checked = grants.some(g => g.userId === u.id && g.sendingIdentityId === i.id);
                      return (
                        <td key={i.id} className="px-4 py-3 text-center">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={v => toggle(u.id, i.id, !!v)}
                            data-testid={`checkbox-grant-${u.id}-${i.id}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {identities.length === 0 && (
            <p className="text-sm text-muted-foreground p-6 text-center">No sending addresses yet — add one above.</p>
          )}
        </CardContent>
      </Card>

      {showAdd && <AddIdentityDialog onClose={() => setShowAdd(false)} />}
    </div>
  );
}
