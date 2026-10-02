import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, it } from "vitest";
import { requireDatabaseUrl } from "./_helpers";

it("backfills audit dwelling scope without guessing or crossing organizations", async () => {
  requireDatabaseUrl();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    // Temporary tables shadow real tables so the actual migration runs safely.
    await client.query(`
      CREATE TEMP TABLE audit_logs (
        id uuid, organization_id uuid, entity_type text, entity_id uuid,
        action text, after_data jsonb, created_at timestamptz DEFAULT now()
      );
      CREATE TEMP TABLE dwellings (id uuid, organization_id uuid);
      CREATE TEMP TABLE meters (id uuid, organization_id uuid, dwelling_id uuid);
      CREATE TEMP TABLE meter_readings (id uuid, organization_id uuid, meter_id uuid);
      CREATE TEMP TABLE invoices (id uuid, organization_id uuid, dwelling_id uuid);
      CREATE TEMP TABLE billing_cases (id uuid, organization_id uuid, dwelling_id uuid);
      CREATE TEMP TABLE payment_matches (id uuid, organization_id uuid, invoice_id uuid, bank_transaction_id uuid);
      CREATE TEMP TABLE account_entries (id uuid, organization_id uuid, dwelling_id uuid, bank_transaction_id uuid, type text);
      CREATE TEMP TABLE conversations (id uuid, organization_id uuid, dwelling_id uuid);
      CREATE TEMP TABLE messages (id uuid, organization_id uuid, conversation_id uuid);
      CREATE TEMP TABLE manual_rule_inputs (id uuid, organization_id uuid, dwelling_id uuid);
    `);
    const org = randomUUID();
    const otherOrg = randomUUID();
    const dwelling = randomUUID();
    const otherDwelling = randomUUID();
    const meter = randomUUID();
    const invoice = randomUUID();
    const otherInvoice = randomUUID();
    const conversation = randomUUID();
    const transaction = randomUUID();
    const ambiguousTransaction = randomUUID();
    await client.query("INSERT INTO dwellings VALUES ($1,$2),($3,$2)", [
      dwelling,
      org,
      otherDwelling,
    ]);
    await client.query("INSERT INTO meters VALUES ($1,$2,$3)", [
      meter,
      org,
      dwelling,
    ]);
    await client.query("INSERT INTO invoices VALUES ($1,$2,$3),($4,$2,$5)", [
      invoice,
      org,
      dwelling,
      otherInvoice,
      otherDwelling,
    ]);
    await client.query("INSERT INTO conversations VALUES ($1,$2,$3)", [
      conversation,
      org,
      dwelling,
    ]);

    const entities: [string, string, string][] = [
      ["dwelling", "dwellings", dwelling],
      ["meter", "meters", meter],
      ["invoice", "invoices", invoice],
      ["conversation", "conversations", conversation],
    ];
    for (const [type, table, parentColumn, parent] of [
      ["meter_reading", "meter_readings", "meter_id", meter],
      ["billing_case", "billing_cases", "dwelling_id", dwelling],
      ["message", "messages", "conversation_id", conversation],
      ["manual_rule_input", "manual_rule_inputs", "dwelling_id", dwelling],
    ]) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO ${table} (id,organization_id,${parentColumn}) VALUES ($1,$2,$3)`,
        [id, org, parent]
      );
      entities.push([type, table, id]);
    }
    const match = randomUUID();
    await client.query(
      "INSERT INTO payment_matches VALUES ($1,$2,$3,$4),($5,$2,$6,$4)",
      [match, org, invoice, transaction, randomUUID(), otherInvoice]
    );
    entities.push(["payment_match", "payment_matches", match]);
    const entry = randomUUID();
    await client.query(
      "INSERT INTO account_entries VALUES ($1,$2,$3,$4,'PAYMENT'),($5,$2,$3,$6,'PAYMENT'),($7,$2,$8,$6,'PAYMENT')",
      [
        entry,
        org,
        dwelling,
        transaction,
        randomUUID(),
        ambiguousTransaction,
        randomUUID(),
        otherDwelling,
      ]
    );
    entities.push(["account_entry", "account_entries", entry]);
    for (const [type, , id] of entities) {
      await client.query(
        "INSERT INTO audit_logs (id,organization_id,entity_type,entity_id) VALUES ($1,$2,$3,$4)",
        [randomUUID(), org, type, id]
      );
    }
    for (const [action, type, payload] of [
      ["MANUAL_PAYMENT_RECORDED", "bank_transaction", { invoiceId: invoice }],
      [
        "ACCOUNT_CREDIT_CREATED",
        "account_entry",
        { bankTransactionId: transaction },
      ],
      ["AMBIGUOUS", "account_entry", {}],
    ] as const) {
      await client.query(
        "INSERT INTO audit_logs (id,organization_id,entity_type,entity_id,action,after_data) VALUES ($1,$2,$3,$4,$5,$6)",
        [randomUUID(), org, type, transaction, action, payload]
      );
    }
    for (const payload of [
      { bankTransactionId: ambiguousTransaction },
      { bankTransactionId: "invalid uuid" },
    ]) {
      await client.query(
        "INSERT INTO audit_logs (id,organization_id,entity_type,action,after_data) VALUES ($1,$2,'account_entry','ACCOUNT_CREDIT_CREATED',$3)",
        [randomUUID(), org, payload]
      );
    }
    await client.query(
      "INSERT INTO audit_logs (id,organization_id,entity_type,entity_id) VALUES ($1,$2,'invoice',$3)",
      [randomUUID(), otherOrg, invoice]
    );
    await client.query(
      await readFile(
        new URL(
          "../../drizzle/migrations/0020_dwelling_scoped_audit.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    const rows = (await client.query("SELECT * FROM audit_logs")).rows;
    expect(
      rows.filter((row) => row.scope_dwelling_id === dwelling)
    ).toHaveLength(entities.length + 2);
    expect(rows.filter((row) => row.scope_dwelling_id === null)).toHaveLength(
      4
    );
    expect(
      rows.find((row) => row.organization_id === otherOrg).scope_dwelling_id
    ).toBeNull();
    expect(
      rows.every(
        (row) =>
          row.scope_dwelling_id === null || row.scope_dwelling_id === dwelling
      )
    ).toBe(true);
    await client.query("DELETE FROM dwellings");
    const retained = await client.query(
      "SELECT count(*) FROM audit_logs WHERE scope_dwelling_id = $1",
      [dwelling]
    );
    expect(retained.rows[0].count).toBe(String(entities.length + 2));
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
