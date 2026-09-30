// ADR 0009 - personal data export. One JSON object with the data the app holds
// about one person. Two callers: an admin exports a person of their own
// organization, and a resident exports themself.
//
// Every query lists its columns. Never use select() or a spread here: a column
// added to a table later must not reach an export by default. Never include
// token hashes, bank payer account numbers, raw bank rows, ledger metadata or
// idempotency keys, internal notes, admin reasons, request IDs, IP hashes, the
// email of another person, or any dwelling the person cannot access.
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { DbOrTx } from "../../db/client";
import {
  accountEntries,
  paymentAllocations,
  paymentReversals,
} from "../../db/schema/accounts";
import { auditLogs } from "../../db/schema/audit";
import { appUsers } from "../../db/schema/auth";
import { billingPeriods, meterReadings } from "../../db/schema/billing";
import { dwellingAccess, dwellings, meters } from "../../db/schema/dwellings";
import {
  invoiceDeliveries,
  invoiceLines,
  invoices,
} from "../../db/schema/invoices";
import { conversations, messages } from "../../db/schema/messaging";
import { organizations } from "../../db/schema/organizations";
import { bankTransactions } from "../../db/schema/payments";
import { recordAuditEvent } from "../../lib/logging/audit";
import { NotFoundError } from "../errors";

export { NotFoundError };

export interface ExportPersonInput {
  userId: string;
  // An admin export is limited to one organization. null means the person
  // exports themself, across every organization that is not archived.
  organizationId: string | null;
  actorUserId: string;
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const list = map.get(key(row));
    if (list) list.push(row);
    else map.set(key(row), [row]);
  }
  return map;
}

