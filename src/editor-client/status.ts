export type SaveState =
  | { kind: "loading" }
  | { kind: "saved" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "readonly" };

export function statusText(s: SaveState): string {
  switch (s.kind) {
    case "loading":
      return "loading…";
    case "saved":
      return "saved";
    case "dirty":
      return "unsaved changes";
    case "saving":
      return "saving…";
    case "error":
      return `error: ${s.message}`;
    case "readonly":
      return "source is read-only";
  }
}

export function statusClass(s: SaveState): string {
  switch (s.kind) {
    case "saved":
      return "ob-ed-state-saved";
    case "dirty":
      return "ob-ed-state-dirty";
    case "saving":
      return "ob-ed-state-saving";
    case "error":
      return "ob-ed-state-error";
    case "readonly":
      return "ob-ed-state-readonly";
    default:
      return "";
  }
}
