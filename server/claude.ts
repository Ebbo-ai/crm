import Anthropic from "@anthropic-ai/sdk";
import { recordLlmCall } from "./llmUsage";
import { errorLabel } from "./logRedaction";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Identifies which mailbox/sync run triggered a call, for the cost guard's
 * per-mailbox breakdown. Optional and defaulted so call sites outside the
 * Gmail sync loop (a manual to-do note, the ad-hoc "process email" route)
 * don't have to know or care about mailbox attribution.
 */
export interface LlmUsageContext {
  mailbox?: string;
}

async function logUsage(ctx: LlmUsageContext | undefined, callType: string, model: string, response: Anthropic.Message): Promise<void> {
  await recordLlmCall({
    mailbox: ctx?.mailbox || "manual",
    callType,
    model,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  });
}

export interface ClientRef {
  id: number;
  clientCode: string;
  clientName: string;
  /** Every serving broker address for the client — a brokerage assigns more than one. */
  brokerEmails?: (string | null)[] | null;
  /**
   * Every serving broker contact by name.
   *
   * Email carries addresses, but a typed note carries first names: "Call
   * Annette about the Ware renewal" identifies a client only if the matcher
   * knows Annette Griffin serves it. Without names that note matches nothing.
   */
  brokerNames?: (string | null)[] | null;
  brokerFirmName?: string | null;
  adminContactName?: string | null;
  adminContactEmail?: string | null;
  decisionMakerName?: string | null;
  decisionMakerEmail?: string | null;
}

/**
 * One line per client, shared by both matchers so they cannot drift apart in
 * what they know about the book of business.
 */
function renderClientList(clients: ClientRef[]): string {
  return clients
    .map(c => {
      const join = (xs?: (string | null)[] | null) =>
        (xs ?? []).map(v => (v ?? "").trim()).filter(Boolean).join(", ");
      return [
        `ID:${c.id}`,
        `Code:${c.clientCode}`,
        `Name:${c.clientName}`,
        `Broker:${c.brokerFirmName ?? ""}`,
        `BrokerContacts:${join(c.brokerNames)}`,
        `BrokerEmails:${join(c.brokerEmails)}`,
        `AdminContact:${c.adminContactName ?? ""}`,
        `AdminEmail:${c.adminContactEmail ?? ""}`,
        `DecisionMaker:${c.decisionMakerName ?? ""}`,
        `DecisionMakerEmail:${c.decisionMakerEmail ?? ""}`,
      ].join(" | ");
    })
    .join("\n");
}

export interface MatchResult {
  clientId: number;
  confidence: "high" | "medium" | "low";
}

export interface ActionItem {
  description: string;
  kind?: "RENEWAL" | "SERVICE";
  dueDate?: string | null;
  /**
   * HIGH | MEDIUM | LOW — how urgent/substantive this request is. Feeds the
   * triage dashboard's tunable inclusion threshold (app_settings), which
   * compares this against a stored setting rather than filtering here, so
   * the bar can be raised or lowered later without re-running extraction.
   */
  priority: "HIGH" | "MEDIUM" | "LOW";
}

export interface EmailProcessResult {
  summary: string;
  actionItems: ActionItem[];
  /**
   * True when the sender is chasing something Simple already owed them. A
   * follow-up means we dropped something, so these rows are flagged red on the
   * dashboard rather than being left to blend in with ordinary mail.
   */
  isFollowUp: boolean;
  /** One short line naming the evidence, shown under the red row. */
  followUpReason: string | null;
}

