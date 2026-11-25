import { ActionError } from "astro:actions";
import { fill } from "./fill";
import { onPageLoad } from "./page-lifecycle";
import {
  initWorkbenchDrawer,
  type DrawerData,
  type WorkbenchDrawerTransport,
} from "./workbench-drawer";
import { initWorkbenchSelection } from "./workbench-selection";

export function mountWorkbenchSpecimen() {
  onPageLoad(() => {
    const root = document.querySelector<HTMLElement>("#workbench-specimen");
    if (!root) return;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const disposeSelection = initWorkbenchSelection(root);
    const queue = () => root.querySelector<HTMLElement>(".case-queue")!;
    const read = (form: FormData, field: string) =>
      String(form.get(field) ?? "").trim();

    const fixture = (
      id: string,
      occupantName: string,
      status: string
    ): DrawerData => ({
      dwelling: {
        id,
        number: id,
        occupantName,
        billingName: occupantName,
        billingEmail: null,
        billingAddress: `Brīvības iela 118–${id}, Riga`,
        notes: null,
      },
      organization: { addressLine1: "Brīvības iela 118" },
      billingCase: { status, invoiceId: null, invoiceNumber: null },
      meters: [],
      manualRuleInputs: [],
    });
    const readings = fixture("12", "Anna Bērziņa", "MISSING_DATA");
    readings.meters.push({
      meterId: "water",
      type: "COLD_WATER",
      label: "Cold water meter",
      serialNumber: "006742",
      unit: "m³",
      currentValue: null,
      previousValue: "124.100",
      consumption: null,
      source: null,
    });
    readings.manualRuleInputs.push({
      billingRuleId: "heating",
      ruleName: "Heating allocation",
      unit: "kWh",
      calculationType: "MANUAL_QUANTITY",
      value: null,
    });
    const billing = fixture("14", "Jānis Liepa", "DRAFT");
    billing.billingCase!.invoiceId = "sample-14";
    billing.billingCase!.invoiceNumber = "INV-014";
    const [meter] = readings.meters;
    const [rule] = readings.manualRuleInputs;
    let stage = "";
    let search = "";

    const rows = (section: HTMLElement) => [
      ...section.querySelectorAll<HTMLTableRowElement>("tr[data-dwelling-id]"),
    ];
    function filter(section: HTMLElement) {
      const cases = rows(section);
      let shown = 0;
      for (const row of cases) {
        row.hidden =
          (stage !== "" && row.dataset.status !== stage) ||
          !row
            .querySelector(".dwelling-cell")!
            .textContent!.toLowerCase()
            .includes(search.toLowerCase());
        if (!row.hidden) shown++;
      }
      for (const link of section.querySelectorAll<HTMLElement>(
        "[data-queue-stage]"
      )) {
        const status = link.dataset.queueStage;
        if (status === stage) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
        link.querySelector("strong")!.textContent = String(
          cases.filter((row) => !status || row.dataset.status === status).length
        );
      }
      section.querySelector<HTMLElement>(".queue-result")!.hidden =
        !search && !stage;
      const result = section.querySelector<HTMLElement>("[data-queue-result]")!;
      result.textContent = fill(result.dataset.queueResult!, {
        shown,
        total: cases.length,
      });
      section.querySelector<HTMLElement>("[data-queue-empty]")!.hidden =
        shown !== 0;
    }
    const notifyRefresh = () =>
      document.dispatchEvent(new Event("workbench:refreshed"));
    function resetChecks(section: HTMLElement) {
      for (const box of section.querySelectorAll<HTMLInputElement>(
        'input[name="invoiceIds"]'
      )) {
        box.checked = false;
        box.closest("tr")?.removeAttribute("data-selected");
      }
    }
    const delay = () =>
      new Promise<void>((resolve) => setTimeout(resolve, 180));
    const rejectField = (field: string, message: string) => ({
      error: ActionError.fromJson({
        type: "AstroActionInputError",
        issues: [{ code: "custom", path: [field], message }],
      }),
    });
    const transport: WorkbenchDrawerTransport = {
      async load({ dwellingId }) {
        await delay();
        if (dwellingId === "12") return { data: structuredClone(readings) };
        if (dwellingId === "14") return { data: structuredClone(billing) };
        return { error: { message: "Sample dwelling unavailable." } };
      },
      async saveReading(form) {
        await delay();
        const value = read(form, "currentValue").replace(",", ".");
        if (!/^\d+(\.\d{1,3})?$/.test(value))
          return rejectField(
            "currentValue",
            "Enter a valid meter reading, for example 123.456. Use up to 3 decimal places."
          );
        const consumption = Number(value) - Number(meter.previousValue);
        if (consumption < 0)
          return rejectField(
            "currentValue",
            "The current reading is lower than the previous reading."
          );
        meter.currentValue = value;
        meter.consumption = consumption.toFixed(3);
        return { error: undefined };
      },
      async saveManualInput(form) {
        await delay();
        const value = read(form, "value").replace(",", ".");
        if (!/^\d+(\.\d{1,4})?$/.test(value))
          return rejectField(
            "value",
            "Enter a valid value, for example 12.3456. Use up to 4 decimal places."
          );
        rule.value = value;
        return { error: undefined };
      },
      async saveBillingDetails(form) {
        await delay();
        const occupantName = read(form, "occupantName");
        if (!occupantName)
          return rejectField("occupantName", "Enter an occupant name.");
        const email = read(form, "billingEmail");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          return rejectField("billingEmail", "Invalid email address");
        Object.assign(billing.dwelling, {
          occupantName,
          billingEmail: email,
          billingName: read(form, "billingName") || null,
          billingAddress: read(form, "billingAddress") || null,
          notes: read(form, "notes") || null,
        });
        return { error: undefined };
      },
      async refresh() {
        const fresh = document.implementation.createHTMLDocument();
        const wrapper = fresh.createElement("div");
        wrapper.id = root.id;
        const updated = queue().cloneNode(true) as HTMLElement;
        const [readingRow, billingRow] = rows(updated);
        if (meter.currentValue !== null && rule.value !== null) {
          readings.billingCase!.status = "READY";
          readingRow.dataset.status = "READY";
          const ready = root.querySelector<HTMLTemplateElement>(
            "#workbench-ready-status"
          )!;
          readingRow
            .querySelector(".status-cell")!
            .replaceChildren(ready.content.cloneNode(true));
        } else if (meter.currentValue !== null || rule.value !== null) {
          const resolved =
            meter.currentValue !== null ? "meter-water" : "rule-heating";
          const remaining = root.querySelector<HTMLTemplateElement>(
            `[data-resolved-problem="${resolved}"]`
          )!;
          readingRow
            .querySelector(".readiness-line")
            ?.replaceWith(remaining.content.cloneNode(true));
        }
        if (billing.dwelling.billingEmail) {
          billingRow.querySelector(".readiness-line")?.remove();
          const box = billingRow.querySelector<HTMLInputElement>(
            'input[name="invoiceIds"]'
          );
          if (box) box.dataset.prepareEligible = "true";
        }
        resetChecks(updated);
        filter(updated);
        wrapper.appendChild(updated);
        fresh.body.appendChild(wrapper);
        return fresh;
      },
    };
    const disposeDrawer = initWorkbenchDrawer(transport);

    root.addEventListener(
      "submit",
      (event) => {
        if (!(event.target instanceof HTMLFormElement)) return;
        const form = event.target;
        if (form.matches(".queue-filters")) {
          event.preventDefault();
          search = read(new FormData(form), "search");
          resetChecks(queue());
          filter(queue());
          notifyRefresh();
        }
        if (form.id === "bulk-select-form") {
          event.preventDefault();
          const count = new FormData(form).getAll("invoiceIds").length;
          const verb =
            event.submitter?.dataset.bulkStatus === "DRAFT"
              ? "prepared"
              : "sent";
          const status = root.querySelector<HTMLElement>(
            "[data-queue-action-result]"
          )!;
          status.textContent = `Preview: ${count} ${count === 1 ? "invoice" : "invoices"} ${verb}.`;
          status.hidden = false;
          root.querySelector<HTMLButtonElement>("#clear-selection")?.click();
        }
      },
      options
    );

    root.addEventListener(
      "click",
      (event) => {
        if (!(event.target instanceof Element)) return;
        const width =
          event.target.closest<HTMLButtonElement>("[data-queue-width]");
        if (width) {
          root.dataset.width = width.dataset.queueWidth;
          for (const button of root.querySelectorAll("[data-queue-width]"))
            button.setAttribute("aria-pressed", String(button === width));
          notifyRefresh();
          return;
        }
        const link = event.target.closest<HTMLAnchorElement>("a");
        if (!link) return;
        if (link.matches('[href="#period-tariffs"]')) {
          event.preventDefault();
          link.closest<HTMLElement>("[popover]")?.hidePopover();
          const tariffs =
            root.querySelector<HTMLDetailsElement>("#period-tariffs")!;
          tariffs.open = true;
          tariffs.querySelector("summary")?.focus();
          return;
        }
        if (
          link.dataset.queueStage !== undefined ||
          link.matches(".clear-filters")
        ) {
          event.preventDefault();
          stage = link.dataset.queueStage ?? "";
          if (link.matches(".clear-filters")) {
            search = "";
            root.querySelector<HTMLInputElement>("#search")!.value = "";
          }
          resetChecks(queue());
          filter(queue());
          notifyRefresh();
          if (link.matches(".clear-filters"))
            root.querySelector<HTMLInputElement>("#search")?.focus();
        }
      },
      options
    );

    return () => {
      controller.abort();
      disposeDrawer?.();
      disposeSelection();
    };
  });
}
