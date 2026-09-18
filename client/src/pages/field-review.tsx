import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, FileText, ExternalLink, ListChecks } from "lucide-react";

interface FieldProposal {
  id: number;
  documentId: number;
  clientId: number;
  fieldKey: string;
  fieldLabel: string;
  proposedValue: string;
  sourceLocation: string | null;
  currentValue: string | null;
  status: string;
  createdAt: string;
  clientName: string;
  clientCode: string;
  documentName: string;
}

function ProposalRow({ proposal }: { proposal: FieldProposal }) {
  const { toast } = useToast();

  const accept = useMutation({
    mutationFn: () => apiRequest("POST", `/api/field-proposals/${proposal.id}/accept`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-proposals"] });
      toast({ title: "Confirmed", description: `${proposal.fieldLabel} noted as reviewed.` });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const reject = useMutation({
    mutationFn: () => apiRequest("POST", `/api/field-proposals/${proposal.id}/reject`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field-proposals"] });
      toast({ title: "Rejected", description: `${proposal.fieldLabel} dismissed.` });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const busy = accept.isPending || reject.isPending;

  return (
    <div
      className="flex items-start justify-between gap-4 border border-border rounded-lg px-4 py-3"
      data-testid={`proposal-row-${proposal.id}`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{proposal.fieldLabel}</p>
        <p className="text-sm text-brand font-semibold mt-0.5" data-testid={`text-proposed-value-${proposal.id}`}>
          {proposal.proposedValue}
        </p>
        {proposal.currentValue && (
          <p className="text-xs text-muted-foreground mt-0.5">Currently on file: {proposal.currentValue}</p>
        )}
        {proposal.sourceLocation && (
          <p className="text-xs text-muted-foreground mt-1">Source: {proposal.sourceLocation}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Button
          size="sm"
          variant="outline"
          className="border-danger text-danger-strong hover:bg-danger-tint"
          disabled={busy}
          onClick={() => reject.mutate()}
          data-testid={`button-reject-${proposal.id}`}
        >
          <XCircle className="w-4 h-4 mr-1.5" />
          Reject
        </Button>
        <Button
          size="sm"
          className="bg-brand hover:bg-brand-dark"
          disabled={busy}
          onClick={() => accept.mutate()}
          data-testid={`button-accept-${proposal.id}`}
        >
          <CheckCircle2 className="w-4 h-4 mr-1.5" />
          Confirm
        </Button>
      </div>
    </div>
  );
}

function DocumentGroup({
  documentId,
  documentName,
  clientId,
  clientName,
  clientCode,
  proposals,
}: {
  documentId: number;
  documentName: string;
  clientId: number;
  clientName: string;
  clientCode: string;
  proposals: FieldProposal[];
}) {
  return (
    <Card className="mb-4" data-testid={`document-group-${documentId}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-brand flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-brand truncate">{documentName}</p>
              <Link href={`/clients/${clientId}`}>
                <span className="text-xs text-muted-foreground hover:text-brand cursor-pointer inline-flex items-center gap-1">
                  {clientName} ({clientCode})
                  <ExternalLink className="w-3 h-3" />
                </span>
              </Link>
            </div>
          </div>
          <Badge variant="outline">{proposals.length} field{proposals.length === 1 ? "" : "s"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {proposals.map((p) => (
          <ProposalRow key={p.id} proposal={p} />
        ))}
      </CardContent>
    </Card>
  );
}

export default function FieldReviewPage() {
  const { data: proposals, isLoading } = useQuery<FieldProposal[]>({
    queryKey: ["/api/field-proposals"],
  });

  const groups = new Map<number, FieldProposal[]>();
  for (const p of proposals || []) {
    if (!groups.has(p.documentId)) groups.set(p.documentId, []);
    groups.get(p.documentId)!.push(p);
  }

  return (
    <div data-testid="field-review-page" className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand">Field Review</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Fields Claude read out of imported PPRs, renewal letters, and rate sheets from 90 Degree Benefits. Nothing
          here has touched a client record yet — confirming a field is the only way it takes effect, and rejecting
          one leaves everything exactly as it was.
        </p>
      </div>

      {isLoading && <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>}

      {!isLoading && groups.size === 0 && (
        <div className="py-16 text-center" data-testid="empty-field-review">
          <ListChecks className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Nothing waiting for review.</p>
        </div>
      )}

      {Array.from(groups.entries()).map(([documentId, docProposals]) => (
        <DocumentGroup
          key={documentId}
          documentId={documentId}
          documentName={docProposals[0].documentName}
          clientId={docProposals[0].clientId}
          clientName={docProposals[0].clientName}
          clientCode={docProposals[0].clientCode}
          proposals={docProposals}
        />
      ))}
    </div>
  );
}
