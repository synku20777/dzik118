// Phase C (Auth/security) - Authorization guard functions (spec Section 14).
// Later phases' repository functions (getAdminInvoice, getResidentInvoice,
// etc.) call these instead of re-implementing the tenant/dwelling check.
import { ConflictError } from "../errors";
import type { AuthContext } from "./context";

export class ForbiddenError extends Error {
  constructor(message = "You do not have access to this resource.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

// For actions with no target organizationId yet (e.g. creating a new
// organization) -- just proves "has admin capability somewhere", nothing
// tenant-scoped. Prefer requireOrganizationAccess whenever a target org
// exists.
export function requireAdminRole(
  auth: AuthContext | null
): asserts auth is AuthContext {
  if (!auth || auth.organizationIds.length === 0) {
    throw new ForbiddenError();
  }
}

export function requireOrganizationAccess(
  auth: AuthContext | null,
  organizationId: string
): asserts auth is AuthContext {
  if (!auth || !auth.organizationIds.includes(organizationId)) {
    throw new ForbiddenError();
  }
}

export const ORGANIZATION_ARCHIVED_MESSAGE =
  "This organization is archived. Restore it in Settings to make changes.";

// For every action or page that CHANGES something in an organization. An
// archived organization is read-only (ADR 0009), so this refuses it. Reading
// keeps using requireOrganizationAccess. Restoring an organization also uses
// requireOrganizationAccess, because it must work on an archived one.
export function requireActiveOrganization(
  auth: AuthContext | null,
  organizationId: string
): asserts auth is AuthContext {
  requireOrganizationAccess(auth, organizationId);
  if (auth.archivedOrganizationIds?.includes(organizationId)) {
    throw new ConflictError(ORGANIZATION_ARCHIVED_MESSAGE);
  }
}

// For resident pages with no target dwellingId yet (e.g. the dwelling
// selector) -- just proves "has resident capability somewhere", nothing
// dwelling-scoped. Prefer requireDwellingAccess whenever a target dwelling
// exists.
export function requireResidentRole(
  auth: AuthContext | null
): asserts auth is AuthContext {
  if (!auth || auth.dwellingIds.length === 0) {
    throw new ForbiddenError();
  }
}

export function requireDwellingAccess(
  auth: AuthContext | null,
  dwellingId: string
): asserts auth is AuthContext {
  if (!auth || !auth.dwellingIds.includes(dwellingId)) {
    throw new ForbiddenError();
  }
}
