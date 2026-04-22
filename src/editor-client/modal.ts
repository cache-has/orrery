const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export function promptNewDashboard(
  onSubmit: (name: string) => Promise<string | null>,
): void {
  const backdrop = document.createElement("div");
  backdrop.className = "ob-ed-modal-backdrop";
  backdrop.innerHTML = `
    <div class="ob-ed-modal" role="dialog" aria-modal="true" aria-labelledby="ob-ed-modal-title">
      <h2 id="ob-ed-modal-title">New dashboard</h2>
      <label for="ob-ed-modal-name">Name</label>
      <input id="ob-ed-modal-name" type="text" autocomplete="off" spellcheck="false" />
      <p class="ob-ed-modal-hint">Letters, numbers, hyphens, underscores.</p>
      <p class="ob-ed-modal-error" hidden></p>
      <div class="ob-ed-modal-actions">
        <button type="button" class="ob-ed-btn-secondary" data-action="cancel">Cancel</button>
        <button type="button" class="ob-ed-btn" data-action="create">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const input = backdrop.querySelector<HTMLInputElement>("#ob-ed-modal-name")!;
  const errorEl = backdrop.querySelector<HTMLParagraphElement>(".ob-ed-modal-error")!;
  const cancelBtn = backdrop.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
  const createBtn = backdrop.querySelector<HTMLButtonElement>('[data-action="create"]')!;
  input.focus();

  function showError(msg: string) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function close() {
    backdrop.remove();
  }

  async function submit() {
    const name = input.value.trim();
    if (!NAME_PATTERN.test(name)) {
      showError("Name must contain only letters, numbers, hyphens, or underscores.");
      return;
    }
    createBtn.disabled = true;
    const err = await onSubmit(name);
    if (err) {
      createBtn.disabled = false;
      showError(err);
      return;
    }
    close();
  }

  cancelBtn.addEventListener("click", close);
  createBtn.addEventListener("click", submit);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") close();
  });
}
