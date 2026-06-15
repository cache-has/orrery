import { injectStyles } from "./styles.js";
import { renderListPage } from "./list.js";
import { renderEditorPage } from "./editor.js";

async function boot(): Promise<void> {
  injectStyles();
  const root = document.getElementById("orrery-editor");
  if (!root) return;
  const mode = root.dataset.mode;
  if (mode === "list") {
    await renderListPage(root);
  } else if (mode === "edit") {
    const name = root.dataset.name;
    if (!name) {
      root.textContent = "Missing dashboard name.";
      return;
    }
    await renderEditorPage(root, name);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void boot());
} else {
  void boot();
}
