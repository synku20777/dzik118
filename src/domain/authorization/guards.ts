// Phase C (Auth/security) - Authorization guard functions (spec Section 14).
// Later phases' repository functions (getAdminInvoice, getResidentInvoice,
// etc.) call these instead of re-implementing the tenant/dwelling check.
import type {
  AdminAuthContext,
  AuthContext,
  ResidentAuthContext,
} from "./context";

export class ForbiddenError extends Error {
  constructor(message = "You do not have access to this resource.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

// For actions with no target organizationId yet (e.g. creating a new
// organization) -- just proves "an authenticated admin", nothing tenant-
// scoped. Prefer requireOrganizationAccess whenever a target org exists.
export function requireAdminRole(
  auth: AuthContext | null
): asserts auth is AdminAuthContext {
  if (!auth || auth.role !== "ADMIN") {
    throw new ForbiddenError();
  }
}

export function requireOrganizationAccess(
  auth: AuthContext | null,
  organizationId: string
): asserts auth is AdminAuthContext {
  if (
    !auth ||
    auth.role !== "ADMIN" ||
    !auth.organizationIds.includes(organizationId)
  ) {
    throw new ForbiddenError();
  }
}

export function requireDwellingAccess(
  auth: AuthContext | null,
  dwellingId: string
): asserts auth is ResidentAuthContext {
  if (
    !auth ||
    auth.role !== "RESIDENT" ||
    !auth.dwellingIds.includes(dwellingId)
  ) {
    throw new ForbiddenError();
  }
}
