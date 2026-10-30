export function bindChargePresets(form: HTMLFormElement): () => void {
  const sync = () => {
    let selected = false;
    for (const preset of form.querySelectorAll<HTMLElement>(".setup-preset")) {
      const checkbox = preset.querySelector<HTMLInputElement>(
        'input[type="checkbox"]'
      );
      const fields = preset.querySelector<HTMLFieldSetElement>(
        ".setup-preset-fields"
      );
      const price = preset.querySelector<HTMLInputElement>(
        "[data-charge-price]"
      );
      if (!checkbox || !fields || !price) continue;
      fields.disabled = !checkbox.checked;
      price.required = checkbox.checked;
      selected ||= checkbox.checked;
    }
    const button = form.querySelector<HTMLButtonElement>(
      "[data-charge-submit]"
    );
    if (button) button.disabled = !selected;
  };
  sync();
  form.addEventListener("change", sync);
  return () => form.removeEventListener("change", sync);
}
