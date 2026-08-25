import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { US_STATES, formatPhone } from "@/lib/constants";
import { ArrowLeft, Save, Plus, Trash2 } from "lucide-react";

const planTypeOptions = [
  { value: "DENTAL", label: "Dental" },
  { value: "VISION", label: "Vision" },
  { value: "HEARING", label: "Hearing" },
  { value: "DENTAL_VISION", label: "Dental / Vision" },
  { value: "HEARING_VISION", label: "Hearing / Vision" },
  { value: "DENTAL_HEARING_VISION", label: "Dental / Hearing / Vision" },
];

/**
 * One person at the brokerage. A brokerage typically names a lead (Account Advisor,
 * Account Executive, Implementation Manager) plus a service representative, and
 * occasionally a third, so these are edited as a list rather than fixed fields.
 */
interface BrokerContactRow {
  contactName: string;
  email: string;
  phone: string;
  role: string;
  isPrimary: boolean;
}

const emptyBrokerContact = (isPrimary = false): BrokerContactRow => ({
  contactName: "",
  email: "",
  phone: "",
  role: "",
  isPrimary,
});

/** Suggestions only — brokerages use titles this list will never fully cover. */
const BROKER_ROLE_SUGGESTIONS = [
  "Account Advisor",
  "Account Executive",
  "Account Manager",
  "Implementation Manager",
  "Service Representative",
];

function isLastDayOfMonth(date: Date): boolean {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next.getDate() === 1;
}

const emptyForm = {
  clientCode: "",
  clientName: "",
  streetAddress: "",
  suiteUnit: "",
  city: "",
  state: "",
  zipCode: "",
  industryType: "",
  numberOfEmployees: "" as string | number,
  anniversaryDate: "",
  renewalLeadMonths: 3,
  clientStatus: "ACTIVE" as "PROSPECT" | "ACTIVE" | "TERMINATED",
  terminationDate: "",
  planType: "DENTAL",
  networkActive: false,
  dentalNetworkName: "Dentemax",
  decisionMakerName: "",
  decisionMakerTitle: "",
  decisionMakerPhone: "",
  decisionMakerEmail: "",
  adminContactName: "",
  adminContactTitle: "Admin Contact",
  adminContactPhone: "",
  adminContactEmail: "",
  hasBroker: false,
  brokerFirmName: "",
  brokerContactName: "",
  brokerPhone: "",
  brokerEmail: "",
  bankingType: "",
  fundingType: "",
  cobraAdministeredBy90d: false,
  cobraFee: "1.00",
  accountBalance: "",
  accountBalanceAsOfDate: "",
};

