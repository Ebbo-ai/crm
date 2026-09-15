import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pencil, Check, Users } from "lucide-react";

interface VendorContact {
  id: number;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
}

/**
 * The 90 Degree Benefits routing contacts. One shared list — editing a phone
 * or email here updates it everywhere, since these are the same six people
 * for every client, not a per-client copy.
 */
export default function VendorContactsCard() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ email: string; phone: string }>({ email: "", phone: "" });

  const { data: contacts = [] } = useQuery<VendorContact[]>({ queryKey: ["/api/vendor-contacts"] });

  const save = useMutation({
    mutationFn: (vars: { id: number; email: string; phone: string }) =>
      apiRequest("PATCH", `/api/vendor-contacts/${vars.id}`, { email: vars.email || null, phone: vars.phone || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendor-contacts"] });
      setEditingId(null);
    },
  });

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3 pt-5 px-6">
        <h2 className="text-lg font-semibold text-brand flex items-center gap-2">
          <Users className="w-4 h-4" /> 90 Degree Benefits Contacts
        </h2>
      </CardHeader>
      <CardContent className="px-6 pb-6 space-y-2">
        {contacts.map(c => (
          <div key={c.id} className="flex items-start justify-between gap-3 py-1.5 border-b last:border-b-0" data-testid={`row-vendor-contact-${c.id}`}>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{c.name}</p>
              <p className="text-xs text-muted-foreground">{c.role}</p>
            </div>
            {editingId === c.id ? (
              <div className="flex flex-col gap-1 items-end shrink-0 w-48">
                <Input
                  placeholder="Email"
                  value={draft.email}
                  onChange={e => setDraft(d => ({ ...d, email: e.target.value }))}
                  className="h-7 text-xs"
                  data-testid={`input-vendor-email-${c.id}`}
                />
                <Input
                  placeholder="Phone"
                  value={draft.phone}
                  onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))}
                  className="h-7 text-xs"
                  data-testid={`input-vendor-phone-${c.id}`}
                />
                <Button size="sm" className="h-6 px-2 text-xs" onClick={() => save.mutate({ id: c.id, ...draft })} data-testid={`button-save-vendor-${c.id}`}>
                  <Check className="w-3 h-3 mr-1" /> Save
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 shrink-0 text-right">
                <div className="text-xs text-muted-foreground">
                  <p>{c.email || <span className="italic">no email</span>}</p>
                  <p>{c.phone || <span className="italic">no phone</span>}</p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => { setEditingId(c.id); setDraft({ email: c.email ?? "", phone: c.phone ?? "" }); }}
                  data-testid={`button-edit-vendor-${c.id}`}
                >
                  <Pencil className="w-3 h-3" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
