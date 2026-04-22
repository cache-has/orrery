export interface Diagnostic {
  level: "error" | "warning" | "info";
  message: string;
  span?: {
    start: { line: number; column: number; offset: number };
    end: { line: number; column: number; offset: number };
    file?: string;
  };
  hint?: string;
}

export interface DashboardListItem {
  slug: string;
  title: string;
  description?: string;
  lastModified: string;
  url: string;
}

export interface SaveSuccess {
  ok: true;
  path: string;
}

export interface SaveError {
  status: number;
  error: string;
  message: string;
  diagnostics?: Diagnostic[];
}

export async function listDashboards(): Promise<DashboardListItem[]> {
  const res = await fetch("/api/dashboards");
  if (!res.ok) throw new Error(`Failed to list dashboards: ${res.status}`);
  return res.json();
}

export async function readDashboard(name: string): Promise<string> {
  const res = await fetch(`/api/dashboards/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Failed to read "${name}": ${res.status}`);
  return res.text();
}

export async function saveDashboard(
  name: string,
  content: string,
): Promise<SaveSuccess | SaveError> {
  const res = await fetch(`/api/save/${encodeURIComponent(name)}`, {
    method: "POST",
    body: content,
    headers: { "Content-Type": "text/plain" },
  });
  if (res.ok) return res.json();
  const body = await res.json().catch(() => ({}));
  return {
    status: res.status,
    error: body.error ?? "unknown",
    message: body.message ?? res.statusText,
    diagnostics: body.diagnostics,
  };
}

export async function newDashboard(
  name: string,
): Promise<{ ok: true; name: string } | SaveError> {
  const res = await fetch("/api/new", {
    method: "POST",
    body: JSON.stringify({ name }),
    headers: { "Content-Type": "application/json" },
  });
  if (res.ok) return res.json();
  const body = await res.json().catch(() => ({}));
  return {
    status: res.status,
    error: body.error ?? "unknown",
    message: body.message ?? res.statusText,
  };
}
