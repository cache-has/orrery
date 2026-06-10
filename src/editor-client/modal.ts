const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface NewDashboardOptions {
  /** Folders the caller may create in (drives the folder picker). */
  folders: string[];
  /** Whether a folder must be chosen before creating. */
  required: boolean;
}

export function promptNewDashboard(
  onSubmit: (name: string, folder: string) => Promise<string | null>,
  opts: NewDashboardOptions = { folders: [], required: false },
): void {
  const backdrop = document.createElement("div");
  backdrop.className = "ob-ed-modal-backdrop";

  // Folder picker: shown whenever folders are configured or required. The empty
  // option ("root") is offered only when a folder is not required.
  const showFolder = opts.required || opts.folders.length > 0;
  const folderOptions = [
    opts.required ? "" : `<option value="">(no folder)</option>`,
    ...opts.folders.map((f) => `<option value="${escapeAttr(f)}">${escapeAttr(f)}</option>`),
  ].join("");
  const folderField = showFolder
    ? `<label for="ob-ed-modal-folder">Folder</label>
      <select id="ob-ed-modal-folder">${folderOptions}</select>
      <p class="ob-ed-modal-hint">${
        opts.required ? "Required — pick the folder this dashboard belongs to." : "Optional."
      }</p>`
    : "";

  backdrop.innerHTML = `
    <div class="ob-ed-modal" role="dialog" aria-modal="true" aria-labelledby="ob-ed-modal-title">
      <h2 id="ob-ed-modal-title">New dashboard</h2>
      <label for="ob-ed-modal-name">Name</label>
      <input id="ob-ed-modal-name" type="text" autocomplete="off" spellcheck="false" />
      <p class="ob-ed-modal-hint">Letters, numbers, hyphens, underscores.</p>
      ${folderField}
      <p class="ob-ed-modal-error" hidden></p>
      <div class="ob-ed-modal-actions">
        <button type="button" class="ob-ed-btn-secondary" data-action="cancel">Cancel</button>
        <button type="button" class="ob-ed-btn" data-action="create">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const input = backdrop.querySelector<HTMLInputElement>("#ob-ed-modal-name")!;
  const folderSelect = backdrop.querySelector<HTMLSelectElement>("#ob-ed-modal-folder");
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
    const folder = folderSelect?.value ?? "";
    if (opts.required && !folder) {
      showError("Pick a folder for this dashboard.");
      return;
    }
    createBtn.disabled = true;
    const err = await onSubmit(name, folder);
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

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
