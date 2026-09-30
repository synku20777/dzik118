// Reads the JSON that Amazon SES publishes through an SNS topic. Two shapes
// exist: event publishing through a configuration set (`eventType`) and
// identity notifications (`notificationType`). Both carry the same bounce and
// complaint fields. Only two outcomes matter for sending:
// - a permanent bounce: the address does not exist or refuses mail;
// - a complaint: the person marked the email as spam.
// A temporary (transient) bounce, a delivery, and every other event are
// ignored, because the next send can still work.
export interface SuppressionEvent {
  reason: "BOUNCE" | "COMPLAINT";
  emails: string[];
  detail: string;
}

interface SesMessage {
  eventType?: string;
  notificationType?: string;
  bounce?: {
    bounceType?: string;
    bounceSubType?: string;
    bouncedRecipients?: { emailAddress?: string }[];
  };
  complaint?: {
    complaintFeedbackType?: string;
    complainedRecipients?: { emailAddress?: string }[];
  };
}

function cleanEmails(list: { emailAddress?: string }[] | undefined): string[] {
  const emails = (list ?? [])
    .map((entry) => (entry.emailAddress ?? "").trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  return [...new Set(emails)];
}

export function parseSesMessage(message: unknown): SuppressionEvent | null {
  const parsed: SesMessage | null =
    typeof message === "string"
      ? safeParse(message)
      : typeof message === "object"
        ? (message as SesMessage)
        : null;
  if (!parsed) return null;

  const type = parsed.eventType ?? parsed.notificationType;
  if (type === "Bounce" && parsed.bounce?.bounceType === "Permanent") {
    const emails = cleanEmails(parsed.bounce.bouncedRecipients);
    if (emails.length === 0) return null;
    return {
      reason: "BOUNCE",
      emails,
      detail:
        `Permanent bounce${parsed.bounce.bounceSubType ? `: ${parsed.bounce.bounceSubType}` : ""}`.slice(
          0,
          200
        ),
    };
  }
  if (type === "Complaint") {
    const emails = cleanEmails(parsed.complaint?.complainedRecipients);
    if (emails.length === 0) return null;
    return {
      reason: "COMPLAINT",
      emails,
      detail:
        `Complaint${parsed.complaint?.complaintFeedbackType ? `: ${parsed.complaint.complaintFeedbackType}` : ""}`.slice(
          0,
          200
        ),
    };
  }
  return null;
}

function safeParse(text: string): SesMessage | null {
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null ? value : null;
  } catch {
    return null;
  }
}
