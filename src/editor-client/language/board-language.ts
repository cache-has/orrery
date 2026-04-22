import { LRLanguage, LanguageSupport } from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import { parser as boardParser } from "./board-parser.js";
import {
  createBoardCompletionSource,
  defaultFetchConnections,
  type BoardCompletionOptions,
} from "./board-completion.js";
import { createBoardLinter, type BoardLinterOptions } from "./board-lint.js";

/**
 * CodeMirror language pack for the OpenBoard `.board` DSL.
 *
 * The Lezer parser is kept intentionally loose (see board.grammar): it
 * recognizes every token anywhere, so rich structural checks remain the
 * runtime parser's job. That keeps this grammar small and highlighting
 * resilient to edits that would break a stricter parser mid-keystroke.
 */

const boardHighlight = styleTags({
  Keyword: t.keyword,
  ComponentType: t.typeName,
  ParamType: t.typeName,
  ChartType: t.typeName,
  FormatName: t.atom,
  HeaderOption: t.propertyName,
  Boolean: t.bool,
  Identifier: t.propertyName,
  String: t.string,
  TripleString: t.string,
  Number: t.number,
  LineComment: t.lineComment,
  "{ }": t.brace,
  "( )": t.paren,
  "[ ]": t.squareBracket,
  ": , =": t.punctuation,
});

export const boardLanguageData = LRLanguage.define({
  name: "board",
  parser: boardParser.configure({
    props: [boardHighlight],
  }),
  languageData: {
    commentTokens: { line: "#" },
    closeBrackets: { brackets: ["(", "[", "{", '"'] },
    indentOnInput: /^\s*[}\])]$/,
  },
});

export interface BoardLanguageOptions extends BoardCompletionOptions, BoardLinterOptions {
  /** Set to false to disable the default `/api/connections` fetcher when
   * no explicit `fetchConnections` is supplied. Useful in tests. */
  useDefaultConnectionsFetcher?: boolean;
  /** Disable the live linter extension. Defaults to enabled. */
  linter?: boolean;
}

/**
 * Public entry point. Returns a `LanguageSupport` that the editor page
 * adds to its extensions array. Optional hooks wire context-aware
 * autocomplete, including connection-name completion, and a debounced
 * linter hitting the server's `/api/validate`.
 */
export function boardLanguage(options: BoardLanguageOptions = {}): LanguageSupport {
  const fetchConnections =
    options.fetchConnections ??
    (options.useDefaultConnectionsFetcher !== false ? defaultFetchConnections : undefined);

  const completion = boardLanguageData.data.of({
    autocomplete: createBoardCompletionSource({ fetchConnections }),
  });

  const extensions = [completion];
  if (options.linter !== false) {
    extensions.push(
      createBoardLinter({
        lintEndpoint: options.lintEndpoint,
        fetchImpl: options.fetchImpl,
        delay: options.delay,
      }),
    );
  }

  return new LanguageSupport(boardLanguageData, extensions);
}
