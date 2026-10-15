import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
export default function TodayPage() {
  const {data,error,isLoading}=useQuery<any>({queryKey:["/api/today"]});
  const action=useMutation({
    mutationFn:({id,action}:{id:number;action:string})=>apiRequest("POST",`/api/today/${id}/${action}`,{}),
    onSuccess:()=>queryClient.invalidateQueries(),
  });
  if(isLoading) return <p>Loading today's work…</p>;
  if(error) return <p role="alert">{error.message}</p>;
  return <main className="p-6 space-y-6">
    <h1 className="text-2xl font-bold">Today</h1>
    <p className="text-sm text-muted-foreground">Total open: {data.totalOpen} · {data.today}</p>
    {action.error && <p role="alert" className="text-destructive">{action.error.message}</p>}
    {([["My to-dos","todos"],["Renewal steps","renewals"],["New from email","suggestions"]] as const).map(([title,key])=><section key={key} className="border rounded-lg p-4 space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {key==="suggestions" && <p className="text-sm text-muted-foreground">Since the previous digest. Older suggestions remain in triage.</p>}
      {!data[key].length && <p className="text-muted-foreground">Nothing here today.</p>}
      {data[key].map((t:any,i:number)=><div id={`suggestion-${t.id}`} key={`${t.id}-${i}`} className="border-b pb-3">
        <p><strong>{t.client}</strong>: {t.description}</p>
        <p className="text-sm text-muted-foreground">{t.due ? `Due ${t.due}${t.due<data.today ? " · OVERDUE":""}`:"No due date"}</p>
        {t.dateReview && <p role="alert" className="text-sm text-destructive">{t.dateReview}</p>}
        {key==="renewals" && <Link href={`/clients/${t.clientId}`}>Open renewal</Link>}
        {key==="suggestions" && <div className="flex gap-2 mt-2">
          <Button disabled={action.isPending} onClick={()=>action.mutate({id:t.id,action:"accept"})}>Accept</Button>
          <Button variant="outline" disabled={action.isPending} onClick={()=>action.mutate({id:t.id,action:"dismiss"})}>Dismiss</Button>
        </div>}
      </div>)}
      {key==="suggestions" && <Link href="/inbox">{data.moreInTriage} more in triage — open triage</Link>}
    </section>)}
  </main>;
}
