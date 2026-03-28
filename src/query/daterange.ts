/**
 * Date range resolution utilities.
 *
 * Resolves preset strings like "last 30 days" into concrete
 * { start, end, previous } date ranges. Used both server-side
 * for default param resolution and client-side for the preset picker.
 */

export interface ResolvedDateRange {
  start: string; // ISO date string YYYY-MM-DD
  end: string;
  previous: {
    start: string;
    end: string;
  };
}

export const DATE_RANGE_PRESETS: Record<string, string> = {
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  this_year: "This year",
};

/**
 * Normalize a preset label/key into a canonical key.
 * Accepts "last 30 days", "last_30_days", "Last 30 Days", etc.
 */
function normalizePresetKey(input: string): string {
  return input.toLowerCase().replace(/[\s-]+/g, "_").trim();
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Resolve a date range preset string into concrete dates.
 * Returns null if the string is not a recognized preset.
 *
 * @param preset - A preset key or label like "last 30 days"
 * @param now - Override current date for testing
 */
export function resolveDateRangePreset(
  preset: string,
  now: Date = new Date(),
): ResolvedDateRange | null {
  const key = normalizePresetKey(preset);
  const today = startOfDay(now);

  switch (key) {
    case "last_7_days": {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      const prevEnd = new Date(start);
      prevEnd.setDate(prevEnd.getDate() - 1);
      const prevStart = new Date(prevEnd);
      prevStart.setDate(prevStart.getDate() - 6);
      return {
        start: formatDate(start),
        end: formatDate(today),
        previous: { start: formatDate(prevStart), end: formatDate(prevEnd) },
      };
    }

    case "last_30_days": {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      const prevEnd = new Date(start);
      prevEnd.setDate(prevEnd.getDate() - 1);
      const prevStart = new Date(prevEnd);
      prevStart.setDate(prevStart.getDate() - 29);
      return {
        start: formatDate(start),
        end: formatDate(today),
        previous: { start: formatDate(prevStart), end: formatDate(prevEnd) },
      };
    }

    case "last_90_days": {
      const start = new Date(today);
      start.setDate(start.getDate() - 89);
      const prevEnd = new Date(start);
      prevEnd.setDate(prevEnd.getDate() - 1);
      const prevStart = new Date(prevEnd);
      prevStart.setDate(prevStart.getDate() - 89);
      return {
        start: formatDate(start),
        end: formatDate(today),
        previous: { start: formatDate(prevStart), end: formatDate(prevEnd) },
      };
    }

    case "this_month": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const prevEnd = new Date(start);
      prevEnd.setDate(prevEnd.getDate() - 1);
      return {
        start: formatDate(start),
        end: formatDate(today),
        previous: { start: formatDate(prevStart), end: formatDate(prevEnd) },
      };
    }

    case "last_month": {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0); // last day of prev month
      const prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
      const prevEnd = new Date(start);
      prevEnd.setDate(prevEnd.getDate() - 1);
      return {
        start: formatDate(start),
        end: formatDate(end),
        previous: { start: formatDate(prevStart), end: formatDate(prevEnd) },
      };
    }

    case "this_quarter": {
      const qMonth = Math.floor(today.getMonth() / 3) * 3;
      const start = new Date(today.getFullYear(), qMonth, 1);
      const prevQMonth = qMonth - 3;
      const prevStart = new Date(
        prevQMonth < 0 ? today.getFullYear() - 1 : today.getFullYear(),
        prevQMonth < 0 ? prevQMonth + 12 : prevQMonth,
        1,
      );
      const prevEnd = new Date(start);
      prevEnd.setDate(prevEnd.getDate() - 1);
      return {
        start: formatDate(start),
        end: formatDate(today),
        previous: { start: formatDate(prevStart), end: formatDate(prevEnd) },
      };
    }

    case "this_year": {
      const start = new Date(today.getFullYear(), 0, 1);
      const prevStart = new Date(today.getFullYear() - 1, 0, 1);
      const prevEnd = new Date(today.getFullYear() - 1, 11, 31);
      return {
        start: formatDate(start),
        end: formatDate(today),
        previous: { start: formatDate(prevStart), end: formatDate(prevEnd) },
      };
    }

    default:
      return null;
  }
}

/**
 * Resolve a date range value — either a preset string or a custom { start, end } object.
 * Returns a full ResolvedDateRange with computed previous period.
 */
export function resolveDateRange(
  value: unknown,
  now: Date = new Date(),
): ResolvedDateRange {
  // Preset string
  if (typeof value === "string") {
    const resolved = resolveDateRangePreset(value, now);
    if (resolved) return resolved;

    // Fallback: treat as "last 30 days" if unrecognized
    return resolveDateRangePreset("last_30_days", now)!;
  }

  // Custom { start, end } object
  if (value && typeof value === "object" && "start" in value && "end" in value) {
    const obj = value as { start: string; end: string };
    // Parse as local dates to avoid timezone issues
    const [sy, sm, sd] = obj.start.split("-").map(Number);
    const [ey, em, ed] = obj.end.split("-").map(Number);
    const startDate = new Date(sy, sm - 1, sd);
    const endDate = new Date(ey, em - 1, ed);
    const daySpan = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    const prevEnd = new Date(startDate);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - daySpan);

    return {
      start: obj.start,
      end: obj.end,
      previous: { start: formatDate(prevStart), end: formatDate(prevEnd) },
    };
  }

  // Fallback
  return resolveDateRangePreset("last_30_days", now)!;
}