export async function matchEmailToClients(
  emailText: string,
  clients: ClientRef[],
  usageCtx?: LlmUsageContext
): Promise<MatchResult[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];

  const clientList = renderClientList(clients);

  const prompt = `You are a CRM assistant for a dental/vision/hearing benefits TPA company called Simple Benefits (also known as 90 Degree Benefits).

Here is the list of clients in the database:
${clientList}

Here is an email that was forwarded to us:
---
${emailText.slice(0, 8000)}
---

Your job: identify which client(s) this email is about. Look for:
- Client names mentioned in the email body
- Group numbers like S-20, S-906, or just "Group 20"
- Broker firm names that match a client's broker
- Sender or recipient address appearing in a client's BrokerEmails. A client may list
  several people at the same brokerage; a match on any one of them counts equally.
- Email domain of sender matching a client's admin or decision maker email
- Any other clear references

Return ONLY a JSON array of matches. Each match: {"clientId": <number>, "confidence": "high"|"medium"|"low"}
- "high" = name or group number explicitly mentioned
- "medium" = broker or domain match
- "low" = inferred from context

If no clients match, return [].
Return ONLY the JSON array, no other text.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });
    await logUsage(usageCtx, "matchEmailToClients", "claude-haiku-4-5", response);

    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "[]";
    const parsed = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
    // The model occasionally echoes an id that was not in the list it was
    // given, or the same client twice. Both would fail on the foreign key when
    // the task is written, taking the whole ingest down with them.
    const known = new Set(clients.map(c => c.id));
    const seen = new Set<number>();
    const result: MatchResult[] = (Array.isArray(parsed) ? parsed : [])
      .map((m: any) => ({
        clientId: Number(m?.clientId),
        confidence: ["high", "medium", "low"].includes(m?.confidence) ? m.confidence : "low",
      }))
      .filter((m: MatchResult) => {
        if (!known.has(m.clientId) || seen.has(m.clientId)) return false;
        seen.add(m.clientId);
        return true;
      });
    if (result.length === 0) {
      console.log("[claude] matchEmailToClients: no clients matched");
    } else {
      console.log(`[claude] matchEmailToClients: matched ${result.length} client(s) —`, result.map((r: MatchResult) => `#${r.clientId} (${r.confidence})`).join(", "));
    }
    return result;
  } catch (err: any) {
    console.error(`[claude] matchEmailToClients error: ${errorLabel(err)}`);
    return [];
  }
}

/**
 * Reads a to-do Kim typed and works out which clients it is about.
 *
 * This is deliberately a different prompt from the email matcher even though it
 * sees the same book of business. A note is not an email: there is no sender,
 * no domain and no signature block, and the signal is almost always a bare
 * first name ("Annette"), a shortened client name ("Ware"), or a group number.
 * It also has to be comfortable returning nothing, because plenty of real work
 * belongs to the business rather than to an account.
 *
 * Returning [] is a normal answer, not a failure.
 */
