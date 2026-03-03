import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, Users, Building2, MapPin } from "lucide-react";
import { PLAN_TYPE_LABELS } from "@/lib/constants";

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
    { label: "Terminated", value: "terminated" },
  ];

  return (
    <div data-testid="clients-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1A5276]" data-testid="text-page-title">Clients</h1>
          <p className="text-sm text-[#94A3B8] mt-1">Manage your client accounts</p>
        </div>
        <Link href="/clients/new">
          <Button className="bg-[#1A5276] text-white gap-2" data-testid="button-add-client">
            <Plus className="w-4 h-4" /> Add New Client
          </Button>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
          <Input
            type="search"
            placeholder="Search clients by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-10"
            data-testid="input-search"
          />
        </div>
        <div className="flex gap-1 bg-white rounded-md p-1 border">
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                statusFilter === f.value
                  ? "bg-[#1A5276] text-white"
                  : "text-[#94A3B8] hover:text-[#2C3E50]"
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
            <Users className="w-12 h-12 text-[#94A3B8] mx-auto mb-3" />
            <h3 className="text-lg font-medium text-[#2C3E50]">No clients found</h3>
            <p className="text-sm text-[#94A3B8] mt-1">
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
                          <span className="text-xs font-bold text-[#EF4444]">{client.activeIssueCount}</span>
                        </div>
                      )}
                      <h3 className="font-semibold text-[#2C3E50] truncate" data-testid={`text-client-name-${client.id}`}>
                        {client.clientName}
                      </h3>
                    </div>
                    <span className={`text-[10px] px-2 py-1 rounded-full font-semibold flex-shrink-0 ${
                      client.isActive
                        ? "bg-[#22C55E]/10 text-[#22C55E]"
                        : "bg-[#EF4444]/10 text-[#EF4444]"
                    }`} data-testid={`badge-status-${client.id}`}>
                      {client.isActive ? "Active" : "Terminated"}
                    </span>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-[#94A3B8]">
                      <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{client.city}, {client.state}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[#94A3B8]">
                      <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{client.industryType}</span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-gray-100 mt-2">
                      <span className="text-xs font-medium text-[#2E86C1]">
                        {PLAN_TYPE_LABELS[client.planType] || client.planType}
                      </span>
                      <span className="text-xs text-[#94A3B8]">
                        {client.numberOfEmployees} employees
                      </span>
                    </div>
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
