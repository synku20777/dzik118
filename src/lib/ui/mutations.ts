export type MutationStatus =
  | "pending"
  | "confirmed"
  | "reconciling"
  | "verifying"
  | "success"
  | "error"
  | "unknown";

export interface MutationRecovery {
  organizationId: string;
  clientMutationId: string;
  originPath: string;
}

export interface UiMutation {
  id: string;
  entity: string;
  operation: string;
  label: string;
  messageKey?: string;
  successMessageKey?: string;
  status: MutationStatus;
  startedAt: number;
  completedAt?: number;
  error?: string;
  retry?: () => void;
  checkAgain?: () => void;
  recovery?: MutationRecovery;
}

type MutationInput = Pick<
  UiMutation,
  | "id"
  | "entity"
  | "operation"
  | "label"
  | "messageKey"
  | "successMessageKey"
  | "retry"
  | "recovery"
>;
type Listener = (mutations: readonly UiMutation[]) => void;

type MutationGlobals = typeof globalThis & {
  __dzik118Mutations?: Map<string, UiMutation>;
  __dzik118MutationListeners?: Set<Listener>;
  __dzik118MutationRecoveries?: Map<string, AbortController>;
  __dzik118MutationsHydrated?: boolean;
};
const mutationGlobals = globalThis as MutationGlobals;
const mutations = (mutationGlobals.__dzik118Mutations ??= new Map());
const listeners = (mutationGlobals.__dzik118MutationListeners ??= new Set());
const recoveries = (mutationGlobals.__dzik118MutationRecoveries ??= new Map());
const SUCCESS_VISIBLE_MS = 8_000;
const RECOVERY_STORAGE_KEY = "dzik118:mutations:v1";
const RECOVERY_MAX_AGE_MS = 10 * 60_000;
export const RECOVERY_DELAYS_MS = [0, 1_000, 2_000, 4_000, 8_000, 15_000];

interface StoredMutation {
  id: string;
  entity: string;
  operation: string;
  messageKey: string;
  successMessageKey: string;
  status: "verifying" | "unknown";
  startedAt: number;
  recovery: MutationRecovery;
}

function snapshot(): UiMutation[] {
  return [...mutations.values()].sort((a, b) => b.startedAt - a.startedAt);
}

function persist(): void {
  if (typeof sessionStorage === "undefined") return;
  const stored: StoredMutation[] = snapshot()
    .filter(
      (
        item
      ): item is UiMutation & {
        messageKey: string;
        successMessageKey: string;
        recovery: MutationRecovery;
        status: "verifying" | "unknown";
      } =>
        (item.status === "verifying" || item.status === "unknown") &&
        Boolean(item.messageKey && item.successMessageKey && item.recovery)
    )
    .map(
      ({
        id,
        entity,
        operation,
        messageKey,
        successMessageKey,
        status,
        startedAt,
        recovery,
      }) => ({
        id,
        entity,
        operation,
        messageKey,
        successMessageKey,
        status,
        startedAt,
        recovery,
      })
    );
  if (stored.length) {
    sessionStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(stored));
  } else {
    sessionStorage.removeItem(RECOVERY_STORAGE_KEY);
  }
}

function emit(): void {
  persist();
  const current = snapshot();
  for (const listener of listeners) listener(current);
}

function update(
  id: string,
  status: MutationStatus,
  values: Partial<
    Pick<UiMutation, "label" | "error" | "completedAt" | "retry" | "checkAgain">
  > = {}
): void {
  const current = mutations.get(id);
  if (!current) return;
  mutations.set(id, { ...current, ...values, status });
  emit();
}

function cancelRecovery(id: string): void {
  recoveries.get(id)?.abort();
  recoveries.delete(id);
}

export function createMutationId(entity: string, operation: string): string {
  return `mutation:${entity}:${operation}:${crypto.randomUUID()}`;
}

export function startMutation(input: MutationInput): void {
  mutations.set(input.id, {
    ...input,
    status: "pending",
    startedAt: Date.now(),
  });
  emit();
}

