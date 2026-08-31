import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Shield, User as UserIcon } from "lucide-react";

export default function SettingsUsersPage() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ["/api/users"],
  });

  return (
    <div data-testid="settings-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand">User Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage system users and permissions</p>
        </div>
        <Button onClick={() => { setEditingUser(null); setShowForm(true); }} className="bg-brand text-brand-foreground gap-2" data-testid="button-add-user">
          <Plus className="w-4 h-4" /> Add User
        </Button>
      </div>

      <div className="bg-card rounded-lg shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-surface-subtle">
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">User</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase hidden md:table-cell">Email</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Role</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Status</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u: any, i: number) => (
              <tr key={u.id} className={`border-b hover:bg-surface-subtle/50 transition-colors ${!u.isActive ? "opacity-50" : ""}`} data-testid={`user-row-${u.id}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                      u.role === "ADMIN" ? "bg-gold/10 text-warning-strong" : "bg-brand-accent/10 text-brand-accent"
                    }`}>
                      {u.fullName.charAt(0)}
                    </div>
                    <span className="font-medium text-foreground">{u.fullName}</span>
                  </div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium flex items-center gap-1 w-fit ${
                    u.role === "ADMIN" ? "bg-gold/10 text-warning-strong" : "bg-brand-accent/10 text-brand-accent"
                  }`}>
                    {u.role === "ADMIN" ? <Shield className="w-3 h-3" /> : <UserIcon className="w-3 h-3" />}
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    u.isActive ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
                  }`}>
                    {u.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button size="icon" variant="ghost" onClick={() => { setEditingUser(u); setShowForm(true); }} data-testid={`button-edit-user-${u.id}`}>
                    <Edit className="w-4 h-4 text-brand-accent" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <UserFormDialog
        open={showForm}
        onClose={() => { setShowForm(false); setEditingUser(null); }}
        user={editingUser}
        currentUserId={currentUser?.id}
      />
    </div>
  );
}

function UserFormDialog({ open, onClose, user, currentUserId }: { open: boolean; onClose: () => void; user: any; currentUserId?: number }) {
  const { toast } = useToast();
  const isEdit = !!user;
  const [form, setForm] = useState({
    fullName: user?.fullName || "",
    email: user?.email || "",
    password: "",
    confirmPassword: "",
    role: user?.role || "STANDARD",
    isActive: user?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      if (isEdit) {
        const res = await apiRequest("PUT", `/api/users/${user.id}`, data);
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/users", data);
        return res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: `User ${isEdit ? "updated" : "created"} successfully` });
      onClose();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.fullName.trim()) errs.fullName = "Name is required";
    if (!form.email.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Invalid email";
    if (!isEdit || form.password) {
      if (!isEdit && !form.password) errs.password = "Password is required";
      if (form.password && form.password.length < 8) errs.password = "Minimum 8 characters";
      if (form.password && !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])/.test(form.password))
        errs.password = "Must contain uppercase, lowercase, number, and special character";
      if (form.password !== form.confirmPassword) errs.confirmPassword = "Passwords don't match";
    }
    if (isEdit && !form.isActive && user.id === currentUserId) errs.isActive = "Cannot deactivate yourself";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    const data: any = { fullName: form.fullName, email: form.email, role: form.role, isActive: form.isActive };
    if (form.password) data.password = form.password;
    mutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-brand">{isEdit ? "Edit User" : "Add New User"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Full Name <span className="text-danger">*</span></Label>
            <Input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} data-testid="input-user-name" />
            {errors.fullName && <p className="text-xs text-danger mt-1">{errors.fullName}</p>}
          </div>
          <div>
            <Label className="text-sm font-medium">Email <span className="text-danger">*</span></Label>
            <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} data-testid="input-user-email" />
            {errors.email && <p className="text-xs text-danger mt-1">{errors.email}</p>}
          </div>
          <div>
            <Label className="text-sm font-medium">{isEdit ? "New Password" : "Password"} {!isEdit && <span className="text-danger">*</span>}</Label>
            <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={isEdit ? "Leave blank to keep current" : ""} data-testid="input-user-password" />
            {errors.password && <p className="text-xs text-danger mt-1">{errors.password}</p>}
            {form.password && (
              <div className="mt-1.5 flex gap-1">
                {[
                  form.password.length >= 8,
                  /[A-Z]/.test(form.password),
                  /[a-z]/.test(form.password),
                  /\d/.test(form.password),
                  /[!@#$%^&*]/.test(form.password),
                ].map((ok, i) => (
                  <div key={i} className={`h-1 flex-1 rounded-full ${ok ? "bg-success" : "bg-muted"}`} />
                ))}
              </div>
            )}
          </div>
          {(form.password || !isEdit) && (
            <div>
              <Label className="text-sm font-medium">Confirm Password</Label>
              <Input type="password" value={form.confirmPassword} onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))} data-testid="input-user-confirm-password" />
              {errors.confirmPassword && <p className="text-xs text-danger mt-1">{errors.confirmPassword}</p>}
            </div>
          )}
          <div>
            <Label className="text-sm font-medium">Role</Label>
            <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
              <SelectTrigger data-testid="select-user-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="STANDARD">Standard</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isEdit && (
            <div className="flex items-center gap-3">
              <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} data-testid="switch-user-active" />
              <Label className="text-sm">{form.isActive ? "Active" : "Inactive"}</Label>
              {errors.isActive && <p className="text-xs text-danger">{errors.isActive}</p>}
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={mutation.isPending} className="bg-brand text-brand-foreground" data-testid="button-save-user">
              {mutation.isPending ? "Saving..." : isEdit ? "Update User" : "Create User"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
