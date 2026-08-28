import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
  dueDate?: string | null;
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
  clients: ClientRef[]
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
    console.error("[claude] matchEmailToClients error:", err?.message || String(err));
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
  clients: ClientRef[]
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
    console.error("[claude] matchTextToClients error:", err?.message || String(err));
    return [];
  }
}

export async function processEmail(
  emailText: string,
  attachmentTexts: string[]
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

  const prompt = `You are an assistant for Simple Benefits, a dental/vision/hearing benefits TPA company. A staff member has forwarded this email for tracking in the client management system.

EMAIL:
---
${emailText.slice(0, 6000)}${attachmentSection}
---

Please provide:
1. A concise 2-4 sentence SUMMARY of this email's main topic, any requests made, and any important details for the benefits team.
2. A list of ACTION ITEMS — any follow-up tasks, deadlines, or requests that need attention.
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
    {"description": "...", "dueDate": "YYYY-MM-DD or null"}
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

    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { summary: text || "Could not parse summary.", actionItems: [], isFollowUp: false, followUpReason: null };
    }
    const parsed = JSON.parse(jsonMatch[0]);
    const isFollowUp = parsed.isFollowUp === true;
    return {
      summary: parsed.summary ?? "No summary generated.",
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      isFollowUp,
      // A reason without a flag is noise, so it is only kept when the flag is set.
      followUpReason: isFollowUp && typeof parsed.followUpReason === "string" && parsed.followUpReason.trim()
        ? parsed.followUpReason.trim()
        : null,
    };
  } catch (err: any) {
    console.error("[claude] processEmail error:", err?.message || String(err));
    return { summary: "Error processing email with AI.", actionItems: [], isFollowUp: false, followUpReason: null };
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
