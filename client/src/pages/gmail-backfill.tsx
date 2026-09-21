import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Archive, PlayCircle, CheckCircle2, AlertTriangle } from "lucide-react";

interface BackfillReport {
  label: string;
  totalThreadsCensused: number;
  byCategory: Record<string, number>;
  businessDomains: { domain: string; threadCount: number }[];
  consumerDomains: { domain: string; threadCount: number }[];
  pendingDomains: number;
  censusComplete: boolean;
}

interface ConsumerDomainReviewRow {
  domain: string;
  threadCount: number;
  sampleSubject: string | null;
  earliestSampleAt: string | null;
  latestSampleAt: string | null;
}

type Phase = "idle" | "census" | "classify" | "free-provider" | "done" | "error";

/**
 * One-time admin trigger for the historical Gmail label backfill (see
 * server/gmailLabelBackfill.ts). Deliberately not wired into any automatic
 * or scheduled path — this page exists solely so an admin can explicitly
 * kick off census -> domain classification -> free-provider classification,
 * each phase looped client-side until the server reports done, since every
 * phase is itself resumable and bounded per call.
 */
export default function GmailBackfillPage() {
  const { toast } = useToast();
  const [mailbox, setMailbox] = useState("steve.schultz@simple.us");
  const [label, setLabel] = useState("90 Degree Benefits");
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [report, setReport] = useState<BackfillReport | null>(null);
  const [freeProviderTally, setFreeProviderTally] = useState<{ business: number; consumer: number } | null>(null);
  const [consumerReview, setConsumerReview] = useState<ConsumerDomainReviewRow[] | null>(null);
  const [running, setRunning] = useState(false);

  function appendLog(line: string) {
    setLog((prev) => [...prev, line]);
  }

  async function runAll() {
    setRunning(true);
    setLog([]);
    setReport(null);
    setFreeProviderTally(null);
    setConsumerReview(null);
    try {
      // Phase 1: census — walk every message under the label, one row per thread.
      setPhase("census");
      let censusDone = false;
      let totalCensused = 0;
      while (!censusDone) {
        const res = await apiRequest("POST", "/api/gmail-backfill/census/run", { mailbox, label });
        const data = await res.json();
        totalCensused += data.threadsScanned;
        appendLog(`Census: +${data.threadsScanned} threads (${totalCensused} total so far)${data.errors.length ? `, ${data.errors.length} errors` : ""}`);
        censusDone = data.done;
      }
      appendLog("Census complete.");

      // Phase 2: one Claude call per unique pending domain.
      setPhase("classify");
      let classifyDone = false;
      let totalDomains = 0;
      while (!classifyDone) {
        const res = await apiRequest("POST", "/api/gmail-backfill/classify/run", { mailbox, label });
        const data = await res.json();
        totalDomains += data.domainsClassified;
        appendLog(`Domain classify: +${data.domainsClassified} domains (${totalDomains} total) — ${data.businessDomains.length} business, ${data.consumerDomains.length} consumer this batch`);
        classifyDone = data.done;
      }
      appendLog("Domain classification complete.");

      // Phase 3: per-thread classification for the free-mail-provider bucket.
      setPhase("free-provider");
      let fpDone = false;
      let business = 0, consumer = 0;
      while (!fpDone) {
        const res = await apiRequest("POST", "/api/gmail-backfill/classify-free-provider/run", { mailbox, label });
        const data = await res.json();
        business += data.business;
        consumer += data.consumer;
        appendLog(`Free-provider classify: +${data.threadsClassified} threads (${business} business / ${consumer} consumer so far)`);
        fpDone = data.done;
      }
      setFreeProviderTally({ business, consumer });
      appendLog("Free-provider classification complete.");

      // Final report + consumer review list.
      const reportRes = await apiRequest("GET", `/api/gmail-backfill/report?mailbox=${encodeURIComponent(mailbox)}&label=${encodeURIComponent(label)}`);
      setReport(await reportRes.json());

      const reviewRes = await apiRequest("GET", `/api/gmail-backfill/consumer-review?mailbox=${encodeURIComponent(mailbox)}&label=${encodeURIComponent(label)}&minThreadCount=5`);
      setConsumerReview(await reviewRes.json());

      setPhase("done");
      toast({ title: "Backfill complete", description: "Census, domain classification, and free-provider classification all finished." });
    } catch (err: any) {
      setPhase("error");
      appendLog(`ERROR: ${err.message}`);
      toast({ title: "Backfill failed", description: err.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div data-testid="gmail-backfill-page" className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand">Gmail Label Backfill</h1>
        <p className="text-sm text-muted-foreground mt-1">
          One-time historical pass over a Gmail label: census every thread, classify each counterparty domain as
          business or consumer, then resolve the free-mail-provider bucket thread by thread. Nothing is imported
          here — this only decides what would be eligible to import later. Safe to re-run; every phase resumes
          from where it left off.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Archive className="w-4 h-4 text-brand" />
            <h2 className="font-semibold text-brand">Run backfill</h2>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="mailbox" className="text-xs text-muted-foreground">Mailbox</Label>
              <Input id="mailbox" value={mailbox} onChange={(e) => setMailbox(e.target.value)} disabled={running} data-testid="input-mailbox" />
            </div>
            <div>
              <Label htmlFor="label" className="text-xs text-muted-foreground">Gmail label</Label>
              <Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} disabled={running} data-testid="input-label" />
            </div>
          </div>
          <Button className="bg-brand hover:bg-brand-dark" disabled={running} onClick={runAll} data-testid="button-run-backfill">
            <PlayCircle className="w-4 h-4 mr-2" />
            {running ? `Running… (${phase})` : "Run full backfill"}
          </Button>
        </CardContent>
      </Card>

      {log.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <h2 className="font-semibold text-brand">Progress</h2>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 max-h-64 overflow-y-auto" data-testid="list-backfill-log">
              {log.map((line, i) => (
                <li key={i} className="text-xs font-mono text-foreground">{line}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {report && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-success-strong" />
              <h2 className="font-semibold text-brand">Report</h2>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground mb-3" data-testid="text-total-censused">
              {report.totalThreadsCensused} threads censused total.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              {Object.entries(report.byCategory).map(([cat, count]) => (
                <div key={cat}>
                  <p className="text-xs text-muted-foreground">{cat}</p>
                  <p className="text-lg font-bold text-brand tabular-nums">{count}</p>
                </div>
              ))}
            </div>
            {freeProviderTally && (
              <p className="text-sm text-foreground" data-testid="text-free-provider-tally">
                Free-provider pass: {freeProviderTally.business} business, {freeProviderTally.consumer} consumer.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {consumerReview && consumerReview.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-brand" />
              <h2 className="font-semibold text-brand">Consumer domains (&gt;5 threads) for review</h2>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 max-h-96 overflow-y-auto" data-testid="list-consumer-review">
              {consumerReview.map((row) => (
                <li key={row.domain} className="text-xs font-mono border-b border-border pb-2">
                  {row.domain} | {row.threadCount} threads | {row.earliestSampleAt ? new Date(row.earliestSampleAt).toISOString().slice(0, 10) : "unknown"} to{" "}
                  {row.latestSampleAt ? new Date(row.latestSampleAt).toISOString().slice(0, 10) : "unknown"} | "{row.sampleSubject || "(no subject)"}"
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
