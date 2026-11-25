import { MUTATION_SUCCESS_VISIBLE_MS, type UiMutation } from "./mutations";

/** Local activity for the design-system specimen. */
export function bindMutationSpecimen(
  root: HTMLElement,
  render: (items: readonly UiMutation[]) => void
): { dismiss: (id: string) => void; dispose: () => void } {
  const items = new Map<string, UiMutation>();
  const timers = new Map<string, number>();
  const controller = new AbortController();
  let sequence = 0;
  const emit = () => render([...items.values()].reverse());

  function dismiss(id: string) {
    window.clearTimeout(timers.get(id));
    timers.delete(id);
    items.delete(id);
    emit();
  }
  function save(item: UiMutation, outcome: UiMutation["status"]) {
    window.clearTimeout(timers.get(item.id));
    items.set(item.id, item);
    emit();
    timers.set(
      item.id,
      window.setTimeout(() => {
        timers.delete(item.id);
        const complete: UiMutation = {
          ...item,
          status: outcome,
          completedAt: Date.now(),
        };
        if (outcome === "error") {
          complete.error = "The sample save failed.";
          complete.retry = () => {
            items.delete(item.id);
            save(
              { ...item, status: "pending", startedAt: Date.now() },
              "success"
            );
          };
        } else if (outcome === "unknown") {
          complete.checkAgain = () =>
            save({ ...item, status: "verifying" }, "success");
        } else if (outcome === "success") {
          timers.set(
            item.id,
            window.setTimeout(
              () => dismiss(item.id),
              MUTATION_SUCCESS_VISIBLE_MS
            )
          );
        }
        items.set(item.id, complete);
        emit();
      }, 700)
    );
  }

  for (const control of root.querySelectorAll<HTMLButtonElement>(
    "[data-sample-mutation]"
  )) {
    control.addEventListener(
      "click",
      () => {
        const outcome = control.dataset.sampleMutation;
        if (
          outcome !== "success" &&
          outcome !== "error" &&
          outcome !== "unknown"
        )
          return;
        const label =
          outcome === "success"
            ? "Update sample tariff"
            : outcome === "error"
              ? "Save sample dwelling"
              : "Add sample meter";
        save(
          {
            id: `sample-${++sequence}`,
            entity: "sample",
            operation: "save",
            label,
            status: "pending",
            startedAt: Date.now(),
          },
          outcome
        );
      },
      { signal: controller.signal }
    );
  }
  emit();
  return {
    dismiss,
    dispose() {
      controller.abort();
      for (const timer of timers.values()) window.clearTimeout(timer);
    },
  };
}
