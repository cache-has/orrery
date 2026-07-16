import pkg from "../package.json";

/**
 * The Orrery version, sourced from package.json so it can never drift from
 * the released package. tsup inlines the JSON at build time.
 */
export const VERSION: string = pkg.version;
