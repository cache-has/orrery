import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { boardLanguage } from "./language/board-language.js";
import { mapDiagnostics, type ServerDiagnostic } from "./language/board-lint.js";
import {
  listDashboards,
  newDashboard,
  readDashboard,
  saveDashboard,
  type Diagnostic,
} from "./api.js";
import { promptNewDashboard } from "./modal.js";
import { statusText, statusClass, type SaveState } from "./status.js";

export async function renderEditorPage(
  root: HTMLElement,
  name: string,
): Promise<void> {
  const brandTitle = root.dataset.brandTitle || "Orrery";
  root.innerHTML = `
    <div class="ob-ed-page">
      <header class="ob-ed-header">
        <div class="ob-ed-header-group">
          <span class="ob-ed-brand"><a href="/edit">${escapeHtml(brandTitle)}</a></span>
          <select class="ob-ed-switcher" aria-label="Switch dashboard"></select>
        </div>
        <div class="ob-ed-header-group">
          <button type="button" class="ob-ed-btn-secondary" data-action="new">New</button>
          <button type="button" class="ob-ed-btn" data-action="save">Save</button>
          <a href="/d/${encodeURIComponent(name)}" target="_blank" rel="noopener">Open /d/${escapeHtml(name)} ↗</a>
        </div>
      </header>
      <div class="ob-ed-editor-host"></div>
      <div class="ob-ed-statusbar">
        <span class="ob-ed-state" aria-live="polite">loading…</span>
        <span class="ob-ed-hint">Cmd/Ctrl+S to save</span>
      </div>
    </div>
  `;

  const host = root.querySelector<HTMLDivElement>(".ob-ed-editor-host")!;
  const stateEl = root.querySelector<HTMLSpanElement>(".ob-ed-state")!;
  const saveBtn = root.querySelector<HTMLButtonElement>('[data-action="save"]')!;
  const newBtn = root.querySelector<HTMLButtonElement>('[data-action="new"]')!;
  const switcher = root.querySelector<HTMLSelectElement>(".ob-ed-switcher")!;

  let savedContent = "";
  let state: SaveState = { kind: "loading" };

  function setState(next: SaveState) {
    state = next;
    stateEl.textContent = statusText(state);
    stateEl.className = `ob-ed-state ${statusClass(state)}`;
    saveBtn.disabled = state.kind === "saving" || state.kind === "readonly" || state.kind === "loading";
  }

  const readonlyCompartment = new Compartment();

  function isDirty(): boolean {
    if (!view) return false;
    return view.state.doc.toString() !== savedContent;
  }

  async function doSave() {
    if (!view) return;
    if (state.kind === "readonly" || state.kind === "saving") return;
    const content = view.state.doc.toString();
    setState({ kind: "saving" });
    const res = await saveDashboard(name, content);
    if ("ok" in res) {
      savedContent = content;
      setDiagnostics(view.state, []);
      view.dispatch(setDiagnostics(view.state, []));
      setState({ kind: "saved" });
      return;
    }
    if (res.status === 422 && res.diagnostics) {
      showDiagnostics(view, res.diagnostics);
      setState({ kind: "error", message: "validation errors" });
      return;
    }
    if (res.status === 409 && res.error === "readonly") {
      setState({ kind: "readonly" });
      return;
    }
    setState({ kind: "error", message: res.message });
  }

  const saveKey = keymap.of([
    {
      key: "Mod-s",
      preventDefault: true,
      run: () => {
        void doSave();
        return true;
      },
    },
  ]);

  // Load content
  let initialContent: string;
  try {
    initialContent = await readDashboard(name);
    savedContent = initialContent;
  } catch (err) {
    setState({ kind: "error", message: `could not load: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: initialContent,
      extensions: [
        lineNumbers(),
        history(),
        boardLanguage(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        indentOnInput(),
        highlightActiveLine(),
        lintGutter(),
        autocompletion({ activateOnTyping: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap]),
        saveKey,
        readonlyCompartment.of(EditorState.readOnly.of(false)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            if (state.kind === "error" || state.kind === "saved" || state.kind === "loading") {
              if (isDirty()) setState({ kind: "dirty" });
              else setState({ kind: "saved" });
            } else if (state.kind === "dirty" && !isDirty()) {
              setState({ kind: "saved" });
            }
          }
        }),
      ],
    }),
  });

  setState({ kind: "saved" });

  saveBtn.addEventListener("click", () => void doSave());
  newBtn.addEventListener("click", () => {
    if (!confirmLeaveIfDirty()) return;
    promptNewDashboard(async (n) => {
      const res = await newDashboard(n);
      if ("ok" in res) {
        window.location.href = `/edit/${encodeURIComponent(n)}`;
        return null;
      }
      return res.message || res.error;
    });
  });

  // beforeunload guard
  window.addEventListener("beforeunload", (e) => {
    if (isDirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  function confirmLeaveIfDirty(): boolean {
    if (!isDirty()) return true;
    return window.confirm("You have unsaved changes. Discard them?");
  }

  // Populate switcher
  try {
    const dashboards = await listDashboards();
    dashboards.sort((a, b) => a.slug.localeCompare(b.slug));
    switcher.innerHTML = dashboards
      .map(
        (d) =>
          `<option value="${escapeHtml(d.slug)}"${d.slug === name ? " selected" : ""}>${escapeHtml(d.title || d.slug)}</option>`,
      )
      .join("");
    switcher.addEventListener("change", () => {
      const target = switcher.value;
      if (target === name) return;
      if (!confirmLeaveIfDirty()) {
        switcher.value = name;
        return;
      }
      window.location.href = `/edit/${encodeURIComponent(target)}`;
    });
  } catch {
    // non-fatal
  }
}

function showDiagnostics(view: EditorView, diagnostics: Diagnostic[]): void {
  const cm = mapDiagnostics(view.state.doc, diagnostics as ServerDiagnostic[]);
  view.dispatch(setDiagnostics(view.state, cm));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
