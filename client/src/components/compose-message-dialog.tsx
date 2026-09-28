import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Loader2, Lock, Paperclip, Send, Users, X } from "lucide-react";

/**
 * One composer for every way a message leaves the CRM: a fresh message, a
 * reply, or a forward.
 *
 * A reply is anchored to the message the user was looking at — its id goes
 * to the server, which reads that message's own Message-ID and threads
 * against it. Nothing here guesses which message in a conversation is the
 * right one to answer.
 */

export interface ComposeSourceMessage {
  /** Our own gmail_messages id. This is what makes the reply thread correctly. */
  id: number;
  subject?: string | null;
  fromEmail: string;
  fromName?: string | null;
  toEmails?: string[];
  ccEmails?: string[];
  sentAt: string;
  bodyText?: string | null;
  bodyTextNew?: string | null;
}

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

interface SendingIdentity {
  id: number;
  email: string;
  displayName: string;
  signature: string | null;
}

interface DirectoryPerson {
  name: string;
  email: string;
  role?: string | null;
  /** Decided by the server against the same domains the send guard uses, not by which group the person is listed under. */
  isInternal: boolean;
}

interface DirectoryGroup {
  key: string;
  label: string;
  note?: string;
  people: DirectoryPerson[];
}

interface AttachableDocuments {
  clientDocuments: {
    id: number;
    documentName: string | null;
    fileName: string;
    category: string;
    uploadedAt: string;
    isInternalOnly: boolean;
  }[];
  globalDocuments: { id: number; name: string; category: string; fileName: string }[];
}

function withPrefix(subject: string | null | undefined, prefix: "Re:" | "Fwd:"): string {
  const base = (subject || "").trim();
  if (!base) return prefix === "Re:" ? "Re:" : "Fwd:";
  const already = new RegExp(`^${prefix === "Re:" ? "re" : "fwd?"}:`, "i").test(base);
  return already ? base : `${prefix} ${base}`;
}

function quotedBody(src: ComposeSourceMessage, mode: ComposeMode): string {
  const body = (src.bodyText || src.bodyTextNew || "").trim();
  const when = (() => {
    try {
      return format(new Date(src.sentAt), "PP 'at' p");
    } catch {
      return src.sentAt;
    }
  })();
  const who = src.fromName ? `${src.fromName} <${src.fromEmail}>` : src.fromEmail;
  if (mode === "forward") {
    const header = [
      "---------- Forwarded message ----------",
      `From: ${who}`,
      `Date: ${when}`,
      `Subject: ${src.subject || "(no subject)"}`,
      src.toEmails && src.toEmails.length > 0 ? `To: ${src.toEmails.join(", ")}` : null,
    ].filter(Boolean).join("\n");
    return `\n\n${header}\n\n${body}`;
  }
  const quoted = body.split("\n").map((line) => `> ${line}`).join("\n");
  return `\n\nOn ${when}, ${who} wrote:\n${quoted}`;
}

