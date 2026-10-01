// Builds the owner alert for a failed scheduled job. Error text can come from
// a database or provider, so the alert hides email addresses and long digit
// strings (IBANs, card or phone numbers) and never includes a stack trace.
const FOOTER = "Open the Cloudflare Workers logs for details.";

function safeText(value: string, maxLength: number): string {
  const cleaned = value
    .split("\n")
    .filter((line) => !line.trim().startsWith("at "))
    .join(" ")
    .replace(/[^\s@]+@[^\s@]+/g, "[email]")
    .replace(/\d[\d\s-]{8,}\d/g, "[number]")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "unknown error").slice(0, maxLength);
}

export interface SchedulerAlertResult {
  organizationId?: string;
  error?: string;
  failedSends?: number;
}

export function isSchedulerFailure(results: SchedulerAlertResult[]): boolean {
  return results.some((r) => Boolean(r.error) || (r.failedSends ?? 0) > 0);
}

export function buildSchedulerAlert(
  results: SchedulerAlertResult[] | null,
  thrown?: unknown
): { subject: string; text: string } {
  const subject = "Namkopa: scheduled job failed";

  if (thrown !== undefined && thrown !== null) {
    const message = safeText(
      thrown instanceof Error ? thrown.message : "unknown error",
      300
    );
    return {
      subject,
      text: [`The job stopped with an error: ${message}`, FOOTER].join("\n"),
    };
  }

  const all = results ?? [];
  const failed = all.filter(
    (r) => Boolean(r.error) || (r.failedSends ?? 0) > 0
  );
  const lines = [`${failed.length} of ${all.length} organizations failed.`];

  const maxLines = 10;
  for (const item of failed.slice(0, maxLines)) {
    const orgId = item.organizationId ?? "unknown";
    const parts: string[] = [];
    if (item.error) parts.push(safeText(item.error, 200));
    if ((item.failedSends ?? 0) > 0) {
      parts.push(`${item.failedSends} invoice(s) were not delivered`);
    }
    lines.push(`Organization ${orgId}: ${parts.join(". ")}`);
  }
  if (failed.length > maxLines) {
    lines.push(`and ${failed.length - maxLines} more`);
  }
  lines.push(FOOTER);

  return { subject, text: lines.join("\n") };
}
