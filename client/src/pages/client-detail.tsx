import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Edit, Mail, Phone, Building2, Landmark, CreditCard } from "lucide-react";
import { PLAN_TYPE_LABELS, BANKING_TYPE_LABELS, FUNDING_TYPE_LABELS } from "@/lib/constants";
import PlansTab from "@/components/tabs/plans-tab";
import DocumentsTab from "@/components/tabs/documents-tab";
import IssuesTab from "@/components/tabs/issues-tab";
import PprTab from "@/components/tabs/ppr-tab";

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const clientId = parseInt(params.id!);
  const [activeTab, setActiveTab] = useState("profile");

  const { data: client, isLoading } = useQuery<any>({
    queryKey: ["/api/clients", params.id],
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!client) {
    return <div className="text-center py-16"><p className="text-[#94A3B8]">Client not found</p></div>;
  }

  return (
    <div data-testid="client-detail-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Link href="/clients">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            {client.activeIssueCount > 0 && <div className="pulse-dot flex-shrink-0" />}
            <div>
              <h1 className="text-2xl font-bold text-[#1A5276]" data-testid="text-client-name">{client.clientName}</h1>
              <p className="text-sm text-[#94A3B8]">{client.city}, {client.state}</p>
            </div>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ml-2 ${
            client.isActive ? "bg-[#22C55E]/10 text-[#22C55E]" : "bg-[#EF4444]/10 text-[#EF4444]"
          }`} data-testid="badge-client-status">
            {client.isActive ? "Active" : "Terminated"}
          </span>
        </div>
        <Link href={`/clients/${clientId}/edit`}>
          <Button className="bg-[#1A5276] text-white gap-2" data-testid="button-edit-client">
            <Edit className="w-4 h-4" /> Edit Client
          </Button>
        </Link>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-white border mb-6 h-auto flex-wrap">
          <TabsTrigger value="profile" data-testid="tab-profile" className="data-[state=active]:bg-[#1A5276] data-[state=active]:text-white">Profile</TabsTrigger>
          <TabsTrigger value="plans" data-testid="tab-plans" className="data-[state=active]:bg-[#1A5276] data-[state=active]:text-white">Plans & Rates</TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-documents" className="data-[state=active]:bg-[#1A5276] data-[state=active]:text-white">Documents</TabsTrigger>
          <TabsTrigger value="issues" data-testid="tab-issues" className="data-[state=active]:bg-[#1A5276] data-[state=active]:text-white">
            Issues {client.activeIssueCount > 0 && `(${client.activeIssueCount})`}
          </TabsTrigger>
          <TabsTrigger value="ppr" data-testid="tab-ppr" className="data-[state=active]:bg-[#1A5276] data-[state=active]:text-white">PPR</TabsTrigger>
          <TabsTrigger value="banking" data-testid="tab-banking" className="data-[state=active]:bg-[#1A5276] data-[state=active]:text-white">Banking</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3 pt-5 px-6">
                <h2 className="text-lg font-semibold text-[#1A5276]">Client Information</h2>
              </CardHeader>
              <CardContent className="px-6 pb-6 space-y-3">
                <InfoRow label="Address" value={`${client.streetAddress}${client.suiteUnit ? `, ${client.suiteUnit}` : ""}, ${client.city}, ${client.state} ${client.zipCode}`} />
                <InfoRow label="Industry" value={client.industryType} />
                <InfoRow label="Employees" value={client.numberOfEmployees} />
                <InfoRow label="Plan Type">
                  <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-[#2E86C1]/10 text-[#2E86C1]">
                    {PLAN_TYPE_LABELS[client.planType]}
                  </span>
                </InfoRow>
                {client.networkActive && <InfoRow label="Network" value={client.dentalNetworkName || "Active"} />}
                {client.terminationDate && <InfoRow label="Termination Date" value={new Date(client.terminationDate).toLocaleDateString()} />}
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3 pt-5 px-6">
                <h2 className="text-lg font-semibold text-[#1A5276]">Contacts</h2>
              </CardHeader>
              <CardContent className="px-6 pb-6 space-y-5">
                <div>
                  <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-2">Decision Maker</p>
                  <p className="text-sm font-medium text-[#2C3E50]">{client.decisionMakerName}</p>
                  <p className="text-xs text-[#94A3B8]">{client.decisionMakerTitle}</p>
                  <div className="flex flex-wrap gap-3 mt-1.5">
                    <a href={`tel:${client.decisionMakerPhone}`} className="flex items-center gap-1 text-xs text-[#2E86C1]">
                      <Phone className="w-3 h-3" /> {client.decisionMakerPhone}
                    </a>
                    <a href={`mailto:${client.decisionMakerEmail}`} className="flex items-center gap-1 text-xs text-[#2E86C1]">
                      <Mail className="w-3 h-3" /> {client.decisionMakerEmail}
                    </a>
                  </div>
                </div>
                <div className="border-t pt-4">
                  <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wider mb-2">Admin Contact</p>
                  <p className="text-sm font-medium text-[#2C3E50]">{client.adminContactName}</p>
                  <p className="text-xs text-[#94A3B8]">{client.adminContactTitle}</p>
                  <div className="flex flex-wrap gap-3 mt-1.5">
                    <a href={`tel:${client.adminContactPhone}`} className="flex items-center gap-1 text-xs text-[#2E86C1]">
                      <Phone className="w-3 h-3" /> {client.adminContactPhone}
                    </a>
                    <a href={`mailto:${client.adminContactEmail}`} className="flex items-center gap-1 text-xs text-[#2E86C1]">
                      <Mail className="w-3 h-3" /> {client.adminContactEmail}
                    </a>
                  </div>
                </div>
              </CardContent>
            </Card>

            {client.hasBroker && (
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-3 pt-5 px-6">
                  <h2 className="text-lg font-semibold text-[#1A5276]">Broker</h2>
                </CardHeader>
                <CardContent className="px-6 pb-6 space-y-2">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-[#94A3B8]" />
                    <p className="text-sm font-medium text-[#2C3E50]">{client.brokerFirmName}</p>
                  </div>
                  <p className="text-sm text-[#2C3E50] pl-6">{client.brokerContactName}</p>
                  <div className="flex flex-wrap gap-3 pl-6">
                    <a href={`tel:${client.brokerPhone}`} className="flex items-center gap-1 text-xs text-[#2E86C1]">
                      <Phone className="w-3 h-3" /> {client.brokerPhone}
                    </a>
                    <a href={`mailto:${client.brokerEmail}`} className="flex items-center gap-1 text-xs text-[#2E86C1]">
                      <Mail className="w-3 h-3" /> {client.brokerEmail}
                    </a>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3 pt-5 px-6">
                <h2 className="text-lg font-semibold text-[#1A5276]">Banking & Funding</h2>
              </CardHeader>
              <CardContent className="px-6 pb-6 space-y-3">
                <div className="flex items-center gap-3">
                  <Landmark className="w-5 h-5 text-[#94A3B8]" />
                  <div>
                    <p className="text-xs text-[#94A3B8]">Banking Type</p>
                    <p className="text-sm font-medium text-[#2C3E50]">{BANKING_TYPE_LABELS[client.bankingType]}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5 text-[#94A3B8]" />
                  <div>
                    <p className="text-xs text-[#94A3B8]">Funding Type</p>
                    <p className="text-sm font-medium text-[#2C3E50]">{FUNDING_TYPE_LABELS[client.fundingType]}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="plans">
          <PlansTab clientId={clientId} client={client} />
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsTab clientId={clientId} />
        </TabsContent>

        <TabsContent value="issues">
          <IssuesTab clientId={clientId} />
        </TabsContent>

        <TabsContent value="ppr">
          <PprTab clientId={clientId} />
        </TabsContent>

        <TabsContent value="banking">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3 pt-5 px-6">
              <h2 className="text-lg font-semibold text-[#1A5276]">Banking & Funding Summary</h2>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex items-center gap-4 p-4 bg-[#F0F4F8] rounded-lg">
                  <Landmark className="w-8 h-8 text-[#1A5276]" />
                  <div>
                    <p className="text-xs text-[#94A3B8]">Banking Type</p>
                    <p className="text-base font-semibold text-[#2C3E50]">{BANKING_TYPE_LABELS[client.bankingType]}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 p-4 bg-[#F0F4F8] rounded-lg">
                  <CreditCard className="w-8 h-8 text-[#1A5276]" />
                  <div>
                    <p className="text-xs text-[#94A3B8]">Funding Type</p>
                    <p className="text-base font-semibold text-[#2C3E50]">{FUNDING_TYPE_LABELS[client.fundingType]}</p>
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <Link href={`/clients/${clientId}/edit`}>
                  <Button variant="outline" size="sm" className="text-[#2E86C1] border-[#2E86C1]" data-testid="button-edit-banking">
                    Edit Banking Settings
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoRow({ label, value, children }: { label: string; value?: any; children?: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-sm text-[#94A3B8] flex-shrink-0">{label}</span>
      {children || <span className="text-sm text-[#2C3E50] text-right">{value}</span>}
    </div>
  );
}