export default function ComposeMessageDialog({
  mode,
  source,
  clientId,
  clientIds,
  defaultTo,
  onClose,
  onSent,
}: {
  mode: ComposeMode;
  source?: ComposeSourceMessage | null;
  clientId?: number | null;
  clientIds?: number[];
  defaultTo?: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const { toast } = useToast();
  const { data: identities = [] } = useQuery<SendingIdentity[]>({ queryKey: ["/api/sending-identities/mine"] });
  const { data: attachable } = useQuery<AttachableDocuments>({
    queryKey: [`/api/clients/${clientId}/attachable-documents`],
    enabled: !!clientId,
  });
  const { data: globalOnly } = useQuery<{ id: number; name: string; category: string; fileName: string }[]>({
    queryKey: ["/api/global-documents"],
    enabled: !clientId,
  });

  const [fromIdentityId, setFromIdentityId] = useState<string>("");
  const [to, setTo] = useState(
    defaultTo ??
      (mode === "reply" || mode === "replyAll" ? source?.fromEmail ?? "" : ""),
  );
  const [cc, setCc] = useState(
    mode === "replyAll"
      ? [...(source?.toEmails || []), ...(source?.ccEmails || [])].join(", ")
      : "",
  );
  const [subject, setSubject] = useState(
    mode === "forward"
      ? withPrefix(source?.subject, "Fwd:")
      : mode === "reply" || mode === "replyAll"
        ? withPrefix(source?.subject, "Re:")
        : "",
  );
  const [body, setBody] = useState(source && mode !== "new" ? quotedBody(source, mode) : "");
  // Opened from the triage feed, all that is known is the message id — the
  // text to quote and the other recipients have to be fetched before the
  // reply can be written against the right original.
  const needsFullSource = !!source && mode !== "new" && source.bodyText == null && source.bodyTextNew == null;
  const { data: fetchedSource } = useQuery<ComposeSourceMessage & { ccEmails?: string[]; toEmails?: string[] }>({
    queryKey: [`/api/gmail-messages/${source?.id}`],
    enabled: needsFullSource,
  });
  const [sourceApplied, setSourceApplied] = useState(false);
  useEffect(() => {
    if (!fetchedSource || sourceApplied) return;
    setBody(quotedBody({ ...fetchedSource, id: fetchedSource.id ?? source!.id }, mode));
    if (mode === "replyAll") {
      setCc([...(fetchedSource.toEmails || []), ...(fetchedSource.ccEmails || [])].join(", "));
    }
    if (!to.trim() && (mode === "reply" || mode === "replyAll")) setTo(fetchedSource.fromEmail);
    setSourceApplied(true);
  }, [fetchedSource, sourceApplied, mode, to, source]);

  const [bcc, setBcc] = useState("");
  const { data: directory } = useQuery<{ groups: DirectoryGroup[] }>({
    queryKey: clientId ? [`/api/recipient-directory?clientId=${clientId}`] : ["/api/recipient-directory"],
  });
  const [showDirectory, setShowDirectory] = useState(false);

  /** Adds an address to a field, never twice, and leaves anything typed alone. */
  function addRecipient(field: "to" | "cc" | "bcc", email: string) {
    const setter = field === "to" ? setTo : field === "cc" ? setCc : setBcc;
    setter((current) => {
      const existing = current.split(",").map((s) => s.trim()).filter(Boolean);
      if (existing.some((e) => e.toLowerCase() === email.toLowerCase())) return current;
      return [...existing, email].join(", ");
    });
  }

  const [documentIds, setDocumentIds] = useState<number[]>([]);
  const [globalDocumentIds, setGlobalDocumentIds] = useState<number[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fromIdentityId && identities.length > 0) setFromIdentityId(String(identities[0].id));
  }, [identities, fromIdentityId]);

  const selectedIdentity = identities.find((i) => String(i.id) === fromIdentityId);
  const globals = attachable?.globalDocuments ?? globalOnly ?? [];
  const clientDocs = attachable?.clientDocuments ?? [];

  const attachmentCount = documentIds.length + globalDocumentIds.length + files.length;
  const blockedSelection = useMemo(
    () => clientDocs.filter((d) => documentIds.includes(d.id) && d.isInternalOnly),
    [clientDocs, documentIds],
  );

  const send = useMutation({
    mutationFn: async () => {
      // Always multipart: one request shape whether or not a local file is
      // attached, so there is a single path to keep working.
      const fd = new FormData();
      fd.append("fromIdentityId", fromIdentityId);
      fd.append("to", JSON.stringify(to.split(",").map((s) => s.trim()).filter(Boolean)));
      fd.append("cc", JSON.stringify(cc.split(",").map((s) => s.trim()).filter(Boolean)));
      fd.append("bcc", JSON.stringify(bcc.split(",").map((s) => s.trim()).filter(Boolean)));
      fd.append("subject", subject);
      fd.append("bodyText", body);
      fd.append("clientIds", JSON.stringify(clientIds ?? (clientId ? [clientId] : [])));
      fd.append("documentIds", JSON.stringify(documentIds));
      fd.append("globalDocumentIds", JSON.stringify(globalDocumentIds));
      if (source && mode !== "new") fd.append("replyToMessageId", String(source.id));
      for (const f of files) fd.append("files", f);
      const res = await fetch("/api/communications/send", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) {
        const text = await res.text();
        let message = text;
        try {
          message = JSON.parse(text).message || text;
        } catch {
          /* a non-JSON body is shown as-is */
        }
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail-inbox/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail-triage/feed"] });
      if (clientId) {
        queryClient.invalidateQueries({ queryKey: ["/api/clients", String(clientId), "communications"] });
        queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/mail`] });
      }
      toast({ title: "Message sent" });
      onSent?.();
      onClose();
    },
    onError: (e: any) => setError(e.message || "Could not send"),
  });

  const title = mode === "forward" ? "Forward" : mode === "new" ? "Send a message" : "Reply";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {source && mode !== "new" && (
            <p className="text-xs text-muted-foreground" data-testid="text-compose-anchor">
              {mode === "forward" ? "Forwarding" : "Replying to"} {source.fromName || source.fromEmail} ·{" "}
              {source.subject || "(no subject)"}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">From</Label>
              <Select value={fromIdentityId} onValueChange={setFromIdentityId}>
                <SelectTrigger className="mt-1" data-testid="select-from-identity">
                  <SelectValue placeholder="Choose sending address" />
                </SelectTrigger>
                <SelectContent>
                  {identities.map((i) => (
                    <SelectItem key={i.id} value={String(i.id)}>
                      {i.displayName} &lt;{i.email}&gt;
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {identities.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  You have no sending addresses set up yet — ask an admin in Settings.
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">To *</Label>
              <Input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="broker@example.com"
                className="mt-1"
                data-testid="input-send-to"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Cc</Label>
              <Input value={cc} onChange={(e) => setCc(e.target.value)} className="mt-1" data-testid="input-send-cc" />
            </div>
            <div>
              <Label className="text-xs">Bcc</Label>
              <Input value={bcc} onChange={(e) => setBcc(e.target.value)} className="mt-1" data-testid="input-send-bcc" />
            </div>
          </div>

          {/* ── Who to send to ──
              Grouped and labelled: the broker is never shown inside the
              internal list, because that is how the wrong person gets copied
              on something they should not see. Typing an address by hand
              still works; this only saves the typing. */}
          <div className="border border-border rounded-md">
            <button
              type="button"
              onClick={() => setShowDirectory((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold"
              data-testid="button-toggle-recipient-picker"
            >
              <span className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-muted-foreground" />
                Add people
              </span>
              <span className="text-muted-foreground font-normal">{showDirectory ? "Hide" : "Show"}</span>
            </button>
            {showDirectory && (
              <div className="px-3 pb-3 space-y-3 max-h-64 overflow-y-auto">
                {(directory?.groups ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No saved contacts to offer here — type the address instead.
                  </p>
                )}
                {(directory?.groups ?? []).map((group) => (
                  <div key={group.key} data-testid={`recipient-group-${group.key}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-xs font-semibold text-foreground">{group.label}</p>
                      {group.note && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] h-4 px-1 ${
                            group.key === "broker" ? "border-destructive text-destructive" : ""
                          }`}
                        >
                          {group.note}
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-1">
                      {group.people.map((p) => (
                        <div
                          key={`${group.key}-${p.email}`}
                          className="flex items-center justify-between gap-2 text-xs"
                          data-testid={`recipient-${group.key}-${p.email}`}
                        >
                          <span className="min-w-0 truncate">
                            <span className="text-foreground">{p.name}</span>
                            {p.role && <span className="text-muted-foreground"> · {p.role}</span>}
                            <span className="text-muted-foreground">
                              {" · "}
                              {p.email || "no address on file"}
                            </span>
                            {/* A staff row or a 90 Degree row holding a personal
                                address is still an outside address. Say so on
                                the person, not just in the group heading. */}
                            {p.email && !p.isInternal && (group.key === "internal" || group.key === "vendor") && (
                              <Badge variant="outline" className="ml-1.5 text-[10px] h-4 px-1 border-destructive text-destructive">
                                outside
                              </Badge>
                            )}
                          </span>
                          <span className="flex items-center gap-1 shrink-0">
                            {(["to", "cc", "bcc"] as const).map((field) => (
                              <Button
                                key={field}
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-6 px-2 text-[11px]"
                                disabled={!p.email}
                                onClick={() => addRecipient(field, p.email)}
                                data-testid={`button-add-${field}-${p.email || p.name}`}
                              >
                                {field === "to" ? "To" : field === "cc" ? "Cc" : "Bcc"}
                              </Button>
                            ))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Subject</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1"
                data-testid="input-send-subject"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Message *</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="mt-1 text-sm font-mono"
              data-testid="textarea-send-body"
            />
            {selectedIdentity?.signature && (
              <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                Signature added automatically:{"\n"}
                {selectedIdentity.signature}
              </p>
            )}
          </div>

          {/* ── Attachments ── */}
          <div className="border border-border rounded-md p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold">Attachments{attachmentCount > 0 ? ` (${attachmentCount})` : ""}</p>
            </div>

            {clientDocs.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">This client's current documents</p>
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {clientDocs.map((d) => (
                    <label key={d.id} className="flex items-start gap-2 text-xs" data-testid={`attach-doc-${d.id}`}>
                      <Checkbox
                        checked={documentIds.includes(d.id)}
                        onCheckedChange={(v) =>
                          setDocumentIds((ids) => (v ? [...ids, d.id] : ids.filter((id) => id !== d.id)))
                        }
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="text-foreground">{d.documentName || d.fileName}</span>
                        <Badge variant="outline" className="ml-1.5 text-[10px] h-4 px-1">
                          {d.category}
                        </Badge>
                        {d.isInternalOnly && (
                          <Badge variant="outline" className="ml-1 text-[10px] h-4 px-1 gap-0.5 border-destructive text-destructive">
                            <Lock className="w-2.5 h-2.5" /> internal only
                          </Badge>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Shared documents</p>
              {globals.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  None uploaded yet — add them in Settings so everyone can attach the same file.
                </p>
              ) : (
                <div className="space-y-1">
                  {globals.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 text-xs" data-testid={`attach-global-${g.id}`}>
                      <Checkbox
                        checked={globalDocumentIds.includes(g.id)}
                        onCheckedChange={(v) =>
                          setGlobalDocumentIds((ids) => (v ? [...ids, g.id] : ids.filter((id) => id !== g.id)))
                        }
                      />
                      <span className="text-foreground">{g.name}</span>
                      <Badge variant="outline" className="text-[10px] h-4 px-1">{g.category}</Badge>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-1.5">From this computer</p>
              <Input
                type="file"
                multiple
                className="text-xs"
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                data-testid="input-send-files"
              />
              {files.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {files.map((f) => (
                    <span key={f.name} className="inline-flex items-center gap-1 text-xs border border-border rounded px-2 py-0.5">
                      {f.name}
                      <button onClick={() => setFiles((cur) => cur.filter((x) => x !== f))} aria-label={`Remove ${f.name}`}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {blockedSelection.length > 0 && (
              <p className="text-xs text-destructive" data-testid="text-internal-only-warning">
                {blockedSelection.map((d) => d.documentName || d.fileName).join(", ")} may only go to internal
                addresses. Sending to anyone outside will be refused.
              </p>
            )}
          </div>

          {error && (
            <div className="text-xs text-destructive whitespace-pre-wrap border border-destructive/40 rounded-md p-2" data-testid="text-send-error">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel-send">
              Cancel
            </Button>
            <Button
              onClick={() => {
                setError(null);
                send.mutate();
              }}
              disabled={!fromIdentityId || !to.trim() || !body.trim() || send.isPending}
              className="bg-brand text-brand-foreground gap-2"
              data-testid="button-submit-send"
            >
              {send.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {send.isPending ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
