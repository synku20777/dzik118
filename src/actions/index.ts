// src/actions/index.ts
// Composes domain action groups
// TODO: Actions implemented in later phases (Phase D, E, F, G, J, K)
import { organizations } from "./organizations";
import { dwellings } from "./dwellings";
import { periods } from "./periods";
import { meters } from "./meters";
import { readings } from "./readings";
import { billing } from "./billing";
import { invoices } from "./invoices";
import { payments } from "./payments";
import { messages } from "./messages";
import { accounts } from "./accounts";
import { workbench } from "./workbench";
import { invoiceTemplates } from "./invoice-templates";

export const server = {
  organizations,
  dwellings,
  periods,
  meters,
  readings,
  billing,
  invoices,
  payments,
  messages,
  accounts,
  workbench,
  invoiceTemplates,
};
