// Copyright (c) 2026 Horizon Analytic Studios, LLC. All rights reserved.
// SPDX-License-Identifier: MIT OR Apache-2.0

// Arrow → DuckDB type mapping for the Orrery sink plugin.
//
// Supported in v1.1:
//   - Bool, Int8/16/32/64 (signed and unsigned), Float32/64
//   - Utf8, LargeUtf8, Binary, LargeBinary, FixedSizeBinary
//   - Dictionary<…, Utf8> (transparent — values materialized)
//   - Date32 (DateDay) and Date64 (DateMillisecond)
//   - Timestamp (Second / Millisecond / Microsecond / Nanosecond), with or
//     without a timezone. Unit is preserved when possible (DuckDB has
//     TIMESTAMP_S/_MS/TIMESTAMP/TIMESTAMP_NS); timestamps with a timezone
//     always land as TIMESTAMPTZ (microsecond precision in DuckDB).
//   - Decimal128 (mapped to DuckDB DECIMAL(precision, scale))
//
// Still rejected with UnsupportedTypeError:
//   - Time (any unit) — rare in analytics workloads
//   - Decimal256 — DuckDB DECIMAL is at most 38 digits (≈ 128 bits)
//   - List, Struct, Union, Map, Interval, Duration, FixedSizeList — out of
//     scope for the v1 sink.

import { DataType, DateUnit, Decimal, Field, Schema, TimeUnit, Type } from 'apache-arrow';

export class UnsupportedTypeError extends Error {
  constructor(public readonly column: string, public readonly arrowType: string) {
    super(
      `column "${column}" has Arrow type ${arrowType}, which the Orrery sink does not support`,
    );
    this.name = 'UnsupportedTypeError';
  }
}

/**
 * Discriminator carried in `ColumnPlan.subtype` for types whose value
 * extraction needs more than the SQL type string. Lets the sink dispatch
 * temporal/decimal columns onto the correct DuckDB appender method.
 */
export type ColumnSubtype =
  | { kind: 'date_day' }
  | { kind: 'date_millisecond' }
  | { kind: 'timestamp'; unit: TimeUnit; timezone: string | null }
  | { kind: 'decimal128'; precision: number; scale: number };

export interface ColumnPlan {
  name: string;
  /** DuckDB SQL type, e.g. INTEGER, DECIMAL(5,2), TIMESTAMPTZ */
  sqlType: string;
  /** Arrow Type enum value (kept for back-compat with prior callers) */
  arrowTypeId: Type;
  /** True if Int64 / UInt64 — values come from arrow as BigInt */
  bigInt: boolean;
  /** Present for date / timestamp / decimal columns. */
  subtype?: ColumnSubtype;
}

/** Render a DuckDB SQL type for an Arrow field, or throw if unsupported. */
export function arrowFieldToDuckDBSql(field: Field): string {
  return planField(field).sqlType;
}

/** Build a full ColumnPlan for a single field, or throw if unsupported. */
function planField(field: Field): ColumnPlan {
  const t = field.type;

  // Dictionary-encoded columns are transparent — materialize the decoded
  // values via the inner type.
  if (t.typeId === Type.Dictionary) {
    const inner = (t as DataType & { dictionary: DataType }).dictionary;
    return planField(new Field(field.name, inner, field.nullable));
  }

  switch (t.typeId) {
    case Type.Bool:
      return { name: field.name, sqlType: 'BOOLEAN', arrowTypeId: t.typeId, bigInt: false };

    case Type.Int: {
      const it = t as DataType & { bitWidth: number; isSigned: boolean };
      const sql = intSqlType(field.name, it);
      return {
        name: field.name,
        sqlType: sql,
        arrowTypeId: t.typeId,
        bigInt: it.bitWidth === 64,
      };
    }

    case Type.Float: {
      const ft = t as DataType & { precision: number };
      // Arrow Precision: HALF=0, SINGLE=1, DOUBLE=2
      if (ft.precision === 1) return { name: field.name, sqlType: 'FLOAT', arrowTypeId: t.typeId, bigInt: false };
      if (ft.precision === 2) return { name: field.name, sqlType: 'DOUBLE', arrowTypeId: t.typeId, bigInt: false };
      throw new UnsupportedTypeError(field.name, `Float(precision=${ft.precision})`);
    }

    case Type.Utf8:
    case Type.LargeUtf8:
      return { name: field.name, sqlType: 'VARCHAR', arrowTypeId: t.typeId, bigInt: false };

    case Type.Binary:
    case Type.LargeBinary:
    case Type.FixedSizeBinary:
      return { name: field.name, sqlType: 'BLOB', arrowTypeId: t.typeId, bigInt: false };

    case Type.Date: {
      // Apache-arrow JS uses one typeId (Type.Date) for both Date32 and
      // Date64 and discriminates them via .unit.
      const dt = t as DataType & { unit: DateUnit };
      if (dt.unit === DateUnit.DAY) {
        return {
          name: field.name,
          sqlType: 'DATE',
          arrowTypeId: t.typeId,
          bigInt: false,
          subtype: { kind: 'date_day' },
        };
      }
      return {
        name: field.name,
        sqlType: 'DATE',
        arrowTypeId: t.typeId,
        bigInt: false,
        subtype: { kind: 'date_millisecond' },
      };
    }

    case Type.Timestamp: {
      // Same shape as Date — one typeId, .unit + .timezone discriminate.
      const tt = t as DataType & { unit: TimeUnit; timezone?: string | null };
      const tz = tt.timezone ?? null;
      const sql = tz != null ? 'TIMESTAMPTZ' : timestampSqlForUnit(tt.unit);
      return {
        name: field.name,
        sqlType: sql,
        arrowTypeId: t.typeId,
        bigInt: false,
        subtype: { kind: 'timestamp', unit: tt.unit, timezone: tz },
      };
    }

    case Type.Decimal: {
      const dt = t as Decimal;
      if (dt.bitWidth !== 128) {
        throw new UnsupportedTypeError(
          field.name,
          `Decimal(bitWidth=${dt.bitWidth}) — only 128-bit decimals are supported`,
        );
      }
      // DuckDB DECIMAL caps at 38 digits of precision.
      if (dt.precision > 38) {
        throw new UnsupportedTypeError(
          field.name,
          `Decimal(precision=${dt.precision}) — DuckDB DECIMAL supports at most 38 digits`,
        );
      }
      return {
        name: field.name,
        sqlType: `DECIMAL(${dt.precision},${dt.scale})`,
        arrowTypeId: t.typeId,
        bigInt: false,
        subtype: { kind: 'decimal128', precision: dt.precision, scale: dt.scale },
      };
    }

    default:
      throw new UnsupportedTypeError(field.name, t.toString());
  }
}

