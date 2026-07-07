/**
 * Orrery CSS stylesheet as a string constant.
 * Served inline in SSR pages and available as a static asset.
 */
export const ORRERY_CSS = `
/* =========================================================================
   Orrery — Dashboard Styles
   ========================================================================= */

/* Reset & base */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --ob-font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --ob-font-mono: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, monospace;
  --ob-bg: #f8f9fa;
  --ob-surface: #ffffff;
  --ob-border: #e2e8f0;
  --ob-text: #1a202c;
  --ob-text-muted: #718096;
  --ob-primary: #3b82f6;
  --ob-error-bg: #fef2f2;
  --ob-error-border: #fecaca;
  --ob-error-text: #991b1b;
  --ob-radius: 8px;
  --ob-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);
  --ob-loading-overlay: rgba(255, 255, 255, 0.7);
  --ob-gap: 1rem;
}

body {
  font-family: var(--ob-font);
  background: var(--ob-bg);
  color: var(--ob-text);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* =========================================================================
   Dashboard shell
   ========================================================================= */

.orrery-root {
  max-width: 1400px;
  margin: 0 auto;
  padding: 1.5rem 1rem;
}

.orrery-header {
  margin-bottom: 1.5rem;
}

.orrery-breadcrumb {
  margin-bottom: 0.5rem;
}

.orrery-breadcrumb a {
  font-size: 0.85rem;
  color: var(--ob-text-secondary, #666);
  text-decoration: none;
}

.orrery-breadcrumb a:hover {
  color: var(--ob-text-primary, #1a1a1a);
  text-decoration: underline;
}

.orrery-header-branding {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.375rem;
}

.orrery-header-logo {
  height: 28px;
  width: auto;
  object-fit: contain;
}

.orrery-header-brand {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--ob-text-muted);
  letter-spacing: 0.02em;
}

.orrery-header h1 {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--ob-text);
}

.orrery-header .orrery-description {
  color: var(--ob-text-muted);
  font-size: 0.875rem;
  margin-top: 0.25rem;
}

/* =========================================================================
   Parameter bar
   ========================================================================= */

.orrery-params {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-end;
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: var(--ob-surface);
  border: 1px solid var(--ob-border);
  border-radius: var(--ob-radius);
}

.orrery-param {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.orrery-param label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--ob-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.orrery-param input,
.orrery-param select {
  font-family: var(--ob-font);
  font-size: 0.875rem;
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--ob-border);
  border-radius: 4px;
  background: var(--ob-surface);
  color: var(--ob-text);
}

.orrery-param input:focus,
.orrery-param select:focus {
  outline: none;
  border-color: var(--ob-primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

/* Multi-select */
.orrery-multiselect {
  position: relative;
}

.orrery-multiselect-toggle {
  font-family: var(--ob-font);
  font-size: 0.875rem;
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--ob-border);
  border-radius: 4px;
  background: var(--ob-surface);
  color: var(--ob-text);
  cursor: pointer;
  text-align: left;
  min-width: 140px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.orrery-multiselect-toggle:focus {
  outline: none;
  border-color: var(--ob-primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.orrery-multiselect-dropdown {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 100;
  min-width: 180px;
  max-height: 240px;
  overflow-y: auto;
  margin-top: 2px;
  padding: 0.25rem 0;
  background: var(--ob-surface);
  border: 1px solid var(--ob-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.orrery-multiselect.open .orrery-multiselect-dropdown {
  display: block;
}

.orrery-multiselect-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.6rem;
  font-size: 0.85rem;
  cursor: pointer;
  text-transform: none;
  letter-spacing: normal;
  font-weight: normal;
  color: var(--ob-text);
}

.orrery-multiselect-item:hover {
  background: rgba(59, 130, 246, 0.08);
}

.orrery-multiselect-item input[type="checkbox"] {
  margin: 0;
  cursor: pointer;
}

/* Date range picker */
.orrery-daterange {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.orrery-daterange-custom {
  display: flex;
  gap: 0.25rem;
  align-items: center;
}

.orrery-daterange-sep {
  font-size: 0.75rem;
  color: var(--ob-text-muted);
  padding: 0 0.125rem;
}

/* Toggle switch */
.orrery-toggle {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
}

.orrery-toggle-track {
  display: inline-block;
  width: 36px;
  height: 20px;
  background: var(--ob-border);
  border-radius: 10px;
  position: relative;
  transition: background 0.15s ease;
}

.orrery-toggle-on .orrery-toggle-track {
  background: var(--ob-primary);
}

.orrery-toggle-thumb {
  display: block;
  width: 16px;
  height: 16px;
  background: white;
  border-radius: 50%;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform 0.15s ease;
  box-shadow: 0 1px 2px rgba(0,0,0,0.15);
}

.orrery-toggle-on .orrery-toggle-thumb {
  transform: translateX(16px);
}

/* =========================================================================
   Grid layout — 12-column system
   ========================================================================= */

.orrery-row {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: var(--ob-gap);
  margin-bottom: var(--ob-gap);
}

/* =========================================================================
   Responsive breakpoints
   ========================================================================= */

/* Tablet: 2-column max */
@media (max-width: 1024px) {
  .orrery-row {
    grid-template-columns: repeat(2, 1fr);
  }
  .orrery-component {
    grid-column: span 1 !important;
  }
}

/* Mobile: single column */
@media (max-width: 640px) {
  .orrery-root {
    padding: 1rem 0.5rem;
  }
  .orrery-row {
    grid-template-columns: 1fr;
  }
  .orrery-params {
    flex-direction: column;
    align-items: stretch;
  }
}

/* =========================================================================
   Component container
   ========================================================================= */

.orrery-component {
  background: var(--ob-surface);
  border: 1px solid var(--ob-border);
  border-radius: var(--ob-radius);
  box-shadow: var(--ob-shadow);
  display: flex;
  flex-direction: column;
  min-height: 120px;
  position: relative;
}

.orrery-component-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem 0.5rem;
  border-bottom: 1px solid var(--ob-border);
}

.orrery-component-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--ob-text);
  margin: 0;
}

.orrery-component-actions {
  display: flex;
  gap: 0.25rem;
}

.orrery-component-actions button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  color: var(--ob-text-muted);
  font-size: 0.875rem;
  line-height: 1;
}

.orrery-component-actions button:hover {
  background: var(--ob-bg);
  color: var(--ob-text);
}

.orrery-component-body {
  flex: 1;
  padding: 1rem;
  overflow: auto;
}

.orrery-component-footer {
  padding: 0.375rem 1rem;
  border-top: 1px solid var(--ob-border);
  display: flex;
  justify-content: flex-end;
}

.orrery-query-time {
  font-size: 0.6875rem;
  color: var(--ob-text-muted);
}

/* =========================================================================
   Error state
   ========================================================================= */

.orrery-error {
  background: var(--ob-error-bg);
  border: 1px solid var(--ob-error-border);
  border-radius: 4px;
  padding: 0.75rem 1rem;
  color: var(--ob-error-text);
  font-size: 0.8125rem;
}

.orrery-error-title {
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.orrery-error-message {
  font-family: var(--ob-font-mono);
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
}

/* =========================================================================
   Loading overlay (for partial updates)
   ========================================================================= */

.orrery-loading {
  position: absolute;
  inset: 0;
  background: var(--ob-loading-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--ob-radius);
  z-index: 10;
}

.orrery-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--ob-border);
  border-top-color: var(--ob-primary);
  border-radius: 50%;
  animation: ob-spin 0.6s linear infinite;
}

@keyframes ob-spin {
  to { transform: rotate(360deg); }
}

/* =========================================================================
   Placeholder content (before component library)
   ========================================================================= */

.orrery-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ob-text-muted);
  font-size: 0.8125rem;
  min-height: 80px;
}

.orrery-metric {
  text-align: center;
  padding: 0.5rem 0;
}

.orrery-metric-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--ob-text);
}

.orrery-metric-prefix,
.orrery-metric-suffix {
  font-size: 1.25rem;
  font-weight: 500;
  color: var(--ob-text-muted);
}

.orrery-metric-trend {
  margin-top: 0.5rem;
  font-size: 0.8125rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
}

.orrery-trend-up { color: #16a34a; }
.orrery-trend-down { color: #dc2626; }
.orrery-trend-flat { color: var(--ob-text-muted); }

.orrery-trend-arrow { font-size: 0.625rem; }

.orrery-trend-percent { font-weight: 600; }

.orrery-trend-label {
  color: var(--ob-text-muted);
  font-size: 0.75rem;
}

/* =========================================================================
   Chart components (ECharts SSR)
   ========================================================================= */

.orrery-chart-container {
  width: 100%;
  min-height: 350px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.orrery-chart-container svg {
  width: 100%;
  height: auto;
  max-height: 400px;
}

.orrery-no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ob-text-muted);
  font-size: 0.8125rem;
  min-height: 80px;
}

.orrery-badge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--ob-bg);
  color: var(--ob-text);
}

.orrery-data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.orrery-data-table th {
  text-align: left;
  padding: 0.5rem 0.75rem;
  border-bottom: 2px solid var(--ob-border);
  font-weight: 600;
  font-size: 0.75rem;
  color: var(--ob-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.orrery-data-table td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--ob-border);
}

.orrery-data-table tr:last-child td {
  border-bottom: none;
}

/* =========================================================================
   Table component
   ========================================================================= */

.orrery-table-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.orrery-table-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.orrery-table-filter {
  font-family: var(--ob-font);
  font-size: 0.8125rem;
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--ob-border);
  border-radius: 4px;
  background: var(--ob-surface);
  color: var(--ob-text);
  min-width: 200px;
}

.orrery-table-filter:focus {
  outline: none;
  border-color: var(--ob-primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.orrery-table-csv-btn {
  font-family: var(--ob-font);
  font-size: 0.75rem;
  padding: 0.375rem 0.625rem;
  border: 1px solid var(--ob-border);
  border-radius: 4px;
  background: var(--ob-surface);
  color: var(--ob-text-muted);
  cursor: pointer;
  white-space: nowrap;
}

.orrery-table-csv-btn:hover {
  background: var(--ob-bg);
  color: var(--ob-text);
}

.orrery-table-scroll {
  overflow-x: auto;
}

.orrery-data-table-full {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.orrery-data-table-full thead {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--ob-surface);
}

.orrery-table-th {
  text-align: left;
  padding: 0.5rem 0.75rem;
  border-bottom: 2px solid var(--ob-border);
  font-weight: 600;
  font-size: 0.75rem;
  color: var(--ob-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  user-select: none;
}

.orrery-table-th[data-ob-sortable]:hover {
  color: var(--ob-text);
  background: var(--ob-bg);
}

.orrery-table-th[data-ob-align="center"] { text-align: center; }
.orrery-table-th[data-ob-align="right"] { text-align: right; }

.orrery-data-table-full td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--ob-border);
}

.orrery-data-table-full td[data-ob-align="center"] { text-align: center; }
.orrery-data-table-full td[data-ob-align="right"] { text-align: right; }

.orrery-data-table-full tr:last-child td {
  border-bottom: none;
}

.orrery-table-row-hidden {
  display: none;
}

.orrery-sort-icon {
  font-size: 0.625rem;
  margin-left: 0.25rem;
  color: var(--ob-text-muted);
}

.orrery-th-sorted-asc .orrery-sort-icon,
.orrery-th-sorted-desc .orrery-sort-icon {
  color: var(--ob-primary);
}

.orrery-table-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.25rem 0;
  font-size: 0.75rem;
  color: var(--ob-text-muted);
}

.orrery-table-row-count {
  font-size: 0.75rem;
}

.orrery-table-pagination {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.orrery-page-btn {
  font-family: var(--ob-font);
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--ob-border);
  border-radius: 4px;
  background: var(--ob-surface);
  color: var(--ob-text-muted);
  cursor: pointer;
}

.orrery-page-btn:hover:not(:disabled) {
  background: var(--ob-bg);
  color: var(--ob-text);
}

.orrery-page-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.orrery-page-info {
  font-size: 0.75rem;
}

/* Text/markdown component */
.orrery-text { font-size: 0.875rem; line-height: 1.6; }
.orrery-text p { margin-bottom: 0.5rem; }
.orrery-text p:last-child { margin-bottom: 0; }
.orrery-text strong { font-weight: 600; }
.orrery-text em { font-style: italic; }
.orrery-text code {
  background: var(--ob-bg);
  padding: 0.125rem 0.375rem;
  border-radius: 3px;
  font-family: var(--ob-font-mono);
  font-size: 0.85em;
}
.orrery-text pre {
  background: var(--ob-bg);
  padding: 0.75rem 1rem;
  border-radius: 4px;
  overflow-x: auto;
  margin-bottom: 0.5rem;
}
.orrery-text pre code {
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: 0.8125rem;
}
.orrery-text h1, .orrery-text h2, .orrery-text h3,
.orrery-text h4, .orrery-text h5, .orrery-text h6 {
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: var(--ob-text);
}
.orrery-text h1 { font-size: 1.25rem; }
.orrery-text h2 { font-size: 1.125rem; }
.orrery-text h3 { font-size: 1rem; }
.orrery-text ul, .orrery-text ol {
  margin-bottom: 0.5rem;
  padding-left: 1.5rem;
}
.orrery-text li { margin-bottom: 0.25rem; }
.orrery-text blockquote {
  border-left: 3px solid var(--ob-border);
  padding-left: 0.75rem;
  margin-bottom: 0.5rem;
  color: var(--ob-text-muted);
}
.orrery-text a {
  color: var(--ob-primary);
  text-decoration: none;
}
.orrery-text a:hover { text-decoration: underline; }
.orrery-text hr {
  border: none;
  border-top: 1px solid var(--ob-border);
  margin: 0.75rem 0;
}
.orrery-text table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 0.5rem;
  font-size: 0.8125rem;
}
.orrery-text th, .orrery-text td {
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--ob-border);
  text-align: left;
}
.orrery-text th {
  font-weight: 600;
  background: var(--ob-bg);
}
.orrery-text img { max-width: 100%; height: auto; }
.orrery-text-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ob-text-muted);
  font-size: 0.8125rem;
  min-height: 80px;
}

/* =========================================================================
   Theme toggle (dev mode)
   ========================================================================= */

.orrery-theme-toggle {
  background: var(--ob-surface);
  border: 1px solid var(--ob-border);
  border-radius: 6px;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  font-size: 1rem;
  line-height: 1;
  color: var(--ob-text-muted);
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  transition: background 0.15s ease, color 0.15s ease;
}

.orrery-theme-toggle:hover {
  background: var(--ob-bg);
  color: var(--ob-text);
}

.orrery-header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.orrery-header-edit-link {
  display: inline-block;
  padding: 0.4rem 0.85rem;
  background: var(--ob-text, #1a1a1a);
  color: var(--ob-bg, #fff);
  border-radius: 6px;
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 500;
  white-space: nowrap;
}

.orrery-header-edit-link:hover {
  opacity: 0.85;
}

/* =========================================================================
   Print styles
   ========================================================================= */

@media print {
  /* Force light theme colors */
  :root {
    --ob-bg: #ffffff !important;
    --ob-surface: #ffffff !important;
    --ob-border: #d1d5db !important;
    --ob-text: #111827 !important;
    --ob-text-muted: #4b5563 !important;
    --ob-primary: #3b82f6 !important;
    --ob-shadow: none !important;
    --ob-loading-overlay: transparent !important;
  }

  body {
    background: #ffffff;
    color: #111827;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .orrery-root {
    max-width: 100%;
    padding: 0;
  }

  /* Hide interactive controls */
  .orrery-params,
  .orrery-component-actions,
  .orrery-table-toolbar,
  .orrery-table-pagination,
  .orrery-table-footer,
  .orrery-loading,
  .orrery-spinner,
  .orrery-theme-toggle,
  .orrery-header-actions,
  .orrery-page-btn,
  .orrery-table-csv-btn {
    display: none !important;
  }

  /* Remove component footer (query time) */
  .orrery-component-footer {
    display: none !important;
  }

  /* Remove box shadows and simplify borders */
  .orrery-component {
    box-shadow: none !important;
    border: 1px solid #d1d5db;
    break-inside: avoid;
  }

  /* Show all hidden table rows (pagination) */
  .orrery-table-row-hidden {
    display: table-row !important;
  }

  /* Page breaks between grid rows */
  .orrery-row {
    break-inside: avoid;
    page-break-inside: avoid;
    margin-bottom: 0.5rem;
  }

  /* Ensure charts render well */
  .orrery-chart-container svg {
    max-height: none;
    width: 100%;
    height: auto;
  }

  /* Simplify header for print */
  .orrery-header {
    margin-bottom: 0.75rem;
  }

  /* Hide links underlines */
  a { text-decoration: none !important; }

  /* Ensure table headers repeat on page breaks */
  .orrery-data-table thead,
  .orrery-data-table-full thead {
    display: table-header-group;
  }

  .orrery-data-table-full thead {
    position: static;
  }
}
`;
