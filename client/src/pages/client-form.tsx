import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { US_STATES, formatPhone } from "@/lib/constants";
import { ArrowLeft, Save } from "lucide-react";

const planTypeOptions = [
  { value: "DENTAL", label: "Dental" },
  { value: "VISION", label: "Vision" },
  { value: "HEARING", label: "Hearing" },
  { value: "DENTAL_VISION", label: "Dental / Vision" },
  { value: "HEARING_VISION", label: "Hearing / Vision" },
  { value: "DENTAL_HEARING_VISION", label: "Dental / Hearing / Vision" },
];

function isLastDayOfMonth(date: Date): boolean {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next.getDate() === 1;
}

export default function ClientFormPage() {
  const params = useParams<{ id?: string }>();
  const isEdit = !!params.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: existingClient } = useQuery<any>({
    queryKey: ["/api/clients", params.id],
    enabled: isEdit,
  });

  const [form, setForm] = useState({
    clientName: "", streetAddress: "", suiteUnit: "", city: "", state: "", zipCode: "",
    industryType: "", numberOfEmployees: 1, isActive: true, terminationDate: "",
    planType: "DENTAL", networkActive: false, dentalNetworkName: "Dentemax",
    decisionMakerName: "", decisionMakerTitle: "", decisionMakerPhone: "", decisionMakerEmail: "",
    adminContactName: "", adminContactTitle: "Admin Contact", adminContactPhone: "", adminContactEmail: "",
    hasBroker: false, brokerFirmName: "", brokerContactName: "", brokerPhone: "", brokerEmail: "",
    bankingType: "CLIENT_BANK", fundingType: "REQUIRES_APPROVAL",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (existingClient && isEdit) {
      setForm({
        clientName: existingClient.clientName || "",
        streetAddress: existingClient.streetAddress || "",
        suiteUnit: existingClient.suiteUnit || "",
        city: existingClient.city || "",
        state: existingClient.state || "",
        zipCode: existingClient.zipCode || "",
        industryType: existingClient.industryType || "",
        numberOfEmployees: existingClient.numberOfEmployees || 1,
        isActive: existingClient.isActive ?? true,
        terminationDate: existingClient.terminationDate ? existingClient.terminationDate.split("T")[0] : "",
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
        bankingType: existingClient.bankingType || "CLIENT_BANK",
        fundingType: existingClient.fundingType || "REQUIRES_APPROVAL",
      });
    }
  }, [existingClient, isEdit]);

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      if (isEdit) {
        const res = await apiRequest("PUT", `/api/clients/${params.id}`, data);
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/clients", data);
        return res.json();
      }
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
    if (!form.clientName.trim()) errs.clientName = "Client name is required";
    if (!form.streetAddress.trim()) errs.streetAddress = "Street address is required";
    if (!form.city.trim()) errs.city = "City is required";
    if (!form.state) errs.state = "State is required";
    if (!form.zipCode.trim()) errs.zipCode = "ZIP code is required";
    else if (!/^\d{5}(-\d{4})?$/.test(form.zipCode)) errs.zipCode = "Invalid ZIP format (00000 or 00000-0000)";
    if (!form.industryType.trim()) errs.industryType = "Industry type is required";
    if (form.numberOfEmployees < 1) errs.numberOfEmployees = "Must have at least 1 employee";
    if (!form.decisionMakerName.trim()) errs.decisionMakerName = "Name is required";
    if (!form.decisionMakerTitle.trim()) errs.decisionMakerTitle = "Title is required";
    if (!form.decisionMakerPhone.trim()) errs.decisionMakerPhone = "Phone is required";
    if (!form.decisionMakerEmail.trim()) errs.decisionMakerEmail = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.decisionMakerEmail)) errs.decisionMakerEmail = "Invalid email";
    if (!form.adminContactName.trim()) errs.adminContactName = "Name is required";
    if (!form.adminContactTitle.trim()) errs.adminContactTitle = "Title is required";
    if (!form.adminContactPhone.trim()) errs.adminContactPhone = "Phone is required";
    if (!form.adminContactEmail.trim()) errs.adminContactEmail = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminContactEmail)) errs.adminContactEmail = "Invalid email";
    if (form.hasBroker) {
      if (!form.brokerFirmName.trim()) errs.brokerFirmName = "Broker firm name is required";
      if (!form.brokerContactName.trim()) errs.brokerContactName = "Broker contact name is required";
      if (!form.brokerPhone.trim()) errs.brokerPhone = "Broker phone is required";
      if (!form.brokerEmail.trim()) errs.brokerEmail = "Broker email is required";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.brokerEmail)) errs.brokerEmail = "Invalid email";
    }
    if (!form.isActive && form.terminationDate) {
      const d = new Date(form.terminationDate + "T00:00:00");
      if (!isLastDayOfMonth(d)) errs.terminationDate = "Termination date must be the last day of a calendar month";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    const data: any = { ...form, numberOfEmployees: Number(form.numberOfEmployees) };
    if (!data.isActive && data.terminationDate) {
      data.terminationDate = new Date(data.terminationDate + "T00:00:00");
    } else {
      data.terminationDate = null;
    }
    if (!data.networkActive) data.dentalNetworkName = null;
    if (!data.hasBroker) {
      data.brokerFirmName = null;
      data.brokerContactName = null;
      data.brokerPhone = null;
      data.brokerEmail = null;
    }
    mutation.mutate(data);
  };

  const updateField = (field: string, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  };

  const FieldError = ({ field }: { field: string }) =>
    errors[field] ? <p className="text-xs text-[#EF4444] mt-1">{errors[field]}</p> : null;

  const RequiredLabel = ({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) => (
    <Label htmlFor={htmlFor} className="text-sm font-medium text-[#2C3E50]">
      {children} <span className="text-[#EF4444]">*</span>
    </Label>
  );

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
          <p className="text-sm text-[#94A3B8]">{isEdit ? "Update client information" : "Create a new client account"}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-6">
            <h2 className="text-lg font-semibold text-[#1A5276]">Client Information</h2>
          </CardHeader>
          <CardContent className="px-6 pb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <RequiredLabel htmlFor="clientName">Client Name</RequiredLabel>
              <Input id="clientName" value={form.clientName} onChange={e => updateField("clientName", e.target.value)} data-testid="input-client-name" />
              <FieldError field="clientName" />
            </div>
            <div className="md:col-span-2">
              <RequiredLabel htmlFor="streetAddress">Street Address</RequiredLabel>
              <Input id="streetAddress" value={form.streetAddress} onChange={e => updateField("streetAddress", e.target.value)} data-testid="input-street-address" />
              <FieldError field="streetAddress" />
            </div>
            <div>
              <Label htmlFor="suiteUnit" className="text-sm font-medium text-[#2C3E50]">Suite/Unit</Label>
              <Input id="suiteUnit" value={form.suiteUnit} onChange={e => updateField("suiteUnit", e.target.value)} data-testid="input-suite" />
            </div>
            <div>
              <RequiredLabel htmlFor="city">City</RequiredLabel>
              <Input id="city" value={form.city} onChange={e => updateField("city", e.target.value)} data-testid="input-city" />
              <FieldError field="city" />
            </div>
            <div>
              <RequiredLabel htmlFor="state">State</RequiredLabel>
              <Select value={form.state} onValueChange={v => updateField("state", v)}>
                <SelectTrigger data-testid="select-state"><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent>
                  {US_STATES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <FieldError field="state" />
            </div>
            <div>
              <RequiredLabel htmlFor="zipCode">ZIP Code</RequiredLabel>
              <Input id="zipCode" value={form.zipCode} onChange={e => updateField("zipCode", e.target.value)} placeholder="00000" data-testid="input-zip" />
              <FieldError field="zipCode" />
            </div>
            <div>
              <RequiredLabel htmlFor="industryType">Type of Industry</RequiredLabel>
              <Input id="industryType" value={form.industryType} onChange={e => updateField("industryType", e.target.value)} data-testid="input-industry" />
              <FieldError field="industryType" />
            </div>
            <div>
              <RequiredLabel htmlFor="numberOfEmployees">Number of Employees</RequiredLabel>
              <Input id="numberOfEmployees" type="number" min={1} value={form.numberOfEmployees} onChange={e => updateField("numberOfEmployees", e.target.value)} data-testid="input-employees" />
              <FieldError field="numberOfEmployees" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-6">
            <h2 className="text-lg font-semibold text-[#1A5276]">Plan Type</h2>
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
                <Label htmlFor="dentalNetworkName" className="text-sm font-medium text-[#2C3E50]">Dental Network Name</Label>
                <Input id="dentalNetworkName" value={form.dentalNetworkName} onChange={e => updateField("dentalNetworkName", e.target.value)} data-testid="input-network-name" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-6">
            <h2 className="text-lg font-semibold text-[#1A5276]">Decision Maker (Primary Contact)</h2>
          </CardHeader>
          <CardContent className="px-6 pb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <RequiredLabel htmlFor="dmName">Full Name</RequiredLabel>
              <Input id="dmName" value={form.decisionMakerName} onChange={e => updateField("decisionMakerName", e.target.value)} data-testid="input-dm-name" />
              <FieldError field="decisionMakerName" />
            </div>
            <div>
              <RequiredLabel htmlFor="dmTitle">Title</RequiredLabel>
              <Input id="dmTitle" value={form.decisionMakerTitle} onChange={e => updateField("decisionMakerTitle", e.target.value)} data-testid="input-dm-title" />
              <FieldError field="decisionMakerTitle" />
            </div>
            <div>
              <RequiredLabel htmlFor="dmPhone">Phone</RequiredLabel>
              <Input id="dmPhone" value={form.decisionMakerPhone} onChange={e => updateField("decisionMakerPhone", e.target.value)} onBlur={e => updateField("decisionMakerPhone", formatPhone(e.target.value))} placeholder="(XXX) XXX-XXXX" data-testid="input-dm-phone" />
              <FieldError field="decisionMakerPhone" />
            </div>
            <div>
              <RequiredLabel htmlFor="dmEmail">Email</RequiredLabel>
              <Input id="dmEmail" type="email" value={form.decisionMakerEmail} onChange={e => updateField("decisionMakerEmail", e.target.value)} data-testid="input-dm-email" />
              <FieldError field="decisionMakerEmail" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-6">
            <h2 className="text-lg font-semibold text-[#1A5276]">Administrative Support Contact</h2>
          </CardHeader>
          <CardContent className="px-6 pb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <RequiredLabel htmlFor="acName">Full Name</RequiredLabel>
              <Input id="acName" value={form.adminContactName} onChange={e => updateField("adminContactName", e.target.value)} data-testid="input-ac-name" />
              <FieldError field="adminContactName" />
            </div>
            <div>
              <RequiredLabel htmlFor="acTitle">Title</RequiredLabel>
              <Input id="acTitle" value={form.adminContactTitle} onChange={e => updateField("adminContactTitle", e.target.value)} data-testid="input-ac-title" />
              <FieldError field="adminContactTitle" />
            </div>
            <div>
              <RequiredLabel htmlFor="acPhone">Phone</RequiredLabel>
              <Input id="acPhone" value={form.adminContactPhone} onChange={e => updateField("adminContactPhone", e.target.value)} onBlur={e => updateField("adminContactPhone", formatPhone(e.target.value))} placeholder="(XXX) XXX-XXXX" data-testid="input-ac-phone" />
              <FieldError field="adminContactPhone" />
            </div>
            <div>
              <RequiredLabel htmlFor="acEmail">Email</RequiredLabel>
              <Input id="acEmail" type="email" value={form.adminContactEmail} onChange={e => updateField("adminContactEmail", e.target.value)} data-testid="input-ac-email" />
              <FieldError field="adminContactEmail" />
            </div>
          </CardContent>
        </Card>

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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div>
                  <RequiredLabel htmlFor="brokerFirmName">Broker Firm Name</RequiredLabel>
                  <Input id="brokerFirmName" value={form.brokerFirmName} onChange={e => updateField("brokerFirmName", e.target.value)} data-testid="input-broker-firm" />
                  <FieldError field="brokerFirmName" />
                </div>
                <div>
                  <RequiredLabel htmlFor="brokerContactName">Broker Contact Name</RequiredLabel>
                  <Input id="brokerContactName" value={form.brokerContactName} onChange={e => updateField("brokerContactName", e.target.value)} data-testid="input-broker-contact" />
                  <FieldError field="brokerContactName" />
                </div>
                <div>
                  <RequiredLabel htmlFor="brokerPhone">Phone</RequiredLabel>
                  <Input id="brokerPhone" value={form.brokerPhone} onChange={e => updateField("brokerPhone", e.target.value)} onBlur={e => updateField("brokerPhone", formatPhone(e.target.value))} placeholder="(XXX) XXX-XXXX" data-testid="input-broker-phone" />
                  <FieldError field="brokerPhone" />
                </div>
                <div>
                  <RequiredLabel htmlFor="brokerEmail">Email</RequiredLabel>
                  <Input id="brokerEmail" type="email" value={form.brokerEmail} onChange={e => updateField("brokerEmail", e.target.value)} data-testid="input-broker-email" />
                  <FieldError field="brokerEmail" />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-6">
            <h2 className="text-lg font-semibold text-[#1A5276]">Banking & Funding</h2>
          </CardHeader>
          <CardContent className="px-6 pb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <RequiredLabel htmlFor="bankingType">Banking</RequiredLabel>
              <Select value={form.bankingType} onValueChange={v => updateField("bankingType", v)}>
                <SelectTrigger data-testid="select-banking"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CLIENT_BANK">Client Bank Account</SelectItem>
                  <SelectItem value="NINETY_DEGREE_BANK">90 Degree Bank Account</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <RequiredLabel htmlFor="fundingType">Funding</RequiredLabel>
              <Select value={form.fundingType} onValueChange={v => updateField("fundingType", v)}>
                <SelectTrigger data-testid="select-funding"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="REQUIRES_APPROVAL">Client Requires Approval</SelectItem>
                  <SelectItem value="PROCESS_WITHOUT_APPROVAL">Process Without Approval</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-6">
            <h2 className="text-lg font-semibold text-[#1A5276]">Account Status</h2>
          </CardHeader>
          <CardContent className="px-6 pb-6 space-y-4">
            <div className="flex items-center gap-3">
              <Switch checked={form.isActive} onCheckedChange={v => { updateField("isActive", v); if (v) updateField("terminationDate", ""); }} data-testid="switch-status" />
              <Label className="text-sm text-[#2C3E50]">{form.isActive ? "Active" : "Terminated"}</Label>
            </div>
            {!form.isActive && (
              <div>
                <RequiredLabel htmlFor="terminationDate">Termination Date</RequiredLabel>
                <Input id="terminationDate" type="date" value={form.terminationDate} onChange={e => updateField("terminationDate", e.target.value)} data-testid="input-termination-date" />
                <p className="text-xs text-[#94A3B8] mt-1">Must be the last day of a calendar month</p>
                <FieldError field="terminationDate" />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center gap-3 pb-8">
          <Button type="submit" disabled={mutation.isPending} className="bg-[#1A5276] text-white gap-2" data-testid="button-save">
            <Save className="w-4 h-4" /> {mutation.isPending ? "Saving..." : "Save Client"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate("/clients")} data-testid="button-cancel">
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
