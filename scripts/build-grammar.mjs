#!/usr/bin/env node
// Compiles src/editor-client/language/board.grammar into
// src/editor-client/language/board-parser.ts. The output is committed so the
// runtime editor bundle does not pull in @lezer/generator.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildParserFile } from "@lezer/generator";

const __dirname = dirname(fileURLToPath(import.meta.url));
const grammarPath = resolve(__dirname, "../src/editor-client/language/board.grammar");
const outPath = resolve(__dirname, "../src/editor-client/language/board-parser.ts");

const grammar = await readFile(grammarPath, "utf8");
const { parser, terms } = buildParserFile(grammar, {
  fileName: grammarPath,
  moduleStyle: "es",
});

const header = `// THIS FILE IS GENERATED — do not edit by hand.
// Regenerate with: npm run build:grammar
// Source: board.grammar
/* eslint-disable */
`;

// buildParserFile emits two JS modules (parser + terms). We inline the terms
// into the parser file so callers only need one import.
const termsBody = terms.replace(/^\s*export\s+/gm, "export ");
const parserBody = parser.replace(/from\s+"\.\/[^"]+"/g, '').replace(/import\s*\{[^}]*\}\s*from\s*""\s*;?/g, "");

await writeFile(outPath, `${header}${termsBody}\n${parserBody}\n`);

console.log(`Wrote ${outPath}`);
