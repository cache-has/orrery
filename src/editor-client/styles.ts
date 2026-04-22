export const EDITOR_CSS = `
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; color: #1a1a1a; background: #fff; }
a { color: #2563eb; text-decoration: none; }
a:hover { text-decoration: underline; }
button { font: inherit; cursor: pointer; }

/* List page */
.ob-ed-list-wrap { max-width: 900px; margin: 0 auto; padding: 2rem; }
.ob-ed-list-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
.ob-ed-list-head h1 { font-size: 1.5rem; margin: 0; }
.ob-ed-list-head .ob-ed-nav { display: flex; gap: 1rem; align-items: center; }
.ob-ed-btn { background: #2563eb; color: #fff; border: none; padding: 0.5rem 1rem; border-radius: 6px; font-weight: 500; }
.ob-ed-btn:hover { background: #1d4ed8; }
.ob-ed-btn:disabled { background: #9ca3af; cursor: not-allowed; }
.ob-ed-list { list-style: none; margin: 0; padding: 0; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
.ob-ed-list li { border-bottom: 1px solid #e5e7eb; }
.ob-ed-list li:last-child { border-bottom: none; }
.ob-ed-list a.ob-ed-row { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; color: inherit; }
.ob-ed-list a.ob-ed-row:hover { background: #f9fafb; text-decoration: none; }
.ob-ed-list .ob-ed-name { font-weight: 500; }
.ob-ed-list .ob-ed-modified { color: #6b7280; font-size: 0.85rem; }
.ob-ed-empty { color: #6b7280; padding: 2rem; text-align: center; }

/* Editor page */
.ob-ed-page { display: flex; flex-direction: column; height: 100vh; }
.ob-ed-header { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 1rem; border-bottom: 1px solid #e5e7eb; background: #f9fafb; gap: 1rem; flex-wrap: wrap; }
.ob-ed-header .ob-ed-brand { font-weight: 600; }
.ob-ed-header .ob-ed-brand a { color: inherit; }
.ob-ed-header-group { display: flex; align-items: center; gap: 0.75rem; }
.ob-ed-switcher { padding: 0.25rem 0.5rem; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; }
.ob-ed-editor-host { flex: 1; min-height: 0; overflow: auto; }
.ob-ed-editor-host .cm-editor { height: 100%; }
.ob-ed-statusbar { display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 1rem; border-top: 1px solid #e5e7eb; background: #f9fafb; font-size: 0.85rem; color: #4b5563; min-height: 1.75rem; }
.ob-ed-statusbar .ob-ed-state-saved { color: #059669; }
.ob-ed-statusbar .ob-ed-state-dirty { color: #d97706; }
.ob-ed-statusbar .ob-ed-state-saving { color: #2563eb; }
.ob-ed-statusbar .ob-ed-state-error { color: #dc2626; }
.ob-ed-statusbar .ob-ed-state-readonly { color: #6b7280; }

/* Modal */
.ob-ed-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 50; }
.ob-ed-modal { background: #fff; border-radius: 8px; padding: 1.25rem; width: min(420px, 90vw); box-shadow: 0 10px 25px rgba(0,0,0,0.15); }
.ob-ed-modal h2 { margin: 0 0 0.75rem; font-size: 1.1rem; }
.ob-ed-modal label { display: block; font-size: 0.85rem; margin-bottom: 0.35rem; color: #374151; }
.ob-ed-modal input { width: 100%; padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 4px; font: inherit; }
.ob-ed-modal-hint { font-size: 0.8rem; color: #6b7280; margin-top: 0.35rem; }
.ob-ed-modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
.ob-ed-btn-secondary { background: #fff; color: #374151; border: 1px solid #d1d5db; padding: 0.5rem 1rem; border-radius: 6px; }
.ob-ed-btn-secondary:hover { background: #f3f4f6; }
.ob-ed-modal-error { color: #dc2626; font-size: 0.85rem; margin-top: 0.5rem; }
`;

export function injectStyles(): void {
  if (document.getElementById("ob-ed-styles")) return;
  const style = document.createElement("style");
  style.id = "ob-ed-styles";
  style.textContent = EDITOR_CSS;
  document.head.appendChild(style);
}