export async function matchTextToClients(
  noteText: string,
  clients: ClientRef[],
  usageCtx?: LlmUsageContext
): Promise<MatchResult[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const text = noteText.trim();
  if (!text) return [];

  const prompt = `You are a CRM assistant for a dental/vision/hearing benefits TPA called Simple Benefits (also known as 90 Degree Benefits).

Here is the list of clients in the database:
${renderClientList(clients)}

A service rep has typed herself a quick to-do note. It was not an email; it is
usually a phone call or a conversation she is trying not to forget:
---
${text.slice(0, 2000)}
---

Your job: identify which client account(s), if any, this note is about.

Signals that count:
- A client name, including a shortened or partial form. "Ware" for "Ware County", "Thomas" for "Thomas County".
- A group number like S-46, S-455, or "group 20".
- A broker firm name.
- A person's first name that matches one of a client's BrokerContacts, AdminContact or DecisionMaker. A bare first name is the most common case: "Call Annette" means the Annette listed on those accounts. If that first name serves several clients, only return the ones the rest of the note actually points at.
- An email address matching BrokerEmails, AdminEmail or DecisionMakerEmail.

Rules:
- A note can be about MORE THAN ONE client. "Call Annette to discuss the Ware and Thomas renewals" is about both Ware County and Thomas County. Return every client the note genuinely covers.
- A note can be about NO client. Internal work, a vendor, a process discussion, an ID card design, a conversation with 90 Degree about how something is done: these belong to the business, not to an account. Return [] for those. This is a correct answer and is expected often.
- Do not reach. A person's name that matches nothing, or a topic that merely sounds like benefits work, is not a match. Guessing wrongly is worse than returning nothing, because a wrong client puts the work on the wrong record.

Return ONLY a JSON array. Each match: {"clientId": <number>, "confidence": "high"|"medium"|"low"}
- "high" = the client name or group number is in the note
- "medium" = a broker contact name, broker firm or contact email identifies it
- "low" = inferred from surrounding context

Return ONLY the JSON array, no other text.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });
    await logUsage(usageCtx, "matchTextToClients", "claude-haiku-4-5", response);

    const raw = response.content[0].type === "text" ? response.content[0].text.trim() : "[]";
    const parsed = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
    const known = new Set(clients.map(c => c.id));
    // The model occasionally echoes an id that is not in the list it was given.
    // Anything unrecognised is dropped rather than attached to the wrong record.
    const result: MatchResult[] = (Array.isArray(parsed) ? parsed : [])
      .filter((m: any) => known.has(Number(m?.clientId)))
      .map((m: any) => ({
        clientId: Number(m.clientId),
        confidence: ["high", "medium", "low"].includes(m?.confidence) ? m.confidence : "low",
      }));

    console.log(
      result.length === 0
        ? "[claude] matchTextToClients: no clients matched — general to-do"
        : `[claude] matchTextToClients: matched ${result.length} client(s) — ${result.map(r => `#${r.clientId} (${r.confidence})`).join(", ")}`
    );
    return result;
  } catch (err: any) {
    console.error(`[claude] matchTextToClients error: ${errorLabel(err)}`);
    return [];
  }
}

export async function processEmail(
  emailText: string,
  attachmentTexts: string[],
  usageCtx?: LlmUsageContext,
  sentDate?: string | Date
): Promise<EmailProcessResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      summary: "AI processing unavailable — no API key configured.",
      actionItems: [],
      isFollowUp: false,
      followUpReason: null,
    };
  }

  const attachmentSection = attachmentTexts.length > 0
    ? `\n\nATTACHMENT CONTENTS:\n${attachmentTexts.map((t, i) => `[Attachment ${i + 1}]\n${t.slice(0, 3000)}`).join("\n\n")}`
    : "";

  const prompt = `Current date: ${new Date().toISOString().slice(0,10)}. Message sent date: ${sentDate ? new Date(sentDate).toISOString() : "unknown; do not guess a year"}.
Resolve relative deadlines against the message sent date. Return null when the due date cannot be established.
For each action item include kind: RENEWAL for renewal proposals, acceptance forms, renewal transmittals and renewal handouts; SERVICE for other work, including claims and run-out service.
You are an assistant for Simple Benefits, a dental/vision/hearing benefits TPA company. A staff member has forwarded this email for tracking in the client management system.

EMAIL:
---
${emailText.slice(0, 6000)}${attachmentSection}
---

Please provide:
1. A concise 2-4 sentence SUMMARY of this email's main topic, any requests made, and any important details for the benefits team.
2. A list of ACTION ITEMS — any follow-up tasks, deadlines, or requests that need attention.
   For each one, rate its PRIORITY:
   - HIGH: time-sensitive or consequential — a deadline, a renewal decision, a client escalation, money.
   - MEDIUM: a real request that needs a reply or action, but nothing urgent or high-stakes.
   - LOW: minor, routine, or easily batched (an FYI that technically implies a small follow-up, a courtesy acknowledgment).
3. A judgement on whether this email is a FOLLOW-UP: the sender chasing something
   Simple Benefits already owed them and did not deliver.

On the follow-up judgement, read for intent rather than matching words. It is a
follow-up when the sender is re-asking, waiting, or nudging — for example
"just checking in", "following up on my email below", "I didn't get this form",
"still waiting on the renewal", "any update?", "circling back", "second request",
a forwarded copy of their own earlier unanswered message, or a polite reminder
that a deadline is approaching on something they already asked us for.

It is NOT a follow-up when the sender is making a brand new request, replying
helpfully to something we asked them for, sending documents we requested,
confirming or acknowledging something, or continuing a conversation that is
moving along normally. A reply that answers our question is not a follow-up
even if it quotes earlier mail underneath.

Be conservative. Flagging ordinary mail red trains the reader to ignore red.
When it is genuinely ambiguous, return false.

Return ONLY valid JSON in this exact format:
{
  "summary": "...",
  "actionItems": [
    {"description": "...", "dueDate": "YYYY-MM-DD or null", "priority": "HIGH" or "MEDIUM" or "LOW"}
  ],
  "isFollowUp": true or false,
  "followUpReason": "one short sentence naming the specific evidence, or null"
}

If there are no action items, return an empty array. Extract real due dates if mentioned; otherwise use null.
Set followUpReason to null whenever isFollowUp is false.
Return ONLY the JSON object, no other text.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    await logUsage(usageCtx, "processEmail", "claude-sonnet-4-5", response);

    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { summary: text || "Could not parse summary.", actionItems: [], isFollowUp: false, followUpReason: null };
    }
    const parsed = JSON.parse(jsonMatch[0]);
    const isFollowUp = parsed.isFollowUp === true;
    const rawItems = Array.isArray(parsed.actionItems) ? parsed.actionItems : [];
    const actionItems: ActionItem[] = rawItems.map((it: any) => ({
      description: String(it?.description ?? "").trim(),
      kind: it?.kind === "RENEWAL" ? "RENEWAL" : "SERVICE",
      dueDate: it?.dueDate ?? null,
      priority: (["HIGH", "MEDIUM", "LOW"].includes(it?.priority) ? it.priority : "MEDIUM") as ActionItem["priority"],
    })).filter((it: ActionItem) => it.description.length > 0);
    return {
      summary: parsed.summary ?? "No summary generated.",
      actionItems,
      isFollowUp,
      // A reason without a flag is noise, so it is only kept when the flag is set.
      followUpReason: isFollowUp && typeof parsed.followUpReason === "string" && parsed.followUpReason.trim()
        ? parsed.followUpReason.trim()
        : null,
    };
  } catch (err: any) {
    console.error(`[claude] processEmail error: ${errorLabel(err)}`);
    return { summary: "Error processing email with AI.", actionItems: [], isFollowUp: false, followUpReason: null };
  }
}

