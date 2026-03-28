/**
 * OpenBoard CSS stylesheet as a string constant.
 * Served inline in SSR pages and available as a static asset.
 */
export const OPENBOARD_CSS = `
/* =========================================================================
   OpenBoard — Dashboard Styles
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

.openboard-root {
  max-width: 1400px;
  margin: 0 auto;
  padding: 1.5rem 1rem;
}

.openboard-header {
  margin-bottom: 1.5rem;
}

.openboard-header h1 {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--ob-text);
}

.openboard-header .openboard-description {
  color: var(--ob-text-muted);
  font-size: 0.875rem;
  margin-top: 0.25rem;
}

/* =========================================================================
   Parameter bar
   ========================================================================= */

.openboard-params {
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

.openboard-param {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.openboard-param label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--ob-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.openboard-param input,
.openboard-param select {
  font-family: var(--ob-font);
  font-size: 0.875rem;
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--ob-border);
  border-radius: 4px;
  background: var(--ob-surface);
  color: var(--ob-text);
}

.openboard-param input:focus,
.openboard-param select:focus {
  outline: none;
  border-color: var(--ob-primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

/* Date range picker */
.openboard-daterange {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.openboard-daterange-custom {
  display: flex;
  gap: 0.25rem;
  align-items: center;
}

.openboard-daterange-sep {
  font-size: 0.75rem;
  color: var(--ob-text-muted);
  padding: 0 0.125rem;
}

/* Toggle switch */
.openboard-toggle {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
}

.openboard-toggle-track {
  display: inline-block;
  width: 36px;
  height: 20px;
  background: var(--ob-border);
  border-radius: 10px;
  position: relative;
  transition: background 0.15s ease;
}

.openboard-toggle-on .openboard-toggle-track {
  background: var(--ob-primary);
}

.openboard-toggle-thumb {
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

.openboard-toggle-on .openboard-toggle-thumb {
  transform: translateX(16px);
}

/* =========================================================================
   Grid layout — 12-column system
   ========================================================================= */

.openboard-row {
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
  .openboard-row {
    grid-template-columns: repeat(2, 1fr);
  }
  .openboard-component {
    grid-column: span 1 !important;
  }
}

/* Mobile: single column */
@media (max-width: 640px) {
  .openboard-root {
    padding: 1rem 0.5rem;
  }
  .openboard-row {
    grid-template-columns: 1fr;
  }
  .openboard-params {
    flex-direction: column;
    align-items: stretch;
  }
}

/* =========================================================================
   Component container
   ========================================================================= */

.openboard-component {
  background: var(--ob-surface);
  border: 1px solid var(--ob-border);
  border-radius: var(--ob-radius);
  box-shadow: var(--ob-shadow);
  display: flex;
  flex-direction: column;
  min-height: 120px;
  position: relative;
}

.openboard-component-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem 0.5rem;
  border-bottom: 1px solid var(--ob-border);
}

.openboard-component-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--ob-text);
  margin: 0;
}

.openboard-component-actions {
  display: flex;
  gap: 0.25rem;
}

.openboard-component-actions button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  color: var(--ob-text-muted);
  font-size: 0.875rem;
  line-height: 1;
}

.openboard-component-actions button:hover {
  background: var(--ob-bg);
  color: var(--ob-text);
}

.openboard-component-body {
  flex: 1;
  padding: 1rem;
  overflow: auto;
}

.openboard-component-footer {
  padding: 0.375rem 1rem;
  border-top: 1px solid var(--ob-border);
  display: flex;
  justify-content: flex-end;
}

.openboard-query-time {
  font-size: 0.6875rem;
  color: var(--ob-text-muted);
}

/* =========================================================================
   Error state
   ========================================================================= */

.openboard-error {
  background: var(--ob-error-bg);
  border: 1px solid var(--ob-error-border);
  border-radius: 4px;
  padding: 0.75rem 1rem;
  color: var(--ob-error-text);
  font-size: 0.8125rem;
}

.openboard-error-title {
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.openboard-error-message {
  font-family: var(--ob-font-mono);
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
}

/* =========================================================================
   Loading overlay (for partial updates)
   ========================================================================= */

.openboard-loading {
  position: absolute;
  inset: 0;
  background: var(--ob-loading-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--ob-radius);
  z-index: 10;
}

.openboard-spinner {
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

.openboard-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ob-text-muted);
  font-size: 0.8125rem;
  min-height: 80px;
}

.openboard-metric {
  text-align: center;
  padding: 0.5rem 0;
}

.openboard-metric-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--ob-text);
}

.openboard-metric-prefix,
.openboard-metric-suffix {
  font-size: 1.25rem;
  font-weight: 500;
  color: var(--ob-text-muted);
}

.openboard-metric-trend {
  margin-top: 0.5rem;
  font-size: 0.8125rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
}

.openboard-trend-up { color: #16a34a; }
.openboard-trend-down { color: #dc2626; }
.openboard-trend-flat { color: var(--ob-text-muted); }

.openboard-trend-arrow { font-size: 0.625rem; }

.openboard-trend-percent { font-weight: 600; }

.openboard-trend-label {
  color: var(--ob-text-muted);
  font-size: 0.75rem;
}

/* =========================================================================
   Chart components (ECharts SSR)
   ========================================================================= */

.openboard-chart-container {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.openboard-chart-container svg {
  width: 100%;
  height: auto;
  max-height: 400px;
}

.openboard-no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ob-text-muted);
  font-size: 0.8125rem;
  min-height: 80px;
}

.openboard-badge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--ob-bg);
  color: var(--ob-text);
}

.openboard-data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.openboard-data-table th {
  text-align: left;
  padding: 0.5rem 0.75rem;
  border-bottom: 2px solid var(--ob-border);
  font-weight: 600;
  font-size: 0.75rem;
  color: var(--ob-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.openboard-data-table td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--ob-border);
}

.openboard-data-table tr:last-child td {
  border-bottom: none;
}

/* =========================================================================
   Table component
   ========================================================================= */

.openboard-table-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.openboard-table-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.openboard-table-filter {
  font-family: var(--ob-font);
  font-size: 0.8125rem;
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--ob-border);
  border-radius: 4px;
  background: var(--ob-surface);
  color: var(--ob-text);
  min-width: 200px;
}

.openboard-table-filter:focus {
  outline: none;
  border-color: var(--ob-primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.openboard-table-csv-btn {
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

.openboard-table-csv-btn:hover {
  background: var(--ob-bg);
  color: var(--ob-text);
}

.openboard-table-scroll {
  overflow-x: auto;
}

.openboard-data-table-full {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.openboard-data-table-full thead {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--ob-surface);
}

.openboard-table-th {
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

.openboard-table-th[data-ob-sortable]:hover {
  color: var(--ob-text);
  background: var(--ob-bg);
}

.openboard-table-th[data-ob-align="center"] { text-align: center; }
.openboard-table-th[data-ob-align="right"] { text-align: right; }

.openboard-data-table-full td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--ob-border);
}

.openboard-data-table-full td[data-ob-align="center"] { text-align: center; }
.openboard-data-table-full td[data-ob-align="right"] { text-align: right; }

.openboard-data-table-full tr:last-child td {
  border-bottom: none;
}

.openboard-table-row-hidden {
  display: none;
}

.openboard-sort-icon {
  font-size: 0.625rem;
  margin-left: 0.25rem;
  color: var(--ob-text-muted);
}

.openboard-th-sorted-asc .openboard-sort-icon,
.openboard-th-sorted-desc .openboard-sort-icon {
  color: var(--ob-primary);
}

.openboard-table-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.25rem 0;
  font-size: 0.75rem;
  color: var(--ob-text-muted);
}

.openboard-table-row-count {
  font-size: 0.75rem;
}

.openboard-table-pagination {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.openboard-page-btn {
  font-family: var(--ob-font);
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--ob-border);
  border-radius: 4px;
  background: var(--ob-surface);
  color: var(--ob-text-muted);
  cursor: pointer;
}

.openboard-page-btn:hover:not(:disabled) {
  background: var(--ob-bg);
  color: var(--ob-text);
}

.openboard-page-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.openboard-page-info {
  font-size: 0.75rem;
}

/* Text/markdown component */
.openboard-text { font-size: 0.875rem; line-height: 1.6; }
.openboard-text p { margin-bottom: 0.5rem; }
.openboard-text p:last-child { margin-bottom: 0; }
.openboard-text strong { font-weight: 600; }
.openboard-text em { font-style: italic; }
.openboard-text code {
  background: var(--ob-bg);
  padding: 0.125rem 0.375rem;
  border-radius: 3px;
  font-family: var(--ob-font-mono);
  font-size: 0.85em;
}
.openboard-text pre {
  background: var(--ob-bg);
  padding: 0.75rem 1rem;
  border-radius: 4px;
  overflow-x: auto;
  margin-bottom: 0.5rem;
}
.openboard-text pre code {
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: 0.8125rem;
}
.openboard-text h1, .openboard-text h2, .openboard-text h3,
.openboard-text h4, .openboard-text h5, .openboard-text h6 {
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: var(--ob-text);
}
.openboard-text h1 { font-size: 1.25rem; }
.openboard-text h2 { font-size: 1.125rem; }
.openboard-text h3 { font-size: 1rem; }
.openboard-text ul, .openboard-text ol {
  margin-bottom: 0.5rem;
  padding-left: 1.5rem;
}
.openboard-text li { margin-bottom: 0.25rem; }
.openboard-text blockquote {
  border-left: 3px solid var(--ob-border);
  padding-left: 0.75rem;
  margin-bottom: 0.5rem;
  color: var(--ob-text-muted);
}
.openboard-text a {
  color: var(--ob-primary);
  text-decoration: none;
}
.openboard-text a:hover { text-decoration: underline; }
.openboard-text hr {
  border: none;
  border-top: 1px solid var(--ob-border);
  margin: 0.75rem 0;
}
.openboard-text table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 0.5rem;
  font-size: 0.8125rem;
}
.openboard-text th, .openboard-text td {
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--ob-border);
  text-align: left;
}
.openboard-text th {
  font-weight: 600;
  background: var(--ob-bg);
}
.openboard-text img { max-width: 100%; height: auto; }
.openboard-text-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ob-text-muted);
  font-size: 0.8125rem;
  min-height: 80px;
}
`;
