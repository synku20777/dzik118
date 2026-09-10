// Phase D (Organizations/dwellings) - shared action error sanitization.
// Astro puts any uncaught error's raw .message into the client-facing
// ActionError unconditionally, in prod too (astro/dist/actions/runtime/
// server.js's callSafely). DrizzleQueryError's message embeds the SQL text
// and bound parameters (emails, addresses, bank details), so an unexpected
// DB error must never reach the client verbatim.
import { ActionError } from "astro:actions";
import { ConflictError } from "../domain/organizations/organizations";

export function toActionError(err: unknown): ActionError {
  if (err instanceof ActionError) return err;
  if (err instanceof ConflictError) {
    return new ActionError({ code: "CONFLICT", message: err.message });
  }
  console.error(err);
  return new ActionError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong. Please try again.",
  });
}

// Wraps a defineAction handler so every rejection -- not just the ones a
// given handler remembers to catch -- goes through toActionError first.
export function safeHandler<Input, Context, Result>(
  handler: (input: Input, context: Context) => Promise<Result>
): (input: Input, context: Context) => Promise<Result> {
  return async (input, context) => {
    try {
      return await handler(input, context);
    } catch (err) {
      throw toActionError(err);
    }
  };
}