/**
 * Judges whether a mailbox message is genuine work correspondence at all,
 * for threads that matched no client. Without this, every newsletter,
 * calendar invite, marketing blast, and receipt in the mailbox would sit in
 * the "Unassigned" queue forever waiting for a human to dismiss it by hand.
 *
 * Conservative in the other direction from matchEmailToClients: when in
 * doubt this returns true (business), since the cost of a stray marketing
 * email in Unassigned is a click to dismiss, but the cost of burying a real
 * client message under "Not business" is a dropped request.
 */
export async function classifyMailRelevance(
  fromEmail: string,
  subject: string,
  bodyExcerpt: string,
  usageCtx?: LlmUsageContext,
): Promise<{ isBusiness: boolean }> {
  if (!process.env.ANTHROPIC_API_KEY) return { isBusiness: true };

  const prompt = `You triage mail for a benefits TPA's shared work mailbox. Decide whether this message is genuine business correspondence (about a client, a renewal, a broker, an internal work matter) or not (a newsletter, marketing email, automated receipt/confirmation, calendar notification spam, or personal mail unrelated to the business).

From: ${fromEmail}
Subject: ${subject}

Body excerpt:
---
${bodyExcerpt.slice(0, 1500)}
---

Return ONLY JSON: {"isBusiness": true or false}
When genuinely unsure, return true.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 64,
      messages: [{ role: "user", content: prompt }],
    });
    await logUsage(usageCtx, "classifyMailRelevance", "claude-haiku-4-5", response);
    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "{}";
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    return { isBusiness: parsed.isBusiness !== false };
  } catch (err: any) {
    console.error(`[claude] classifyMailRelevance error: ${errorLabel(err)}`);
    return { isBusiness: true };
  }
}

/**
 * One call per unique counterparty domain (not per thread/message) — the
 * verdict is then applied to every thread from that domain. Subjects are a
 * handful of samples across that domain's threads, giving the model enough
 * signal to tell a real business counterparty (employer, broker, TPA vendor)
 * from consumer/newsletter/marketing traffic without reading any bodies.
 */
export async function classifyDomain(
  domain: string,
  sampleSubjects: string[],
  usageCtx?: LlmUsageContext,
): Promise<{ verdict: "BUSINESS" | "CONSUMER" }> {
  if (!process.env.ANTHROPIC_API_KEY) return { verdict: "BUSINESS" };

  const prompt = `You triage the sender domains found in a benefits broker's inbox. For the domain below, decide whether it represents a genuine business counterparty (an employer/client, an insurance broker, a TPA or benefits vendor, a carrier) or non-business traffic (a retailer, a newsletter, a subscription service, a consumer app, personal-interest mail).

Domain: ${domain}

Sample subject lines seen from this domain:
${sampleSubjects.slice(0, 15).map((s) => `- ${s}`).join("\n") || "(no subjects available)"}

Return ONLY JSON: {"verdict": "BUSINESS" or "CONSUMER"}
When genuinely unsure, return "BUSINESS" — the cost of over-including is a thread staying unassigned for a person to look at; the cost of under-including is losing real correspondence.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 32,
      messages: [{ role: "user", content: prompt }],
    });
    await logUsage(usageCtx, "classifyDomain", "claude-haiku-4-5", response);
    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "{}";
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    return { verdict: parsed.verdict === "CONSUMER" ? "CONSUMER" : "BUSINESS" };
  } catch (err: any) {
    console.error(`[claude] classifyDomain error: ${errorLabel(err)}`);
    return { verdict: "BUSINESS" };
  }
}

