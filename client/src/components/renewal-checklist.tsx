import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { renewalSteps, renewalIsComplete } from "@shared/renewal-progress";
import { Button } from "@/components/ui/button";
import { RENEWAL_PIPELINE_STEP_LABELS } from "@/lib/renewal";

export function RenewalChecklist({ renewal, clientId }: { renewal: any; clientId: number }) {
  const [error, setError] = useState("");
  const { data: docs = [] } = useQuery<any[]>({queryKey: [`/api/clients/${clientId}/documents`]});
  const save = useMutation({
    mutationFn: async (value: any) => apiRequest("PATCH", `/api/renewals/${renewal.id}/checklist`, value),
    onSuccess: () => { setError(""); queryClient.invalidateQueries(); },
    onError: (e: Error) => setError(e.message),
  });
  return <section className="border rounded p-4 space-y-3" aria-label={`${renewal.planYear} renewal checklist`}>
    <h3 className="font-semibold">{renewal.planYear} renewal — {renewal.suppressed ? "Suppressed" : renewalIsComplete(renewal) ? "Complete" : "In progress"}</h3>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {renewalSteps.map(step => {
      const entry = renewal.steps?.[step];
      return <form key={`${step}-${JSON.stringify(entry)}`} className="border-b pb-3 space-y-2"
        onSubmit={e => {e.preventDefault(); const f = new FormData(e.currentTarget); save.mutate({step, status:f.get("status"), date:f.get("date"), reason:f.get("reason")});}}>
        <div className="text-sm font-medium">{RENEWAL_PIPELINE_STEP_LABELS[step]}</div>
        <p className="text-xs text-muted-foreground">{entry ? `${entry.status === "NA" ? "Not applicable" : "Done"} · ${entry.dateQualifier ? entry.dateQualifier + " " : ""}${entry.date || "Date unknown"} · ${entry.by}${entry.reason ? " · " + entry.reason : ""}` : "Not done"}</p>
        <fieldset disabled={renewal.suppressed || save.isPending} className="flex flex-wrap gap-2">
          <select name="status" aria-label={`${step} status`} defaultValue={entry?.status ?? "OPEN"} className="border rounded p-2 text-sm bg-background"><option value="OPEN">Not done</option><option value="DONE">Done</option><option value="NA">Not applicable</option></select>
          <input type="date" name="date" aria-label={`${step} date`} defaultValue={entry?.date ?? ""} className="border rounded p-2 text-sm bg-background" />
          <input name="reason" aria-label={`${step} reason`} placeholder="Reason if not applicable" maxLength={300} defaultValue={entry?.reason ?? ""} className="border rounded p-2 text-sm bg-background" />
          <Button size="sm" type="submit">Save</Button>
        </fieldset>
      </form>;
    })}
    <h4 className="font-medium">Employee handouts — one per plan</h4>
    <p className="text-xs text-muted-foreground">Upload each plan's handout here, then select it and save its done date. All steps and handouts are required for completion.</p>
    {!renewal.handouts?.length && <p role="alert">No expected plans recorded. Completion is blocked until the renewal's plans are configured.</p>}
    {renewal.handouts?.map((h: any) => <form key={`${h.planId}-${h.documentId}-${h.date}`} className="border rounded p-3 space-y-2" onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      save.mutate({planId:h.planId, documentId:f.get("documentId"), date:f.get("date"), status:f.get("status")});
    }}>
      <div className="text-sm">{h.planName}: {h.documentId ? `Done · ${h.date} · ${h.by ?? "Historical"}` : "Not done"}</div>
      <input type="file" aria-label={`Upload ${h.planName} handout`} disabled={renewal.suppressed} onChange={async e => {
        const file = e.target.files?.[0]; if (!file) return;
        const fd = new FormData(); fd.append("file",file); fd.append("category","HANDOUT"); fd.append("planId",String(h.planId)); fd.append("renewalId",String(renewal.id)); fd.append("documentName",file.name);
        try { const response = await fetch(`/api/clients/${clientId}/documents`,{method:"POST",body:fd,credentials:"include"}); if(!response.ok) throw new Error(await response.text()); await queryClient.invalidateQueries(); setError(""); } catch(e:any){setError(e.message);}
      }}/>
      <fieldset disabled={renewal.suppressed || save.isPending} className="flex flex-wrap gap-2">
        <select name="status" aria-label={`${h.planName} status`} defaultValue={h.documentId ? "DONE" : "OPEN"} className="border rounded p-2 bg-background"><option value="OPEN">Not done</option><option value="DONE">Done</option></select>
        <select name="documentId" aria-label={`${h.planName} document`} defaultValue={h.documentId ?? ""} className="border rounded p-2 bg-background"><option value="">Select handout</option>{docs.filter(d => d.category === "HANDOUT" && d.planId === h.planId && (!d.renewalId || d.renewalId === renewal.id)).map(d => <option key={d.id} value={d.id}>{d.documentName}</option>)}</select>
        <input type="date" name="date" aria-label={`${h.planName} date`} defaultValue={h.date ?? ""} className="border rounded p-2 bg-background" />
        <Button size="sm" type="submit">Save</Button>
      </fieldset>
    </form>)}
  </section>;
}
