import { Lexer } from "../parser/lexer.js";

const files = process.argv.slice(2);

if (files.length === 0) {
  console.log("Usage: openboard validate <file.board> [file2.board ...]");
  process.exit(1);
}

// TODO: Full validation in phase 03 (parser) — for now, validate lexing only
let hasErrors = false;

for (const file of files) {
  try {
    const source = await import("fs").then((fs) => fs.readFileSync(file, "utf-8"));
    const lexer = new Lexer(source, file);
    const tokens = lexer.tokenize();
    console.log(`  ✓ ${file} (${tokens.length} tokens)`);
  } catch (err) {
    hasErrors = true;
    console.error(`  ✗ ${file}: ${err instanceof Error ? err.message : err}`);
  }
}

process.exit(hasErrors ? 1 : 0);