/**
 * Per-thread classification for the free-mail-provider bucket (gmail.com,
 * yahoo.com, etc.) where a domain rule would be meaningless — a free
 * address can't be classified by who it's from, only by what the thread
 * is about. One call per thread, not batched by domain, since each one is
 * a different person.
 */
export async function classifyThread(
  counterpartyEmail: string,
  subject: string | null,
  usageCtx?: LlmUsageContext,
): Promise<{ verdict: "BUSINESS" | "CONSUMER" }> {
  if (!process.env.ANTHROPIC_API_KEY) return { verdict: "BUSINESS" };

  const prompt = `You triage one email thread from a benefits broker's inbox. The counterparty is on a free mail provider (gmail.com, yahoo.com, etc.), so their domain tells you nothing — judge only from the subject line whether this is a genuine business conversation (an employer contact, a broker, a vendor, a client using a personal address) or non-business traffic (a personal/social email, a consumer purchase, a newsletter that slipped through).

Counterparty address: ${counterpartyEmail}
Subject line: ${subject || "(no subject)"}

Return ONLY JSON: {"verdict": "BUSINESS" or "CONSUMER"}
When genuinely unsure, return "BUSINESS" — the cost of over-including is a thread staying unassigned for a person to look at; the cost of under-including is losing real correspondence.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 32,
      messages: [{ role: "user", content: prompt }],
    });
    await logUsage(usageCtx, "classifyThread", "claude-haiku-4-5", response);
    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "{}";
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    return { verdict: parsed.verdict === "CONSUMER" ? "CONSUMER" : "BUSINESS" };
  } catch (err: any) {
    console.error(`[claude] classifyThread error: ${errorLabel(err)}`);
    return { verdict: "BUSINESS" };
  }
}

export interface ThreadSummaryResult {
  summary: string;
  oneLine: string;
}

/**
 * One structured summary per thread, regenerated whenever a new message
 * lands on it. Read for the side panel while scanning a long email, so it
 * has to answer the questions a reader actually has: who wants what, what
 * was asked, what's due when, what dollar figures are on the table, and
 * whether we owe a reply.
 */
export async function generateThreadSummary(
  subject: string,
  messages: { fromName: string | null; fromEmail: string; sentAt: string; bodyText: string }[],
  usageCtx?: LlmUsageContext,
): Promise<ThreadSummaryResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const thread = messages
    .map((m, i) => `[${i + 1}] ${m.fromName || m.fromEmail} (${m.sentAt}):\n${m.bodyText.slice(0, 2000)}`)
    .join("\n\n");

  const prompt = `Summarize this email thread for a benefits account manager who needs to scan it quickly rather than reread it.

Subject: ${subject}

${thread.slice(0, 12000)}

Write a short structured summary covering, only where present:
- Who wants what
- Any questions asked that need an answer
- Any deadlines or dates mentioned
- Any dollar amounts, rates, or figures mentioned
- What action (if any) is needed from us, and by whom

Keep it tight — a few bullet points, not a re-narration of the thread. Omit any section with nothing to say.

Return ONLY JSON:
{"summary": "...", "oneLine": "one short sentence for a list view, the single most important thing about this thread"}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });
    await logUsage(usageCtx, "generateThreadSummary", "claude-haiku-4-5", response);
    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    if (!parsed.summary) return null;
    return { summary: String(parsed.summary), oneLine: String(parsed.oneLine || parsed.summary).slice(0, 200) };
  } catch (err: any) {
    console.error(`[claude] generateThreadSummary error: ${errorLabel(err)}`);
    return null;
  }
}

