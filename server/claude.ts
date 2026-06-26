import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ClientRef {
  id: number;
  clientCode: string;
  clientName: string;
  brokerEmail?: string | null;
  brokerFirmName?: string | null;
  adminContactEmail?: string | null;
  decisionMakerEmail?: string | null;
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
}

export async function matchEmailToClients(
  emailText: string,
  clients: ClientRef[]
): Promise<MatchResult[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];

  const clientList = clients
    .map(c => `ID:${c.id} | Code:${c.clientCode} | Name:${c.clientName} | Broker:${c.brokerFirmName ?? ""} | BrokerEmail:${c.brokerEmail ?? ""} | AdminEmail:${c.adminContactEmail ?? ""}`)
    .join("\n");

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
    const parsed = JSON.parse(text.match(/\[.*\]/s)?.[0] ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function processEmail(
  emailText: string,
  attachmentTexts: string[]
): Promise<EmailProcessResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { summary: "AI processing unavailable — no API key configured.", actionItems: [] };
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

Return ONLY valid JSON in this exact format:
{
  "summary": "...",
  "actionItems": [
    {"description": "...", "dueDate": "YYYY-MM-DD or null"}
  ]
}

If there are no action items, return an empty array. Extract real due dates if mentioned; otherwise use null.
Return ONLY the JSON object, no other text.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { summary: text || "Could not parse summary.", actionItems: [] };
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      summary: parsed.summary ?? "No summary generated.",
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
    };
  } catch (err) {
    return { summary: "Error processing email with AI.", actionItems: [] };
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