export async function exportPersonData(db: DbOrTx, input: ExportPersonInput) {
  const { userId, organizationId, actorUserId } = input;

  const [person] = await db
    .select({
      email: appUsers.emailSnapshot,
      displayName: appUsers.displayName,
      disabledAt: appUsers.disabledAt,
      createdAt: appUsers.createdAt,
    })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  if (!person) throw new NotFoundError("Person not found");
  const ownEmail = person.email.trim().toLowerCase();
  // An address that belongs to someone else is never exported.
  const ownOnly = (email: unknown): string | null =>
    typeof email === "string" && email.trim().toLowerCase() === ownEmail
      ? email
      : null;

  // The scope is the person's own dwelling access. The query starts from
  // dwelling_access, so a dwelling the person cannot access is never read.
  const scope = await db
    .select({
      dwellingId: dwellings.id,
      organizationId: dwellings.organizationId,
      organizationName: organizations.name,
      number: dwellings.number,
      displayName: dwellings.displayName,
      occupantName: dwellings.occupantName,
      billingName: dwellings.billingName,
      billingEmail: dwellings.billingEmail,
      billingAddress: dwellings.billingAddress,
      invoiceByEmail: dwellings.invoiceByEmail,
      invoiceByPaper: dwellings.invoiceByPaper,
      areaM2: dwellings.areaM2,
      residentCount: dwellings.residentCount,
      accessSince: dwellingAccess.createdAt,
    })
    .from(dwellingAccess)
    .innerJoin(dwellings, eq(dwellings.id, dwellingAccess.dwellingId))
    .innerJoin(organizations, eq(organizations.id, dwellings.organizationId))
    .where(
      and(
        eq(dwellingAccess.userId, userId),
        organizationId
          ? eq(dwellings.organizationId, organizationId)
          : isNull(organizations.archivedAt)
      )
    );
  // Same answer for "no such person" and "person of another organization".
  if (organizationId && scope.length === 0) {
    throw new NotFoundError("Person not found");
  }

  const dwellingIds = scope.map((d) => d.dwellingId);
  const organizationIds = [...new Set(scope.map((d) => d.organizationId))];
  const inScope = dwellingIds.length > 0;

  const invoiceRows = inScope
    ? await db
        .select({
          id: invoices.id,
          dwellingId: invoices.dwellingId,
          invoiceNumber: invoices.invoiceNumber,
          issueDate: invoices.issueDate,
          dueDate: invoices.dueDate,
          currency: invoices.currency,
          subtotal: invoices.subtotal,
          vatTotal: invoices.vatTotal,
          total: invoices.total,
          previousOutstanding: invoices.previousOutstanding,
          lateFeeApplied: invoices.lateFeeApplied,
          amountDue: invoices.amountDue,
          sentAt: invoices.sentAt,
          paidAt: invoices.paidAt,
          recipientSnapshot: invoices.recipientSnapshot,
        })
        .from(invoices)
        .where(
          and(
            inArray(invoices.dwellingId, dwellingIds),
            isNotNull(invoices.sentAt)
          )
        )
        .orderBy(asc(invoices.issueDate))
    : [];
  const invoiceIds = invoiceRows.map((i) => i.id);

  const [lines, deliveries] = invoiceIds.length
    ? await Promise.all([
        db
          .select({
            invoiceId: invoiceLines.invoiceId,
            description: invoiceLines.description,
            unit: invoiceLines.unit,
            quantity: invoiceLines.quantity,
            unitPrice: invoiceLines.unitPrice,
            vatRate: invoiceLines.vatRate,
            netAmount: invoiceLines.netAmount,
            vatAmount: invoiceLines.vatAmount,
            grossAmount: invoiceLines.grossAmount,
          })
          .from(invoiceLines)
          .where(inArray(invoiceLines.invoiceId, invoiceIds))
          .orderBy(asc(invoiceLines.sortOrder)),
        db
          .select({
            invoiceId: invoiceDeliveries.invoiceId,
            method: invoiceDeliveries.method,
            status: invoiceDeliveries.status,
            sentAt: invoiceDeliveries.sentAt,
            destinationEmail: invoiceDeliveries.destinationEmail,
          })
          .from(invoiceDeliveries)
          .where(inArray(invoiceDeliveries.invoiceId, invoiceIds))
          .orderBy(asc(invoiceDeliveries.createdAt)),
      ])
    : [[], []];

  const [
    allocationRows,
    reversalRows,
    ledgerRows,
    readingRows,
    conversationRows,
  ] = inScope
    ? await Promise.all([
        db
          .select({
            dwellingId: paymentAllocations.dwellingId,
            allocationDate: paymentAllocations.allocationDate,
            allocatedAmount: paymentAllocations.allocatedAmount,
            method: paymentAllocations.method,
            invoiceNumber: invoices.invoiceNumber,
            bookingDate: bankTransactions.bookingDate,
            currency: bankTransactions.currency,
            payerName: bankTransactions.payerName,
            reference: bankTransactions.reference,
          })
          .from(paymentAllocations)
          .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
          .innerJoin(
            bankTransactions,
            eq(bankTransactions.id, paymentAllocations.bankTransactionId)
          )
          .where(inArray(paymentAllocations.dwellingId, dwellingIds))
          .orderBy(asc(paymentAllocations.allocationDate)),
        db
          .select({
            dwellingId: paymentReversals.dwellingId,
            reversedAt: paymentReversals.createdAt,
            reversedAllocationAmount: paymentReversals.reversedAllocationAmount,
            reversedCreditAmount: paymentReversals.reversedCreditAmount,
            invoiceNumber: invoices.invoiceNumber,
            bookingDate: bankTransactions.bookingDate,
          })
          .from(paymentReversals)
          .innerJoin(invoices, eq(invoices.id, paymentReversals.invoiceId))
          .innerJoin(
            bankTransactions,
            eq(bankTransactions.id, paymentReversals.bankTransactionId)
          )
          .where(inArray(paymentReversals.dwellingId, dwellingIds))
          .orderBy(asc(paymentReversals.createdAt)),
        db
          .select({
            dwellingId: accountEntries.dwellingId,
            effectiveDate: accountEntries.effectiveDate,
            type: accountEntries.type,
            debit: accountEntries.debit,
            credit: accountEntries.credit,
            currency: accountEntries.currency,
            description: accountEntries.description,
          })
          .from(accountEntries)
          .where(inArray(accountEntries.dwellingId, dwellingIds))
          .orderBy(
            asc(accountEntries.effectiveDate),
            asc(accountEntries.createdAt)
          ),
        db
          .select({
            dwellingId: meters.dwellingId,
            meterType: meters.type,
            meterLabel: meters.label,
            serialNumber: meters.serialNumber,
            unit: meters.unit,
            year: billingPeriods.year,
            month: billingPeriods.month,
            previousValue: meterReadings.previousValue,
            currentValue: meterReadings.currentValue,
            consumption: meterReadings.consumption,
            source: meterReadings.source,
            submittedAt: meterReadings.submittedAt,
          })
          .from(meterReadings)
          .innerJoin(meters, eq(meters.id, meterReadings.meterId))
          .innerJoin(
            billingPeriods,
            eq(billingPeriods.id, meterReadings.periodId)
          )
          .where(inArray(meters.dwellingId, dwellingIds))
          .orderBy(asc(billingPeriods.year), asc(billingPeriods.month)),
        db
          .select({
            id: conversations.id,
            dwellingId: conversations.dwellingId,
            subject: conversations.subject,
            status: conversations.status,
            createdAt: conversations.createdAt,
          })
          .from(conversations)
          .where(inArray(conversations.dwellingId, dwellingIds))
          .orderBy(asc(conversations.createdAt)),
      ])
    : [[], [], [], [], []];

  const conversationIds = conversationRows.map((c) => c.id);
  const messageRows = conversationIds.length
    ? await db
        .select({
          conversationId: messages.conversationId,
          senderUserId: messages.senderUserId,
          senderRole: messages.senderRole,
          body: messages.body,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(inArray(messages.conversationId, conversationIds))
        .orderBy(asc(messages.createdAt))
    : [];

  // What the person did in the app. Action, kind of record and time only.
  const auditRows = organizationIds.length
    ? await db
        .select({
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.actorUserId, userId),
            inArray(auditLogs.organizationId, organizationIds)
          )
        )
        .orderBy(asc(auditLogs.createdAt))
    : [];

  const linesByInvoice = groupBy(lines, (l) => l.invoiceId);
  const deliveriesByInvoice = groupBy(deliveries, (d) => d.invoiceId);
  const invoicesByDwelling = groupBy(invoiceRows, (i) => i.dwellingId);
  const allocationsByDwelling = groupBy(allocationRows, (r) => r.dwellingId);
  const reversalsByDwelling = groupBy(reversalRows, (r) => r.dwellingId);
  const ledgerByDwelling = groupBy(ledgerRows, (r) => r.dwellingId);
  const readingsByDwelling = groupBy(readingRows, (r) => r.dwellingId);
  const conversationsByDwelling = groupBy(
    conversationRows,
    (c) => c.dwellingId
  );
  const messagesByConversation = groupBy(messageRows, (m) => m.conversationId);

  const result = {
    exportedAt: new Date().toISOString(),
    scope: organizationId ? "ORGANIZATION" : "SELF",
    person: {
      email: person.email,
      displayName: person.displayName,
      disabled: !!person.disabledAt,
      createdAt: person.createdAt,
    },
    dwellings: scope.map((d) => ({
      organization: d.organizationName,
      number: d.number,
      displayName: d.displayName,
      occupantName: d.occupantName,
      billingName: d.billingName,
      billingEmail: ownOnly(d.billingEmail),
      billingAddress: d.billingAddress,
      invoiceByEmail: d.invoiceByEmail,
      invoiceByPaper: d.invoiceByPaper,
      areaM2: d.areaM2,
      residentCount: d.residentCount,
      accessSince: d.accessSince,
      invoices: (invoicesByDwelling.get(d.dwellingId) ?? []).map((i) => {
        const snapshot = (i.recipientSnapshot ?? {}) as Record<string, unknown>;
        return {
          invoiceNumber: i.invoiceNumber,
          issueDate: i.issueDate,
          dueDate: i.dueDate,
          currency: i.currency,
          subtotal: i.subtotal,
          vatTotal: i.vatTotal,
          total: i.total,
          previousOutstanding: i.previousOutstanding,
          lateFeeApplied: i.lateFeeApplied,
          amountDue: i.amountDue,
          sentAt: i.sentAt,
          paidAt: i.paidAt,
          recipient: {
            occupantName: snapshot.occupantName ?? null,
            billingName: snapshot.billingName ?? null,
            billingEmail: ownOnly(snapshot.billingEmail),
            billingAddress: snapshot.billingAddress ?? null,
          },
          lines: (linesByInvoice.get(i.id) ?? []).map(
            ({ invoiceId: _invoiceId, ...line }) => line
          ),
          deliveries: (deliveriesByInvoice.get(i.id) ?? []).map((x) => ({
            method: x.method,
            status: x.status,
            sentAt: x.sentAt,
            destinationEmail: ownOnly(x.destinationEmail),
          })),
        };
      }),
      payments: (allocationsByDwelling.get(d.dwellingId) ?? []).map(
        ({ dwellingId: _dwellingId, ...row }) => row
      ),
      paymentReversals: (reversalsByDwelling.get(d.dwellingId) ?? []).map(
        ({ dwellingId: _dwellingId, ...row }) => row
      ),
      accountEntries: (ledgerByDwelling.get(d.dwellingId) ?? []).map(
        ({ dwellingId: _dwellingId, ...row }) => row
      ),
      meterReadings: (readingsByDwelling.get(d.dwellingId) ?? []).map(
        ({ dwellingId: _dwellingId, ...row }) => row
      ),
      conversations: (conversationsByDwelling.get(d.dwellingId) ?? []).map(
        (c) => ({
          subject: c.subject,
          status: c.status,
          createdAt: c.createdAt,
          // Other senders appear only as a role, never as a name or address.
          messages: (messagesByConversation.get(c.id) ?? []).map((m) => ({
            from: m.senderUserId === userId ? "YOU" : m.senderRole,
            body: m.body,
            createdAt: m.createdAt,
          })),
        })
      ),
    })),
    activity: auditRows,
  };

  for (const orgId of organizationIds) {
    await recordAuditEvent(db, {
      organizationId: orgId,
      actorUserId,
      action: "PERSONAL_DATA_EXPORTED",
      entityType: "app_user",
      entityId: userId,
      afterData: { scope: result.scope },
    });
  }
  return result;
}
