// An organization action: safeHandler's error mapping plus the org guard, so a
// new action cannot forget either. By default it refuses an archived
// organization (ADR 0009); `allowArchived` is for reads, archive and restore.
import { defineAction, type ActionAPIContext } from "astro:actions";
import type { z } from "astro/zod";
import type { AuthContext } from "../domain/authorization/context";
import {
  requireActiveOrganization,
  requireOrganizationAccess,
} from "../domain/authorization/guards";
import { safeHandler } from "./_errors";

type OrgActionContext = ActionAPIContext & {
  locals: ActionAPIContext["locals"] & { auth: AuthContext };
};

export function orgAction<
  TOutput,
  TInput extends z.ZodType<{ organizationId: string }>,
  TAccept extends "form" | "json" | undefined = undefined,
>({
  allowArchived = false,
  handler,
  ...config
}: {
  accept?: TAccept;
  input: TInput;
  allowArchived?: boolean;
  handler: (
    input: z.infer<TInput>,
    context: OrgActionContext
  ) => Promise<TOutput>;
}) {
  type Handler = Parameters<
    typeof defineAction<TOutput, TAccept, TInput>
  >[0]["handler"];
  return defineAction<TOutput, TAccept, TInput>({
    ...config,
    // TypeScript cannot resolve Astro's conditional handler type for a generic input.
    handler: safeHandler(
      async (input: z.infer<TInput>, context: ActionAPIContext) => {
        if (allowArchived) {
          requireOrganizationAccess(context.locals.auth, input.organizationId);
        } else {
          requireActiveOrganization(context.locals.auth, input.organizationId);
        }
        return handler(input, context as OrgActionContext);
      }
    ) as Handler,
  });
}
