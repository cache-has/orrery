/**
 * Substitutes {{param_name}} placeholders in SQL with parameter values.
 * Returns the resolved SQL string.
 */
export function parameterize(sql: string, params: Record<string, string>): string {
  return sql.replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_match, name: string) => {
    if (!(name in params)) {
      throw new Error(`Unknown parameter: {{${name}}}`);
    }
    return params[name];
  });
}