/**
 * Checks a freshly-created task's description against the client's other
 * still-open tasks to see whether it is really the same job surfacing again —
 * either the same thread producing a near-duplicate action item, or a
 * different thread raising the same underlying ask (e.g. two people both
 * asking to schedule the same kickoff call).
 *
 * Returns the id of the existing task to group with, or null when this is
 * genuinely new work. Conservative on purpose: grouping two unrelated tasks
 * together would hide one of them from the person who owns it.
 */
export async function findDuplicateTask(
  newDescription: string,
  candidates: { id: number; description: string }[],
): Promise<number | null> {
  if (!process.env.ANTHROPIC_API_KEY || candidates.length === 0) return null;

  const list = candidates.map(c => `${c.id}: ${c.description}`).join("\n");
  const prompt = `A new to-do was just created for a client:
"${newDescription}"

Here are that same client's other still-open to-dos, each on its own line as "id: description":
${list}

Is the new to-do the SAME underlying piece of work as one of these — the same job, meeting, document, or ask, just phrased differently or extracted from a different email? Not merely "related to the same client" — it must be the same specific action.

Return ONLY valid JSON: {"duplicateOf": <id> or null}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const id = parsed.duplicateOf;
    if (typeof id === "number" && candidates.some(c => c.id === id)) return id;
    return null;
  } catch (err: any) {
    console.error(`[claude] findDuplicateTask error: ${errorLabel(err)}`);
    return null; // fail open — never block task creation on a dedup check
  }
}

/**
 * Transcribes a scanned/image-only page using Claude's vision. Only called
 * when a PDF's native text layer comes back empty or near-empty — this is
 * the fallback path, not the default, so it should stay rare and cheap.
 */
export async function ocrPageImage(pngBuffer: Buffer, pageLabel: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return "";
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: pngBuffer.toString("base64") },
            },
            {
              type: "text",
              text: `Transcribe every piece of text visible on this scanned document page (${pageLabel}) exactly as written, including table contents, labels, and numbers. Preserve table structure using plain-text rows. Output only the transcription, no commentary.`,
            },
          ],
        },
      ],
    });
    return response.content[0].type === "text" ? response.content[0].text : "";
  } catch (err: any) {
    console.error(`[claude] ocrPageImage error: ${errorLabel(err)}`);
    return "";
  }
}

export interface FieldProposal {
  fieldKey: string;
  fieldLabel: string;
  proposedValue: string;
  sourceLocation: string;
}

/**
 * Reads a filed document's extracted text (a PPR, renewal letter, or rate
 * sheet from 90 Degree Benefits) and proposes structured field values.
 * Returns proposals only — nothing here writes to the client/plan/renewal
 * record. Every proposal must cite where in the document it came from so the
 * reviewer can verify it without reopening the source file.
 */
export async function extractDocumentFields(
  documentText: string,
  documentCategory: string,
  clientName: string,
): Promise<FieldProposal[]> {
  if (!process.env.ANTHROPIC_API_KEY || !documentText.trim()) return [];

  const prompt = `You are reading a "${documentCategory}" document from 90 Degree Benefits for client "${clientName}".

Document text:
---
${documentText.slice(0, 30000)}
---

Extract every concrete data field this document reports that would matter to a benefits account manager: things like renewal effective date, admin fee, funding basis, rate changes per tier, loss ratio, claims totals, broker compensation, plan year dates. Only extract values actually present in the text — never infer or guess a value that isn't written down.

For each field, report:
- fieldKey: a short camelCase identifier (e.g. "renewalEffectiveDate", "adminFee", "lossRatio")
- fieldLabel: a human-readable label (e.g. "Renewal effective date", "Admin fee (all-in)")
- proposedValue: the value as written in the document (keep original formatting, e.g. "$12.50 PEPM" or "October 1, 2026")
- sourceLocation: exactly where this appears (e.g. "Page 2, Renewal Summary table" or "Row labeled 'Total Admin Fee'")

Return ONLY valid JSON: {"fields": [{"fieldKey": "...", "fieldLabel": "...", "proposedValue": "...", "sourceLocation": "..."}]}
If nothing extractable is present, return {"fields": []}.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return [];
    let parsed: any;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      // The field list got cut off mid-element (long document, token limit). Salvage the
      // complete field objects instead of discarding every proposal Claude already found.
      const fieldMatches = Array.from(text.matchAll(/\{\s*"fieldKey"[\s\S]*?\}(?=\s*[,\]])/g));
      parsed = { fields: fieldMatches.map((m) => { try { return JSON.parse(m[0]); } catch { return null; } }).filter(Boolean) };
    }
    if (!Array.isArray(parsed.fields)) return [];
    return parsed.fields.filter((f: any) => f?.fieldKey && f?.proposedValue);
  } catch (err: any) {
    console.error(`[claude] extractDocumentFields error: ${errorLabel(err)}`);
    return [];
  }
}

export async function queryClientCommunications(
  question: string,
  communications: { subject: string | null; claudeSummary: string | null; receivedAt: Date; senderName: string | null; senderEmail: string }[]
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return "AI queries are unavailable — no API key configured.";
  }
  if (communications.length === 0) {
    return "No communications found to search through.";
  }

  const commList = communications
    .map((c, i) => `[${i + 1}] Date: ${new Date(c.receivedAt).toLocaleDateString()} | From: ${c.senderName ?? c.senderEmail} | Subject: ${c.subject ?? "(no subject)"}\nSummary: ${c.claudeSummary ?? "(not summarized)"}`)
    .join("\n\n");

  const prompt = `You are an assistant for Simple Benefits, a dental/vision/hearing benefits TPA.

Here are the stored email communications:
---
${commList.slice(0, 12000)}
---

User question: ${question}

Answer the question based on the communications above. Be specific — reference dates, senders, and key details. If the information isn't in the communications, say so clearly.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    return response.content[0].type === "text" ? response.content[0].text : "No response generated.";
  } catch {
    return "Error querying communications.";
  }
}
