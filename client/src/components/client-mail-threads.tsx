import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow, format } from "date-fns";
import { ChevronDown, ChevronRight, Forward, Mail, Paperclip, Reply } from "lucide-react";
import type { ComposeMode, ComposeSourceMessage } from "@/components/compose-message-dialog";

/**
 * The client's real email, inside the client record, with a way to answer it.
 *
 * This is deliberately the minimum read view that makes sending possible:
 * the threads for this client, the messages in a thread, and Reply / Reply
 * all / Forward on each message. Reply is attached to the message it sits
 * under, so the reply threads against that exact message rather than
 * whichever one happens to be newest.
 */

interface ThreadListItem {
  id: number;
  subject: string | null;
  latestMessageAt: string;
  messageCount: number;
  summaryOneLine: string | null;
}

interface ThreadMessage {
  id: number;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string | null;
  bodyText: string | null;
  bodyTextNew: string | null;
  bodyHtmlSafe: string | null;
  sentAt: string;
  direction: "SENT" | "RECEIVED";
  sentByUserName: string | null;
  messageIdHeader: string | null;
  attachments: { id: number; filename: string }[];
}

function ThreadMessages({
  threadId,
  onCompose,
}: {
  threadId: number;
  onCompose: (mode: ComposeMode, source: ComposeSourceMessage) => void;
}) {
  const { data, isLoading } = useQuery<{ messages: ThreadMessage[] }>({
    queryKey: [`/api/gmail-inbox/threads/${threadId}`],
  });

  if (isLoading) return <Skeleton className="h-24 mt-2" />;
  const messages = data?.messages ?? [];

  return (
    <div className="space-y-2 mt-2">
      {messages.map((m) => (
        <div key={m.id} className="border border-border rounded-md p-3" data-testid={`client-mail-message-${m.id}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">
                {m.fromName || m.fromEmail}
                {m.direction === "SENT" && (
                  <Badge variant="outline" className="ml-1.5 text-[10px] h-4 px-1">
                    sent{m.sentByUserName ? ` by ${m.sentByUserName}` : ""}
                  </Badge>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                to {m.toEmails.join(", ")}
                {m.ccEmails.length > 0 ? ` · cc ${m.ccEmails.join(", ")}` : ""}
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground flex-shrink-0" title={format(new Date(m.sentAt), "PPpp")}>
              {formatDistanceToNow(new Date(m.sentAt), { addSuffix: true })}
            </span>
          </div>

          <div className="text-xs text-foreground whitespace-pre-wrap mt-2 max-h-56 overflow-y-auto">
            {(m.bodyTextNew || m.bodyText || "").trim() || "(no text)"}
          </div>

          {m.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {m.attachments.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1 text-[11px] border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                  <Paperclip className="w-3 h-3" />
                  {a.filename}
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-1.5 mt-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={() => onCompose("reply", m)}
              data-testid={`button-reply-${m.id}`}
            >
              <Reply className="w-3 h-3" /> Reply
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={() => onCompose("replyAll", m)}
              data-testid={`button-reply-all-${m.id}`}
            >
              <Reply className="w-3 h-3" /> Reply all
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={() => onCompose("forward", m)}
              data-testid={`button-forward-${m.id}`}
            >
              <Forward className="w-3 h-3" /> Forward
            </Button>
          </div>
        </div>
      ))}
      {messages.length === 0 && <p className="text-xs text-muted-foreground">No messages stored for this thread.</p>}
    </div>
  );
}

export default function ClientMailThreads({
  clientId,
  onCompose,
}: {
  clientId: number;
  onCompose: (mode: ComposeMode, source: ComposeSourceMessage) => void;
}) {
  const [openThreadId, setOpenThreadId] = useState<number | null>(null);
  const { data, isLoading } = useQuery<{ total: number; threads: ThreadListItem[] }>({
    queryKey: [`/api/gmail-inbox/threads?clientId=${clientId}&limit=15`],
  });

  const threads = data?.threads ?? [];

  return (
    <Card className="border-0 shadow-sm" data-testid="card-client-mail">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2.5">
          <Mail className="w-4 h-4 text-brand" />
          <span className="text-sm font-semibold text-brand">Email</span>
          {!isLoading && <span className="text-xs text-muted-foreground">{data?.total ?? 0} threads</span>}
        </div>

        {isLoading ? (
          <Skeleton className="h-20" />
        ) : threads.length === 0 ? (
          <p className="text-xs text-muted-foreground">No synced email is linked to this client yet.</p>
        ) : (
          <div className="space-y-1.5">
            {threads.map((t) => {
              const open = openThreadId === t.id;
              return (
                <div key={t.id} className="border border-border rounded-md">
                  <button
                    className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-muted/40 transition-colors"
                    onClick={() => setOpenThreadId(open ? null : t.id)}
                    data-testid={`button-toggle-thread-${t.id}`}
                  >
                    {open ? (
                      <ChevronDown className="w-3.5 h-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-foreground truncate">
                        {t.subject || "(no subject)"}
                      </span>
                      {t.summaryOneLine && (
                        <span className="block text-[11px] text-muted-foreground truncate">{t.summaryOneLine}</span>
                      )}
                    </span>
                    <span className="text-[11px] text-muted-foreground flex-shrink-0">
                      {t.messageCount > 1 ? `${t.messageCount} · ` : ""}
                      {formatDistanceToNow(new Date(t.latestMessageAt), { addSuffix: true })}
                    </span>
                  </button>
                  {open && (
                    <div className="px-3 pb-3">
                      <ThreadMessages threadId={t.id} onCompose={onCompose} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