export function hydrateMutations(
  translate: (messageKey: string) => string
): UiMutation[] {
  if (
    mutationGlobals.__dzik118MutationsHydrated ||
    typeof sessionStorage === "undefined"
  ) {
    return snapshot();
  }
  mutationGlobals.__dzik118MutationsHydrated = true;
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem(RECOVERY_STORAGE_KEY) ?? "[]"
    ) as StoredMutation[];
    const now = Date.now();
    for (const item of parsed) {
      if (
        !item.recovery ||
        !item.messageKey ||
        now - item.startedAt > RECOVERY_MAX_AGE_MS
      ) {
        continue;
      }
      if (!mutations.has(item.id)) {
        mutations.set(item.id, {
          ...item,
          label: translate(item.messageKey),
        });
      }
    }
  } catch {
    sessionStorage.removeItem(RECOVERY_STORAGE_KEY);
  }
  emit();
  return snapshot();
}

export function retryMutation(id: string): void {
  const retry = mutations.get(id)?.retry;
  if (!retry) return;
  mutations.delete(id);
  emit();
  retry();
}

export function confirmMutation(id: string): void {
  update(id, "confirmed", { retry: undefined, checkAgain: undefined });
}

export function markReconciling(id: string): void {
  update(id, "reconciling");
}

export function markVerifying(id: string, label?: string): void {
  update(id, "verifying", {
    ...(label ? { label } : {}),
    error: undefined,
    retry: undefined,
    checkAgain: undefined,
  });
}

export function markOutcomeUnknown(id: string, checkAgain: () => void): void {
  update(id, "unknown", {
    error: undefined,
    retry: undefined,
    checkAgain,
  });
}

export function completeMutation(id: string, label?: string): void {
  cancelRecovery(id);
  const completedAt = Date.now();
  update(id, "success", {
    ...(label ? { label } : {}),
    completedAt,
    error: undefined,
    retry: undefined,
    checkAgain: undefined,
  });
  globalThis.setTimeout(() => {
    const current = mutations.get(id);
    if (current?.status === "success" && current.completedAt === completedAt) {
      mutations.delete(id);
      emit();
    }
  }, SUCCESS_VISIBLE_MS);
}

export function failMutation(id: string, error: string, label?: string): void {
  cancelRecovery(id);
  update(id, "error", {
    ...(label ? { label } : {}),
    error,
    completedAt: Date.now(),
    checkAgain: undefined,
  });
}

export function dismissMutation(id: string): void {
  cancelRecovery(id);
  if (mutations.delete(id)) emit();
}

export interface RecoveryResult {
  state: "missing" | "committed";
  entity?: unknown | null;
}

export function runMutationRecovery(
  id: string,
  lookup: () => Promise<RecoveryResult>,
  callbacks: {
    committed: (entity: unknown | null) => void | Promise<void>;
    unknown: (checkAgain: () => void) => void;
  }
): void {
  if (recoveries.has(id)) return;
  const controller = new AbortController();
  recoveries.set(id, controller);

  const run = async () => {
    try {
      for (const delay of RECOVERY_DELAYS_MS) {
        if (delay) {
          await new Promise<void>((resolve) => {
            const timer = globalThis.setTimeout(resolve, delay);
            controller.signal.addEventListener(
              "abort",
              () => {
                globalThis.clearTimeout(timer);
                resolve();
              },
              { once: true }
            );
          });
        }
        if (controller.signal.aborted) return;
        try {
          const result = await lookup();
          if (result.state === "committed") {
            await callbacks.committed(result.entity ?? null);
            return;
          }
        } catch {
          // Lookup failure says nothing about the original write.
        }
      }
      if (!controller.signal.aborted) {
        callbacks.unknown(() => {
          markVerifying(id);
          runMutationRecovery(id, lookup, callbacks);
        });
      }
    } finally {
      if (recoveries.get(id) === controller) recoveries.delete(id);
    }
  };
  void run();
}

export function subscribeMutations(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

export function mutationCounts(items: readonly UiMutation[]): {
  active: number;
  errors: number;
} {
  return {
    active: items.filter((item) =>
      ["pending", "confirmed", "reconciling", "verifying"].includes(item.status)
    ).length,
    errors: items.filter(
      (item) => item.status === "error" || item.status === "unknown"
    ).length,
  };
}

export function resetMutationsForTest(): void {
  for (const id of recoveries.keys()) cancelRecovery(id);
  mutations.clear();
  mutationGlobals.__dzik118MutationsHydrated = false;
  emit();
}