export default function ClientFormPage() {
  const params = useParams<{ id?: string }>();
  const isEdit = !!params.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: existingClient } = useQuery<any>({
    queryKey: ["/api/clients", params.id],
    enabled: isEdit,
  });

  const [form, setForm] = useState(emptyForm);
  const [brokerContacts, setBrokerContacts] = useState<BrokerContactRow[]>([]);
  const [sameAsPrimary, setSameAsPrimary] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [codeChecking, setCodeChecking] = useState(false);

  useEffect(() => {
    if (existingClient && isEdit) {
      const isSame =
        existingClient.adminContactName === existingClient.decisionMakerName &&
        existingClient.adminContactPhone === existingClient.decisionMakerPhone &&
        existingClient.adminContactEmail === existingClient.decisionMakerEmail;
      setSameAsPrimary(isSame);
      setForm({
        clientCode: (existingClient.clientCode || "").replace(/^S-/, ""),
        clientName: existingClient.clientName || "",
        streetAddress: existingClient.streetAddress || "",
        suiteUnit: existingClient.suiteUnit || "",
        city: existingClient.city || "",
        state: existingClient.state || "",
        zipCode: existingClient.zipCode || "",
        industryType: existingClient.industryType || "",
        numberOfEmployees: existingClient.numberOfEmployees ?? "",
        anniversaryDate: existingClient.anniversaryDate
          ? existingClient.anniversaryDate.split("T")[0]
          : "",
        renewalLeadMonths: existingClient.renewalLeadMonths ?? 3,
        clientStatus:
          (existingClient.clientStatus as "PROSPECT" | "ACTIVE" | "TERMINATED") ||
          (existingClient.isActive === false || existingClient.terminationDate
            ? "TERMINATED"
            : "ACTIVE"),
        terminationDate: existingClient.terminationDate
          ? existingClient.terminationDate.split("T")[0]
          : "",
        planType: existingClient.planType || "DENTAL",
        networkActive: existingClient.networkActive ?? false,
        dentalNetworkName: existingClient.dentalNetworkName || "Dentemax",
        decisionMakerName: existingClient.decisionMakerName || "",
        decisionMakerTitle: existingClient.decisionMakerTitle || "",
        decisionMakerPhone: existingClient.decisionMakerPhone || "",
        decisionMakerEmail: existingClient.decisionMakerEmail || "",
        adminContactName: existingClient.adminContactName || "",
        adminContactTitle: existingClient.adminContactTitle || "Admin Contact",
        adminContactPhone: existingClient.adminContactPhone || "",
        adminContactEmail: existingClient.adminContactEmail || "",
        hasBroker: existingClient.hasBroker ?? false,
        brokerFirmName: existingClient.brokerFirmName || "",
        brokerContactName: existingClient.brokerContactName || "",
        brokerPhone: existingClient.brokerPhone || "",
        brokerEmail: existingClient.brokerEmail || "",
        bankingType: existingClient.bankingType || "",
        fundingType: existingClient.fundingType || "",
        cobraAdministeredBy90d: existingClient.cobraAdministeredBy90d ?? false,
        cobraFee:
          existingClient.cobraFee != null ? String(existingClient.cobraFee) : "1.00",
        accountBalance:
          existingClient.accountBalance != null
            ? String(existingClient.accountBalance)
            : "",
        accountBalanceAsOfDate: existingClient.accountBalanceAsOfDate
          ? existingClient.accountBalanceAsOfDate.split("T")[0]
          : "",
      });
    }
  }, [existingClient, isEdit]);

  // Keep admin contact in sync when "same as primary" is checked
  useEffect(() => {
    if (sameAsPrimary) {
      setForm(prev => ({
        ...prev,
        adminContactName: prev.decisionMakerName,
        adminContactTitle: prev.decisionMakerTitle,
        adminContactPhone: prev.decisionMakerPhone,
        adminContactEmail: prev.decisionMakerEmail,
      }));
    }
  }, [
    sameAsPrimary,
    form.decisionMakerName,
    form.decisionMakerTitle,
    form.decisionMakerPhone,
    form.decisionMakerEmail,
  ]);

  // Load the contact rows for an existing client. A brokerage assigns a lead plus a
  // service rep, so this is a list rather than one fixed set of fields.
  const { data: existingContacts } = useQuery<any[]>({
    queryKey: ["/api/clients", params.id, "broker-contacts"],
    queryFn: () =>
      fetch(`/api/clients/${params.id}/broker-contacts`, { credentials: "include" })
        .then(r => (r.ok ? r.json() : [])),
    enabled: isEdit && !!params.id,
  });

  useEffect(() => {
    if (!existingContacts) return;
    if (existingContacts.length > 0) {
      setBrokerContacts(existingContacts.map((c: any) => ({
        contactName: c.contactName || "",
        email: c.email || "",
        phone: c.phone || "",
        role: c.role || "",
        isPrimary: !!c.isPrimary,
      })));
    } else if (existingClient?.brokerContactName || existingClient?.brokerEmail) {
      // Never edited as a list — seed one row from the flat columns so saving the
      // form does not silently drop the contact already on file.
      setBrokerContacts([{
        contactName: existingClient.brokerContactName || existingClient.brokerEmail || "",
        email: existingClient.brokerEmail || "",
        phone: existingClient.brokerPhone || "",
        role: "",
        isPrimary: true,
      }]);
    }
  }, [existingContacts, existingClient]);

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      // Contacts travel with the client in one request. Two requests would let the
      // client save and the contacts fail, leaving the flat broker columns describing
      // somebody the contact list does not contain.
      const res = isEdit
        ? await apiRequest("PUT", `/api/clients/${params.id}`, data)
        : await apiRequest("POST", "/api/clients", data);
      return await res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client saved successfully", variant: "default" });
      navigate(`/clients/${result.id}`);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const validate = () => {
    const errs: Record<string, string> = {};
    // Only three fields are truly required
    if (!form.clientCode.trim()) errs.clientCode = "Client ID is required";
    else if (!/^\d+$/.test(form.clientCode)) errs.clientCode = "Client ID must be digits only (e.g., 20, 111, 455)";
    if (!form.clientName.trim()) errs.clientName = "Client name is required";
    // planType always has a value from the select — no check needed

    // Format checks — only when the field has a value
    if (form.decisionMakerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.decisionMakerEmail))
      errs.decisionMakerEmail = "Invalid email format";
    if (form.adminContactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminContactEmail))
      errs.adminContactEmail = "Invalid email format";
    if (form.hasBroker) {
      brokerContacts.forEach((c, i) => {
        if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))
          errs[`brokerContact-${i}-email`] = "Invalid email format";
        if (!c.contactName.trim() && (c.email || c.phone || c.role))
          errs[`brokerContact-${i}-name`] = "Name is required when other details are filled in";
      });
      const named = brokerContacts.filter(c => c.contactName.trim());
      const dupe = named.find((c, i) =>
        named.findIndex(o => o.contactName.trim().toLowerCase() === c.contactName.trim().toLowerCase()) !== i);
      if (dupe) errs.brokerContacts = `"${dupe.contactName}" is listed twice.`;
      if (named.length > 0 && !named.some(c => c.isPrimary))
        errs.brokerContacts = "Mark one contact as the primary.";
    }
    if (form.zipCode && !/^\d{5}(-\d{4})?$/.test(form.zipCode))
      errs.zipCode = "Invalid ZIP format (00000 or 00000-0000)";

    // Termination date must be end-of-month
    if (form.clientStatus === "TERMINATED" && form.terminationDate) {
      const d = new Date(form.terminationDate + "T00:00:00");
      if (!isLastDayOfMonth(d))
        errs.terminationDate = "Termination date must be the last day of a calendar month";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const fullCode = `S-${form.clientCode}`;
    try {
      setCodeChecking(true);
      const res = await fetch(`/api/clients/check-code/${fullCode}`, { credentials: "include" });
      const check = await res.json();
      if (check.exists && (!isEdit || check.clientId !== parseInt(params.id!))) {
        setErrors(prev => ({ ...prev, clientCode: `Client ID ${fullCode} is already in use` }));
        setCodeChecking(false);
        return;
      }
    } catch {
      toast({ title: "Error", description: "Could not verify Client ID", variant: "destructive" });
      setCodeChecking(false);
      return;
    }
    setCodeChecking(false);

    const data: any = {
      ...form,
      clientCode: fullCode,
      numberOfEmployees: form.numberOfEmployees !== "" ? Number(form.numberOfEmployees) : null,
    };
    data.isActive = data.clientStatus === "ACTIVE";
    if (data.clientStatus === "TERMINATED" && data.terminationDate) {
      data.terminationDate = new Date(data.terminationDate + "T00:00:00");
    } else {
      data.terminationDate = null;
    }
    if (!data.networkActive) data.dentalNetworkName = null;
    const contacts = brokerContacts
      .filter(c => c.contactName.trim())
      .map(c => ({
        contactName: c.contactName.trim(),
        email: c.email.trim() || null,
        phone: c.phone.trim() || null,
        role: c.role.trim() || null,
        isPrimary: c.isPrimary,
      }));
    data.brokerContacts = contacts;

    if (!data.hasBroker) {
      data.brokerFirmName = null;
      data.brokerContactName = null;
      data.brokerPhone = null;
      data.brokerEmail = null;
      data.brokerContacts = [];
    } else {
      // Mirror the lead onto the flat columns in the same write that creates the
      // client, so a reader that has not been moved to the contacts table never sees
      // a client with a broker and no contact details.
      const primary = contacts.find(c => c.isPrimary) ?? contacts[0] ?? null;
      data.brokerContactName = primary?.contactName ?? null;
      data.brokerPhone = primary?.phone ?? null;
      data.brokerEmail = primary?.email ?? null;
    }
    // Nullify empty strings for optional fields
    if (!data.bankingType) data.bankingType = null;
    if (!data.fundingType) data.fundingType = null;
    if (!data.anniversaryDate) data.anniversaryDate = null;
    // Account balance only applies to 90 Degree bank
    if (data.bankingType !== "NINETY_DEGREE_BANK") {
      data.accountBalance = null;
      data.accountBalanceAsOfDate = null;
    } else {
      data.accountBalance = data.accountBalance !== "" ? data.accountBalance : null;
      data.accountBalanceAsOfDate = data.accountBalanceAsOfDate
        ? new Date(data.accountBalanceAsOfDate + "T00:00:00")
        : null;
    }
    if (!data.cobraAdministeredBy90d) data.cobraFee = null;
    mutation.mutate(data);
  };

  const updateField = (field: string, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  };

  const updateBrokerContact = (index: number, patch: Partial<BrokerContactRow>) => {
    setBrokerContacts(prev => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    setErrors(prev => {
      const n = { ...prev };
      delete n[`brokerContact-${index}-email`];
      delete n[`brokerContact-${index}-name`];
      delete n.brokerContacts;
      return n;
    });
  };

  /** Exactly one primary — the database enforces the same rule. */
  const setPrimaryBrokerContact = (index: number) => {
    setBrokerContacts(prev => prev.map((c, i) => ({ ...c, isPrimary: i === index })));
    setErrors(prev => { const n = { ...prev }; delete n.brokerContacts; return n; });
  };

  const removeBrokerContact = (index: number) => {
    setBrokerContacts(prev => {
      const next = prev.filter((_, i) => i !== index);
      // Removing the lead promotes the next person rather than leaving the client with
      // contacts but no primary, which is what the flat columns mirror from.
      if (next.length > 0 && !next.some(c => c.isPrimary)) next[0] = { ...next[0], isPrimary: true };
      return next;
    });
    setErrors(prev => { const n = { ...prev }; delete n.brokerContacts; return n; });
  };

  const FieldError = ({ field }: { field: string }) =>
    errors[field] ? <p className="text-xs text-[#EF4444] mt-1">{errors[field]}</p> : null;

  const RequiredLabel = ({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) => (
    <Label htmlFor={htmlFor} className="text-sm font-medium text-[#2C3E50]">
      {children} <span className="text-[#EF4444]">*</span>
    </Label>
  );

  const OptionalLabel = ({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) => (
    <Label htmlFor={htmlFor} className="text-sm font-medium text-[#2C3E50]">
      {children}
    </Label>
  );

  const is90dBank = form.bankingType === "NINETY_DEGREE_BANK";

  return (
    <div data-testid="client-form-page">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate("/clients")} data-testid="button-back">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-[#1A5276]">
            {isEdit ? "Edit Client" : "Add New Client"}
          </h1>
          <p className="text-sm text-[#94A3B8]">
            Only Client ID, Client Name, and Plan Type are required. All other fields can be filled in later.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
        {/* ── Client Information ─────────────────────────────────────── */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-6">
            <h2 className="text-lg font-semibold text-[#1A5276]">Client Information</h2>
          </CardHeader>
          <CardContent className="px-6 pb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <RequiredLabel htmlFor="clientCode">Client ID</RequiredLabel>
              <div className="flex items-center gap-1">
                <span className="text-sm font-semibold text-[#1A5276] bg-[#F0F4F8] px-3 py-2 rounded-l-md border border-r-0 border-input">S-</span>
                <Input
                  id="clientCode"
                  value={form.clientCode}
                  onChange={e => updateField("clientCode", e.target.value.replace(/\D/g, ""))}
                  placeholder="e.g. 20, 111, 455"
                  maxLength={8}
                  className="rounded-l-none"
                  data-testid="input-client-code"
                />
              </div>
              <p className="text-xs text-[#94A3B8] mt-1">Digits only — enter what 90 Degree assigned (e.g. 20 → S-20, 111 → S-111)</p>
              <FieldError field="clientCode" />
            </div>
            <div>
              <RequiredLabel htmlFor="clientName">Client Name</RequiredLabel>
              <Input id="clientName" value={form.clientName} onChange={e => updateField("clientName", e.target.value)} data-testid="input-client-name" />
              <FieldError field="clientName" />
            </div>
            <div className="md:col-span-2">
              <OptionalLabel htmlFor="streetAddress">Street Address</OptionalLabel>
              <Input id="streetAddress" value={form.streetAddress} onChange={e => updateField("streetAddress", e.target.value)} data-testid="input-street-address" />
            </div>
            <div>
              <OptionalLabel htmlFor="suiteUnit">Suite/Unit</OptionalLabel>
              <Input id="suiteUnit" value={form.suiteUnit} onChange={e => updateField("suiteUnit", e.target.value)} data-testid="input-suite" />
            </div>
            <div>
              <OptionalLabel htmlFor="city">City</OptionalLabel>
              <Input id="city" value={form.city} onChange={e => updateField("city", e.target.value)} data-testid="input-city" />
            </div>
            <div>
              <OptionalLabel htmlFor="state">State</OptionalLabel>
              <Select value={form.state} onValueChange={v => updateField("state", v)}>
                <SelectTrigger data-testid="select-state"><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent>
                  {US_STATES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <OptionalLabel htmlFor="zipCode">ZIP Code</OptionalLabel>
              <Input id="zipCode" value={form.zipCode} onChange={e => updateField("zipCode", e.target.value)} placeholder="00000" data-testid="input-zip" />
              <FieldError field="zipCode" />
            </div>
            <div>
              <OptionalLabel htmlFor="industryType">Type of Industry</OptionalLabel>
              <Input id="industryType" value={form.industryType} onChange={e => updateField("industryType", e.target.value)} data-testid="input-industry" />
            </div>
            <div>
              <OptionalLabel htmlFor="numberOfEmployees">Number of Employees</OptionalLabel>
              <Input
                id="numberOfEmployees"
                type="number"
                min={0}
                value={form.numberOfEmployees}
                onChange={e => updateField("numberOfEmployees", e.target.value)}
                placeholder="e.g. 250"
                data-testid="input-employees"
              />
            </div>
            <div>
              <OptionalLabel htmlFor="anniversaryDate">Anniversary Date</OptionalLabel>
              <Input
                id="anniversaryDate"
                type="date"
                value={form.anniversaryDate}
                onChange={e => updateField("anniversaryDate", e.target.value)}
                data-testid="input-anniversary-date"
              />
              <p className="text-xs text-[#94A3B8] mt-1">Plan anniversary — drives renewal timing</p>
            </div>
            <div>
              <Label htmlFor="renewalLeadMonths" className="text-sm font-medium text-[#2C3E50]">Renewal Lead Time</Label>
              <Select value={String(form.renewalLeadMonths)} onValueChange={v => updateField("renewalLeadMonths", Number(v))}>
                <SelectTrigger id="renewalLeadMonths" data-testid="select-renewal-lead-months">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[3, 4, 5, 6, 7].map(n => (
                    <SelectItem key={n} value={String(n)}>{n} months before anniversary</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-[#94A3B8] mt-1">How far in advance to prepare the renewal proposal</p>
            </div>
          </CardContent>
        </Card>

        {/* Renewal pipeline step and cycle dates are edited on the client detail
            page, against the specific plan year's renewal record. They are not
            client-level fields — each year keeps its own. */}

        {/* ── Plan Type ──────────────────────────────────────────────── */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-6">
            <h2 className="text-lg font-semibold text-[#1A5276]">Plan Type <span className="text-[#EF4444]">*</span></h2>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <Select value={form.planType} onValueChange={v => updateField("planType", v)}>
              <SelectTrigger data-testid="select-plan-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {planTypeOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* ── Network ────────────────────────────────────────────────── */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-6">
            <h2 className="text-lg font-semibold text-[#1A5276]">Network</h2>
          </CardHeader>
          <CardContent className="px-6 pb-6 space-y-4">
            <div className="flex items-center gap-3">
              <Switch checked={form.networkActive} onCheckedChange={v => updateField("networkActive", v)} data-testid="switch-network" />
              <Label className="text-sm text-[#2C3E50]">Network Active</Label>
            </div>
            {form.networkActive && (
              <div>
                <OptionalLabel htmlFor="dentalNetworkName">Dental Network Name</OptionalLabel>
                <Input id="dentalNetworkName" value={form.dentalNetworkName} onChange={e => updateField("dentalNetworkName", e.target.value)} data-testid="input-network-name" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Decision Maker ─────────────────────────────────────────── */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-6">
            <h2 className="text-lg font-semibold text-[#1A5276]">Decision Maker (Primary Contact)</h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">All fields optional — enter whatever you have</p>
          </CardHeader>
          <CardContent className="px-6 pb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <OptionalLabel htmlFor="dmName">Full Name</OptionalLabel>
              <Input id="dmName" value={form.decisionMakerName} onChange={e => updateField("decisionMakerName", e.target.value)} data-testid="input-dm-name" />
            </div>
            <div>
              <OptionalLabel htmlFor="dmTitle">Title</OptionalLabel>
              <Input id="dmTitle" value={form.decisionMakerTitle} onChange={e => updateField("decisionMakerTitle", e.target.value)} data-testid="input-dm-title" />
            </div>
            <div>
              <OptionalLabel htmlFor="dmPhone">Phone</OptionalLabel>
              <Input id="dmPhone" value={form.decisionMakerPhone} onChange={e => updateField("decisionMakerPhone", e.target.value)} onBlur={e => updateField("decisionMakerPhone", formatPhone(e.target.value))} placeholder="(XXX) XXX-XXXX" data-testid="input-dm-phone" />
            </div>
            <div>
              <OptionalLabel htmlFor="dmEmail">Email</OptionalLabel>
              <Input id="dmEmail" type="email" value={form.decisionMakerEmail} onChange={e => updateField("decisionMakerEmail", e.target.value)} data-testid="input-dm-email" />
              <FieldError field="decisionMakerEmail" />
            </div>
          </CardContent>
        </Card>

        {/* ── Admin Contact ──────────────────────────────────────────── */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[#1A5276]">Administrative Support Contact</h2>
                <p className="text-xs text-[#94A3B8] mt-0.5">All fields optional — enter whatever you have</p>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="sameAsPrimary"
                  checked={sameAsPrimary}
                  onCheckedChange={(checked) => {
                    const val = !!checked;
                    setSameAsPrimary(val);
                    if (!val) {
                      setForm(prev => ({
                        ...prev,
                        adminContactName: "",
                        adminContactTitle: "",
                        adminContactPhone: "",
                        adminContactEmail: "",
                      }));
                    }
                  }}
                  data-testid="checkbox-same-as-primary"
                />
                <Label htmlFor="sameAsPrimary" className="text-sm text-[#2C3E50] cursor-pointer">Same as Primary</Label>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <OptionalLabel htmlFor="acName">Full Name</OptionalLabel>
              <Input id="acName" value={form.adminContactName} onChange={e => updateField("adminContactName", e.target.value)} disabled={sameAsPrimary} className={sameAsPrimary ? "bg-[#F0F4F8]" : ""} data-testid="input-ac-name" />
            </div>
            <div>
              <OptionalLabel htmlFor="acTitle">Title</OptionalLabel>
              <Input id="acTitle" value={form.adminContactTitle} onChange={e => updateField("adminContactTitle", e.target.value)} disabled={sameAsPrimary} className={sameAsPrimary ? "bg-[#F0F4F8]" : ""} data-testid="input-ac-title" />
            </div>
            <div>
              <OptionalLabel htmlFor="acPhone">Phone</OptionalLabel>
              <Input id="acPhone" value={form.adminContactPhone} onChange={e => updateField("adminContactPhone", e.target.value)} onBlur={e => updateField("adminContactPhone", formatPhone(e.target.value))} placeholder="(XXX) XXX-XXXX" disabled={sameAsPrimary} className={sameAsPrimary ? "bg-[#F0F4F8]" : ""} data-testid="input-ac-phone" />
            </div>
            <div>
              <OptionalLabel htmlFor="acEmail">Email</OptionalLabel>
              <Input id="acEmail" type="email" value={form.adminContactEmail} onChange={e => updateField("adminContactEmail", e.target.value)} disabled={sameAsPrimary} className={sameAsPrimary ? "bg-[#F0F4F8]" : ""} data-testid="input-ac-email" />
              <FieldError field="adminContactEmail" />
            </div>
          </CardContent>
        </Card>

        {/* ── Broker ─────────────────────────────────────────────────── */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-6">
            <h2 className="text-lg font-semibold text-[#1A5276]">Broker</h2>
          </CardHeader>
          <CardContent className="px-6 pb-6 space-y-4">
            <div className="flex items-center gap-3">
              <Switch checked={form.hasBroker} onCheckedChange={v => updateField("hasBroker", v)} data-testid="switch-broker" />
              <Label className="text-sm text-[#2C3E50]">Has Broker</Label>
            </div>
            {form.hasBroker && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <OptionalLabel htmlFor="brokerFirmName">Broker Firm Name</OptionalLabel>
                    <Input id="brokerFirmName" value={form.brokerFirmName} onChange={e => updateField("brokerFirmName", e.target.value)} data-testid="input-broker-firm" />
                  </div>
                </div>

                <div className="pt-1">
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-sm font-medium text-[#2C3E50]">Broker Contacts</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => setBrokerContacts(prev => [...prev, emptyBrokerContact(prev.length === 0)])}
                      data-testid="button-add-broker-contact"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Contact
                    </Button>
                  </div>
                  <p className="text-xs text-[#94A3B8] mb-3">
                    The brokerage usually names a lead plus a service representative. Mark the lead as
                    primary — that is the one shown wherever a single broker contact is displayed.
                  </p>

                  {brokerContacts.length === 0 && (
                    <p className="text-xs text-[#94A3B8] italic py-2" data-testid="text-no-broker-contacts">
                      No contacts recorded yet.
                    </p>
                  )}

                  <div className="space-y-3">
                    {brokerContacts.map((c, i) => (
                      <div
                        key={i}
                        className="rounded-md border border-[#E2E8F0] p-3 space-y-3"
                        data-testid={`row-broker-contact-${i}`}
                      >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <OptionalLabel htmlFor={`bc-name-${i}`}>Name</OptionalLabel>
                            <Input
                              id={`bc-name-${i}`}
                              value={c.contactName}
                              onChange={e => updateBrokerContact(i, { contactName: e.target.value })}
                              data-testid={`input-broker-contact-name-${i}`}
                            />
                            <FieldError field={`brokerContact-${i}-name`} />
                          </div>
                          <div>
                            <OptionalLabel htmlFor={`bc-role-${i}`}>Role</OptionalLabel>
                            <Input
                              id={`bc-role-${i}`}
                              list="broker-role-suggestions"
                              value={c.role}
                              onChange={e => updateBrokerContact(i, { role: e.target.value })}
                              placeholder="Account Advisor, Service Representative…"
                              data-testid={`input-broker-contact-role-${i}`}
                            />
                          </div>
                          <div>
                            <OptionalLabel htmlFor={`bc-email-${i}`}>Email</OptionalLabel>
                            <Input
                              id={`bc-email-${i}`}
                              type="email"
                              value={c.email}
                              onChange={e => updateBrokerContact(i, { email: e.target.value })}
                              data-testid={`input-broker-contact-email-${i}`}
                            />
                            <FieldError field={`brokerContact-${i}-email`} />
                          </div>
                          <div>
                            <OptionalLabel htmlFor={`bc-phone-${i}`}>Phone</OptionalLabel>
                            <Input
                              id={`bc-phone-${i}`}
                              value={c.phone}
                              onChange={e => updateBrokerContact(i, { phone: e.target.value })}
                              onBlur={e => updateBrokerContact(i, { phone: formatPhone(e.target.value) })}
                              placeholder="(XXX) XXX-XXXX"
                              data-testid={`input-broker-contact-phone-${i}`}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <label className="flex items-center gap-2 text-xs text-[#2C3E50] cursor-pointer">
                            <Checkbox
                              checked={c.isPrimary}
                              onCheckedChange={() => setPrimaryBrokerContact(i)}
                              data-testid={`checkbox-broker-contact-primary-${i}`}
                            />
                            Primary contact
                          </label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-xs text-[#EF4444] hover:text-[#EF4444] gap-1.5"
                            onClick={() => removeBrokerContact(i)}
                            data-testid={`button-remove-broker-contact-${i}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <datalist id="broker-role-suggestions">
                    {BROKER_ROLE_SUGGESTIONS.map(r => <option key={r} value={r} />)}
                  </datalist>
                  <FieldError field="brokerContacts" />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Banking, Funding & COBRA ───────────────────────────────── */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-6">
            <h2 className="text-lg font-semibold text-[#1A5276]">Banking, Funding & COBRA</h2>
          </CardHeader>
          <CardContent className="px-6 pb-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <OptionalLabel htmlFor="bankingType">Who holds the bank account?</OptionalLabel>
                <Select value={form.bankingType} onValueChange={v => updateField("bankingType", v)}>
                  <SelectTrigger data-testid="select-banking"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CLIENT_BANK">Employer / Client Bank Account</SelectItem>
                    <SelectItem value="NINETY_DEGREE_BANK">90 Degree Benefits Bank Account</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <OptionalLabel htmlFor="fundingType">Funding Approval</OptionalLabel>
                <Select value={form.fundingType} onValueChange={v => updateField("fundingType", v)}>
                  <SelectTrigger data-testid="select-funding"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="REQUIRES_APPROVAL">Client Requires Approval</SelectItem>
                    <SelectItem value="PROCESS_WITHOUT_APPROVAL">Process Without Approval</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Account balance — only when 90 Degree holds the funds */}
            {is90dBank && (
              <div className="border-t pt-4">
                <p className="text-sm font-medium text-[#2C3E50] mb-3">Account Balance</p>
                <p className="text-xs text-[#94A3B8] mb-3">
                  This is the actual bank account balance supplied by 90 Degree monthly. It is separate
                  from the plan surplus or deficit — the account holds more than just claims funds, and
                  admin fees are drawn from it, so the two numbers will legitimately differ. Leave blank
                  between updates.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <OptionalLabel htmlFor="accountBalance">Account Balance ($)</OptionalLabel>
                    <Input
                      id="accountBalance"
                      type="number"
                      step="0.01"
                      value={form.accountBalance}
                      onChange={e => updateField("accountBalance", e.target.value)}
                      placeholder="e.g. 12500.00"
                      data-testid="input-account-balance"
                    />
                  </div>
                  <div>
                    <OptionalLabel htmlFor="accountBalanceAsOfDate">Balance As-Of Date</OptionalLabel>
                    <Input
                      id="accountBalanceAsOfDate"
                      type="date"
                      value={form.accountBalanceAsOfDate}
                      onChange={e => updateField("accountBalanceAsOfDate", e.target.value)}
                      data-testid="input-balance-as-of-date"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* COBRA */}
            <div className="border-t pt-4">
              <p className="text-sm font-medium text-[#2C3E50] mb-3">COBRA Administration</p>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="cobraAdministeredBy90d"
                    checked={form.cobraAdministeredBy90d}
                    onCheckedChange={v => updateField("cobraAdministeredBy90d", !!v)}
                    data-testid="checkbox-cobra"
                  />
                  <Label htmlFor="cobraAdministeredBy90d" className="text-sm text-[#2C3E50] cursor-pointer">
                    90 Degree Benefits administers COBRA for this client
                  </Label>
                </div>
                {form.cobraAdministeredBy90d && (
                  <div className="max-w-xs">
                    <OptionalLabel htmlFor="cobraFee">COBRA Admin Fee ($/month)</OptionalLabel>
                    <Input
                      id="cobraFee"
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.cobraFee}
                      onChange={e => updateField("cobraFee", e.target.value)}
                      placeholder="1.00"
                      data-testid="input-cobra-fee"
                    />
                    <p className="text-xs text-[#94A3B8] mt-1">Standard rate is $1.00/month. Edit only if this client differs.</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Account Status ─────────────────────────────────────────── */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-6">
            <h2 className="text-lg font-semibold text-[#1A5276]">Account Status</h2>
          </CardHeader>
          <CardContent className="px-6 pb-6 space-y-4">
            <div>
              <OptionalLabel htmlFor="clientStatus">Status</OptionalLabel>
              <Select
                value={form.clientStatus}
                onValueChange={v => {
                  updateField("clientStatus", v);
                  if (v !== "TERMINATED") updateField("terminationDate", "");
                }}
              >
                <SelectTrigger id="clientStatus" data-testid="select-client-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active — current client</SelectItem>
                  <SelectItem value="PROSPECT">Prospect — quoting, not yet signed</SelectItem>
                  <SelectItem value="TERMINATED">Terminated — no longer active</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-[#94A3B8] mt-1">
                {form.clientStatus === "PROSPECT"
                  ? "Prospect clients are being quoted but have not yet signed."
                  : form.clientStatus === "TERMINATED"
                    ? "Terminated clients are retained for historical reference."
                    : "Active clients are currently covered under a plan."}
              </p>
            </div>
            {form.clientStatus === "TERMINATED" && (
              <div>
                <OptionalLabel htmlFor="terminationDate">Termination Date</OptionalLabel>
                <Input
                  id="terminationDate"
                  type="date"
                  value={form.terminationDate}
                  onChange={e => updateField("terminationDate", e.target.value)}
                  data-testid="input-termination-date"
                />
                <p className="text-xs text-[#94A3B8] mt-1">Must be the last day of a calendar month</p>
                <FieldError field="terminationDate" />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center gap-3 pb-8">
          <Button
            type="submit"
            disabled={mutation.isPending || codeChecking}
            className="bg-[#1A5276] text-white gap-2"
            data-testid="button-save"
          >
            <Save className="w-4 h-4" />
            {mutation.isPending || codeChecking ? "Saving..." : "Save Client"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate("/clients")} data-testid="button-cancel">
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
