import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, Users, Building2, MapPin } from "lucide-react";
import { PLAN_TYPE_LABELS } from "@/lib/constants";
import { ClientStateBadge } from "@/components/client-state-badge";
import { getClientCompleteness } from "@/lib/client-completeness";
import {
  getRenewalTimingWarning, getProposalDueDate,
  RENEWAL_TIMING_WARNING_LABELS, RENEWAL_TIMING_WARNING_COLORS,
  RENEWAL_PIPELINE_STEP_LABELS, RENEWAL_PIPELINE_STEP_COLORS,
  type RenewalPipelineStep,
} from "@/lib/renewal";

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: clients, isLoading } = useQuery<any[]>({
    queryKey: ["/api/clients", search, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/clients?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch clients");
      return res.json();
    },
  });

  const filters = [
    { label: "All", value: "all" },
    { label: "Active", value: "active" },
    { label: "Prospect", value: "prospect" },
    { label: "Terminated", value: "terminated" },
  ];

  return (
    <div data-testid="clients-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand" data-testid="text-page-title">Clients</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your client accounts</p>
        </div>
        <Link href="/clients/new">
          <Button className="bg-brand text-brand-foreground gap-2" data-testid="button-add-client">
            <Plus className="w-4 h-4" /> Add New Client
          </Button>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search clients by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-10"
            data-testid="input-search"
          />
        </div>
        <div className="flex gap-1 bg-card rounded-md p-1 border">
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                statusFilter === f.value
                  ? "bg-brand text-brand-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`filter-${f.value}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => (
            <Card key={i} className="border-0 shadow-sm"><CardContent className="p-5"><Skeleton className="h-28" /></CardContent></Card>
          ))}
        </div>
      ) : !clients?.length ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-lg font-medium text-foreground">No clients found</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {search ? "Try adjusting your search" : "Add your first client to get started"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {clients.map((client: any) => (
            <Link key={client.id} href={`/clients/${client.id}`}>
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer h-full" data-testid={`client-card-${client.id}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {client.activeIssueCount > 0 && (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <div className="pulse-dot" />
                          <span className="text-xs font-bold text-danger">{client.activeIssueCount}</span>
                        </div>
                      )}
                      <h3 className="font-semibold text-foreground truncate" data-testid={`text-client-name-${client.id}`}>
                        {client.clientCode && <span className="text-brand-accent mr-1.5">{client.clientCode}</span>}
                        {client.clientName}
                      </h3>
                    </div>
                    <ClientStateBadge
                      client={client}
                      className="text-xs px-2 py-1"
                      testId={`badge-status-${client.id}`}
                    />
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{client.city}, {client.state}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{client.industryType}</span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-border mt-2">
                      <span className="text-xs font-medium text-brand-accent">
                        {PLAN_TYPE_LABELS[client.planType] || client.planType}
                      </span>
                      {client.numberOfEmployees != null && (
                        <span className="text-xs text-muted-foreground">
                          {client.numberOfEmployees} employees
                        </span>
                      )}
                    </div>
                    {(() => {
                      if (!client.anniversaryDate) return null;
                      const renewal = client.openRenewal;
                      const step = (renewal?.pipelineStep ?? null) as RenewalPipelineStep | null;
                      if (step === "EMAILED_TO_90D") return null;
                      const warning = getRenewalTimingWarning(renewal, client);
                      if (!step && !warning) return null;
                      return (
                        <div className="mt-1 flex items-center gap-1 flex-wrap">
                          {step && (
                            <span className={`text-xs px-2 py-0.5 rounded font-semibold ${RENEWAL_PIPELINE_STEP_COLORS[step]}`}>
                              {RENEWAL_PIPELINE_STEP_LABELS[step]}
                            </span>
                          )}
                          {warning && (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${RENEWAL_TIMING_WARNING_COLORS[warning]}`}>
                              ⚠ {RENEWAL_TIMING_WARNING_LABELS[warning]}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    {(() => {
                      const comp = getClientCompleteness(client);
                      if (comp.isComplete) return null;
                      const color = comp.pct >= 75 ? "bg-warning-tint text-warning-strong border-warning/40"
                        : comp.pct >= 40 ? "bg-warning-tint text-warning-strong border-warning/40"
                        : "bg-danger-tint text-danger-strong border-danger/40";
                      return (
                        <div className={`mt-2 text-xs px-2 py-1 rounded border ${color} flex items-center gap-1`}>
                          <span className="font-semibold">{comp.pct}% complete</span>
                          <span className="opacity-70">— {comp.missing.length} field{comp.missing.length !== 1 ? "s" : ""} missing</span>
                        </div>
                      );
                    })()}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
