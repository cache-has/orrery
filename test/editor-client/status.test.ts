import { describe, it, expect } from "vitest";
import { statusText, statusClass, type SaveState } from "../../src/editor-client/status.js";

describe("editor-client status", () => {
  const cases: Array<[SaveState, string, string]> = [
    [{ kind: "loading" }, "loading…", ""],
    [{ kind: "saved" }, "saved", "ob-ed-state-saved"],
    [{ kind: "dirty" }, "unsaved changes", "ob-ed-state-dirty"],
    [{ kind: "saving" }, "saving…", "ob-ed-state-saving"],
    [{ kind: "error", message: "boom" }, "error: boom", "ob-ed-state-error"],
    [{ kind: "readonly" }, "source is read-only", "ob-ed-state-readonly"],
  ];
  for (const [state, text, cls] of cases) {
    it(`maps ${state.kind} to text and class`, () => {
      expect(statusText(state)).toBe(text);
      expect(statusClass(state)).toBe(cls);
    });
  }
});
