import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Clock } from "lucide-react";
import { format } from "date-fns";

const PROSPECT_STEPS = [
  { key: "step1Date", label: "New Proposal Requested", desc: "Request submitted to 90 Degree Benefits" },
  { key: "step2Date", label: "Proposal Received",       desc: "Proposal received from 90 Degree" },
  { key: "step3Date", label: "Proposal Sent",            desc: "Proposal delivered to the prospect" },
];

function ProspectPipeline({ clientId }: { clientId: number }) {
  const { toast } = useToast();
  const today = format(new Date(), "yyyy-MM-dd");
  const [markingKey, setMarkingKey] = useState<string | null>(null);
  const [markDate, setMarkDate] = useState(today);

  const { data: prog = {} as any, isLoading } = useQuery<any>({
    queryKey: ["/api/clients", String(clientId), "prospect-progress"],
    queryFn: () =>
      fetch(`/api/clients/${clientId}/prospect-progress`, { credentials: "include" }).then(r => r.json()),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/clients/${clientId}/prospect-progress`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "prospect-progress"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stalled"] });
      toast({ title: "Pipeline step updated" });
      setMarkingKey(null);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const currentIdx = PROSPECT_STEPS.findIndex(s => !prog?.[s.key]);
  const isComplete = prog?.step3Date != null;
  const markingStep = markingKey ? PROSPECT_STEPS.find(s => s.key === markingKey) ?? null : null;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {isComplete && (
        <div className="mb-4 px-4 py-3 bg-[#22C55E]/10 rounded-lg text-sm text-[#22C55E] font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Pipeline complete — proposal delivered.
        </div>
      )}

      <div className="space-y-0">
        {PROSPECT_STEPS.map((step, idx) => {
          const isDone = !!prog?.[step.key];
          const isActive = idx === currentIdx;
          const isFuture = !isDone && !isActive;
          const stepDate = isDone ? new Date(prog[step.key]) : null;

          return (
            <div
              key={step.key}
              className={`flex items-start gap-3 py-3 ${idx < PROSPECT_STEPS.length - 1 ? "border-b border-dashed border-[#E2E8F0]" : ""} ${isFuture ? "opacity-40" : ""}`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {isDone ? (
                  <CheckCircle2 className="w-5 h-5 text-[#22C55E]" />
                ) : isActive ? (
                  <div className="w-5 h-5 rounded-full border-2 border-[#2E86C1] bg-white flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-[#2E86C1]" />
                  </div>
                ) : (
                  <div className="w-5 h-5 rounded-full border-2 border-[#CBD5E1] bg-white" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className={`text-sm font-medium ${isDone ? "text-[#22C55E]" : isActive ? "text-[#1A5276]" : "text-[#94A3B8]"}`}>
                      {step.label}
                    </p>
                    {!isDone && <p className="text-[11px] text-[#94A3B8] mt-0.5">{step.desc}</p>}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isDone && (
                      <>
                        <span className="text-xs text-[#94A3B8]">{format(stepDate!, "MMM d, yyyy")}</span>
                        {!isComplete && (
                          <Button
                            size="sm" variant="ghost"
                            className="h-6 px-2 text-[10px] text-[#94A3B8] hover:text-[#EF4444]"
                            onClick={() => updateMutation.mutate({ [step.key]: null })}
                          >
                            Undo
                          </Button>
                        )}
                      </>
                    )}
                    {isActive && !isComplete && (
                      <Button
                        size="sm"
                        className="h-7 px-3 text-xs bg-[#2E86C1] text-white hover:bg-[#1A5276]"
                        onClick={() => { setMarkingKey(step.key); setMarkDate(today); }}
                      >
                        Mark Done
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {markingStep && (
        <Dialog open={true} onOpenChange={() => setMarkingKey(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Mark: {markingStep.label}</DialogTitle>
            </DialogHeader>
            <div className="py-2">
              <Label className="text-xs">Date completed</Label>
              <Input
                type="date"
                value={markDate}
                onChange={e => setMarkDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMarkingKey(null)}>Cancel</Button>
              <Button
                className="bg-[#2E86C1] text-white"
                onClick={() => updateMutation.mutate({ [markingStep.key]: markDate || today })}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "Saving…" : "Mark Done"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export default function PipelineTab({ clientId, clientStatus }: { clientId: number; clientStatus: string }) {
  if (clientStatus === "PROSPECT") {
    return (
      <div>
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-[#1A5276]">New Business Pipeline</h2>
          <p className="text-sm text-[#94A3B8] mt-1">
            Track the proposal process through three stages. The clock starts when a step is marked; a step stalled
            for more than 14 days appears on the dashboard reminders.
          </p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-5 max-w-xl">
          <ProspectPipeline clientId={clientId} />
        </div>
      </div>
    );
  }

  if (clientStatus === "ACTIVE") {
    return (
      <div className="text-center py-16">
        <Clock className="w-10 h-10 text-[#94A3B8] mx-auto mb-3" />
        <p className="text-[#2C3E50] font-medium">Renewal tracking is per-plan</p>
        <p className="text-sm text-[#94A3B8] mt-1">
          Open the <strong>Plans &amp; Rates</strong> tab to track renewal steps for each plan.
        </p>
      </div>
    );
  }

  return (
    <div className="text-center py-16">
      <p className="text-[#94A3B8]">Pipeline tracking is not available for terminated clients.</p>
    </div>
  );
}
