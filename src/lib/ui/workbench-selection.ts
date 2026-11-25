import { fill } from "./fill";
import type { workbenchSelectionCopy } from "./i18n";

let scrollPaddingOwner: HTMLElement | null = null;

export function updateWorkbenchToolbarSpace(
  root: HTMLElement,
  toolbar: HTMLElement | null
): void {
  const pinned =
    toolbar &&
    !toolbar.hidden &&
    toolbar.getClientRects().length > 0 &&
    getComputedStyle(toolbar).position === "fixed";
  const space = pinned
    ? `${Math.ceil(innerHeight - toolbar.getBoundingClientRect().top) + 12}px`
    : "";
  root.style.paddingBottom = space;
  if (space) {
    scrollPaddingOwner = root;
    document.documentElement.style.scrollPaddingBottom = space;
  } else if (scrollPaddingOwner === root) {
    scrollPaddingOwner = null;
    document.documentElement.style.scrollPaddingBottom = "";
  }
}

export function initWorkbenchSelection(root: HTMLElement): () => void {
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const copy: ReturnType<typeof workbenchSelectionCopy> = JSON.parse(
    root.dataset.selectionCopy!
  );
  const rules = new Intl.PluralRules(copy.locale);
  const number = new Intl.NumberFormat(copy.locale);
  const boxes = () => [
    ...root.querySelectorAll<HTMLInputElement>(
      'tr:not([hidden]) input[name="invoiceIds"]'
    ),
  ];
  controller.signal.addEventListener("abort", () =>
    updateWorkbenchToolbarSpace(root, null)
  );
  // A bulk action submits only the selected invoices it can act on, so a
  // blocked one in the selection is not sent to the server to be skipped.
  // Capture listeners: the queue is re-rendered after saves, and formdata
  // does not bubble.
  let bulkStatus = "";
  root.addEventListener(
    "submit",
    (event) => {
      if ((event.target as Element).id !== "bulk-select-form") return;
      bulkStatus =
        (event.submitter as HTMLElement | null)?.dataset.bulkStatus ?? "";
    },
    { ...options, capture: true }
  );
  root.addEventListener(
    "formdata",
    (event) => {
      if ((event.target as Element).id !== "bulk-select-form" || !bulkStatus)
        return;
      const eligible =
        bulkStatus === "DRAFT" ? "prepareEligible" : "sendEligible";
      event.formData.delete("invoiceIds");
      for (const box of boxes())
        if (box.checked && box.dataset[eligible] === "true")
          event.formData.append("invoiceIds", box.value);
    },
    { ...options, capture: true }
  );
  let lastSelectedCount = 0;
  const updateSelection = (announce = false) => {
    const all = boxes();
    const selected = all.filter((box) => box.checked);
    const prepareEligible = selected.filter(
      (box) => box.dataset.prepareEligible === "true"
    ).length;
    const sendEligible = selected.filter(
      (box) => box.dataset.sendEligible === "true"
    ).length;
    const toolbar = root.querySelector<HTMLElement>("#bulk-toolbar");
    if (toolbar) toolbar.hidden = selected.length === 0;
    for (const [id, value] of [
      ["selected-count", selected.length],
      ["prepare-count", prepareEligible],
      ["send-count", sendEligible],
    ] as const) {
      const el = root.querySelector("#" + id);
      if (el) el.textContent = String(value);
    }
    const shouldAnnounce =
      announce || (lastSelectedCount > 0 && selected.length === 0);
    lastSelectedCount = selected.length;
    const status = root.querySelector<HTMLElement>("#bulk-selection-status");
    if (status && shouldAnnounce) {
      status.textContent = selected.length
        ? fill(copy.summary, {
            selection: fill(
              copy.selected[rules.select(selected.length)] ??
                copy.selected.other,
              { n: number.format(selected.length) }
            ),
            prepare: number.format(prepareEligible),
            send: number.format(sendEligible),
          })
        : copy.cleared;
    }
    root
      .querySelectorAll<HTMLButtonElement>("[data-bulk-status]")
      .forEach((button) => {
        button.disabled =
          button.dataset.bulkStatus === "DRAFT"
            ? prepareEligible === 0
            : sendEligible === 0;
      });
    all.forEach((box) =>
      box.closest("tr")?.toggleAttribute("data-selected", box.checked)
    );
    const selectAll = root.querySelector<HTMLInputElement>("#select-all");
    if (selectAll) {
      selectAll.checked = all.length > 0 && selected.length === all.length;
      selectAll.indeterminate =
        selected.length > 0 && selected.length < all.length;
      selectAll.disabled = all.length === 0;
    }
    // Measured last, once the counts are in.
    measureToolbar();
  };
  // On phones the toolbar is pinned to the bottom (fixed). Keep its real
  // height clear, measured because it wraps by language and width, so a
  // focused row control and the last row are never hidden under it.
  const measureToolbar = () => {
    updateWorkbenchToolbarSpace(
      root,
      root.querySelector<HTMLElement>("#bulk-toolbar")
    );
  };
  // Rotation or a resize can wrap the toolbar or unpin it.
  window.addEventListener("resize", measureToolbar, options);
  window.addEventListener("hashchange", measureToolbar, options);
  root.addEventListener(
    "change",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.id === "select-all")
        boxes().forEach((box) => {
          box.checked = target.checked;
        });
      if (target.id === "select-all" || target.name === "invoiceIds")
        updateSelection(true);
    },
    options
  );

  root.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("#clear-selection")) {
        boxes().forEach((box) => {
          box.checked = false;
        });
        updateSelection(true);
        // Select-all is not shown below sm; fall back to the first case.
        const selectAll = root.querySelector<HTMLInputElement>("#select-all");
        (selectAll?.checkVisibility?.() ? selectAll : boxes()[0])?.focus();
      }
    },
    options
  );
  // Drawer saves swap the queue and leave the live region in place.
  document.addEventListener(
    "workbench:refreshed",
    () => updateSelection(),
    options
  );
  updateSelection();
  return () => controller.abort();
}