function intSqlType(name: string, it: { bitWidth: number; isSigned: boolean }): string {
  if (it.isSigned) {
    switch (it.bitWidth) {
      case 8: return 'TINYINT';
      case 16: return 'SMALLINT';
      case 32: return 'INTEGER';
      case 64: return 'BIGINT';
    }
  } else {
    switch (it.bitWidth) {
      case 8: return 'UTINYINT';
      case 16: return 'USMALLINT';
      case 32: return 'UINTEGER';
      case 64: return 'UBIGINT';
    }
  }
  throw new UnsupportedTypeError(name, `Int(bitWidth=${it.bitWidth})`);
}

function timestampSqlForUnit(unit: TimeUnit): string {
  switch (unit) {
    case TimeUnit.SECOND: return 'TIMESTAMP_S';
    case TimeUnit.MILLISECOND: return 'TIMESTAMP_MS';
    case TimeUnit.MICROSECOND: return 'TIMESTAMP';
    case TimeUnit.NANOSECOND: return 'TIMESTAMP_NS';
  }
  throw new Error(`internal: unknown TimeUnit ${unit}`);
}

export function planColumns(schema: Schema): ColumnPlan[] {
  return schema.fields.map(planField);
}

/** Build a `CREATE TABLE "name" (...)` statement from a column plan. */
export function buildCreateTableSql(table: string, plan: ColumnPlan[]): string {
  const cols = plan
    .map((c) => `${quoteIdent(c.name)} ${c.sqlType}`)
    .join(', ');
  return `CREATE TABLE ${quoteIdent(table)} (${cols})`;
}

export function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * Compare two column plans for compatibility (used by append/upsert modes
 * to validate that incoming batches match the existing table schema).
 * Returns null if compatible, otherwise a human-readable description of
 * the first mismatch.
 *
 * Type comparison is normalized so that DuckDB's `information_schema`
 * spellings (e.g. `DECIMAL(5,2)` with optional spaces, `TIMESTAMP WITH TIME
 * ZONE`) match the strings produced by [`planField`] above.
 */
export function diffColumnPlans(existing: ColumnPlan[], incoming: ColumnPlan[]): string | null {
  if (existing.length !== incoming.length) {
    return `column count mismatch: existing=${existing.length} incoming=${incoming.length}`;
  }
  for (let i = 0; i < existing.length; i++) {
    const a = existing[i];
    const b = incoming[i];
    if (a.name !== b.name) {
      return `column ${i}: name mismatch (existing="${a.name}" incoming="${b.name}")`;
    }
    if (normalizeSqlType(a.sqlType) !== normalizeSqlType(b.sqlType)) {
      return `column "${a.name}": type mismatch (existing=${a.sqlType} incoming=${b.sqlType})`;
    }
  }
  return null;
}

function normalizeSqlType(t: string): string {
  return t
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/TIMESTAMPWITHTIMEZONE/, 'TIMESTAMPTZ');
}
