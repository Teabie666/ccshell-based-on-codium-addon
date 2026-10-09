/**
 * Language configurations (comment tokens for Ctrl+/, brackets, auto-closing pairs, indent
 * rules), taken from Monaco's own language definitions. Only their `conf` is used: Shiki
 * tokenizes, so their Monarch tokenizers are never registered. Loaded per language.
 */

import type { MonacoApi } from './monaco';

type LanguageConfiguration = Parameters<MonacoApi['languages']['setLanguageConfiguration']>[1];
type ConfLoader = () => Promise<{ conf: LanguageConfiguration }>;

/** Monaco definition modules by VS Code language id. */
const DEFINITIONS: Readonly<Record<string, ConfLoader>> = {
  typescript: () => import('monaco-editor/languages/definitions/typescript/typescript.js'),
  typescriptreact: () => import('monaco-editor/languages/definitions/typescript/typescript.js'),
  javascript: () => import('monaco-editor/languages/definitions/javascript/javascript.js'),
  javascriptreact: () => import('monaco-editor/languages/definitions/javascript/javascript.js'),
  python: () => import('monaco-editor/languages/definitions/python/python.js'),
  c: () => import('monaco-editor/languages/definitions/cpp/cpp.js'),
  cpp: () => import('monaco-editor/languages/definitions/cpp/cpp.js'),
  'cuda-cpp': () => import('monaco-editor/languages/definitions/cpp/cpp.js'),
  'objective-c': () => import('monaco-editor/languages/definitions/objective-c/objective-c.js'),
  csharp: () => import('monaco-editor/languages/definitions/csharp/csharp.js'),
  fsharp: () => import('monaco-editor/languages/definitions/fsharp/fsharp.js'),
  vb: () => import('monaco-editor/languages/definitions/vb/vb.js'),
  java: () => import('monaco-editor/languages/definitions/java/java.js'),
  kotlin: () => import('monaco-editor/languages/definitions/kotlin/kotlin.js'),
  scala: () => import('monaco-editor/languages/definitions/scala/scala.js'),
  go: () => import('monaco-editor/languages/definitions/go/go.js'),
  rust: () => import('monaco-editor/languages/definitions/rust/rust.js'),
  swift: () => import('monaco-editor/languages/definitions/swift/swift.js'),
  dart: () => import('monaco-editor/languages/definitions/dart/dart.js'),
  ruby: () => import('monaco-editor/languages/definitions/ruby/ruby.js'),
  php: () => import('monaco-editor/languages/definitions/php/php.js'),
  perl: () => import('monaco-editor/languages/definitions/perl/perl.js'),
  lua: () => import('monaco-editor/languages/definitions/lua/lua.js'),
  r: () => import('monaco-editor/languages/definitions/r/r.js'),
  julia: () => import('monaco-editor/languages/definitions/julia/julia.js'),
  elixir: () => import('monaco-editor/languages/definitions/elixir/elixir.js'),
  clojure: () => import('monaco-editor/languages/definitions/clojure/clojure.js'),
  html: () => import('monaco-editor/languages/definitions/html/html.js'),
  vue: () => import('monaco-editor/languages/definitions/html/html.js'),
  css: () => import('monaco-editor/languages/definitions/css/css.js'),
  scss: () => import('monaco-editor/languages/definitions/scss/scss.js'),
  less: () => import('monaco-editor/languages/definitions/less/less.js'),
  xml: () => import('monaco-editor/languages/definitions/xml/xml.js'),
  yaml: () => import('monaco-editor/languages/definitions/yaml/yaml.js'),
  ini: () => import('monaco-editor/languages/definitions/ini/ini.js'),
  properties: () => import('monaco-editor/languages/definitions/ini/ini.js'),
  toml: () => import('monaco-editor/languages/definitions/ini/ini.js'),
  powershell: () => import('monaco-editor/languages/definitions/powershell/powershell.js'),
  shellscript: () => import('monaco-editor/languages/definitions/shell/shell.js'),
  dotenv: () => import('monaco-editor/languages/definitions/shell/shell.js'),
  ignore: () => import('monaco-editor/languages/definitions/shell/shell.js'),
  bat: () => import('monaco-editor/languages/definitions/bat/bat.js'),
  dockerfile: () => import('monaco-editor/languages/definitions/dockerfile/dockerfile.js'),
  sql: () => import('monaco-editor/languages/definitions/sql/sql.js'),
  graphql: () => import('monaco-editor/languages/definitions/graphql/graphql.js'),
  proto: () => import('monaco-editor/languages/definitions/protobuf/protobuf.js'),
  markdown: () => import('monaco-editor/languages/definitions/markdown/markdown.js'),
  mdx: () => import('monaco-editor/languages/definitions/mdx/mdx.js'),
  restructuredtext: () => import('monaco-editor/languages/definitions/restructuredtext/restructuredtext.js'),
  hcl: () => import('monaco-editor/languages/definitions/hcl/hcl.js'),
  terraform: () => import('monaco-editor/languages/definitions/hcl/hcl.js'),
  handlebars: () => import('monaco-editor/languages/definitions/handlebars/handlebars.js'),
  razor: () => import('monaco-editor/languages/definitions/razor/razor.js'),
  coffeescript: () => import('monaco-editor/languages/definitions/coffee/coffee.js'),
};

/** JSON has no Monaco definition module (its support is a language service); as VS Code's. */
const JSON_CONF: LanguageConfiguration = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [
    ['{', '}'],
    ['[', ']'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}', notIn: ['string'] },
    { open: '[', close: ']', notIn: ['string'] },
    { open: '"', close: '"', notIn: ['string'] },
  ],
};
const BUILT_IN: Readonly<Record<string, LanguageConfiguration>> = {
  json: JSON_CONF,
  jsonc: JSON_CONF,
  json5: JSON_CONF,
  jsonl: JSON_CONF,
};

const configured = new Set<string>();

/** Sets the language configuration of `languageId` once (it must be registered with Monaco). */
export async function configureLanguage(monaco: MonacoApi, languageId: string): Promise<void> {
  if (configured.has(languageId)) {
    return;
  }
  configured.add(languageId);
  const conf = BUILT_IN[languageId] ?? (await DEFINITIONS[languageId]?.())?.conf;
  if (conf) {
    monaco.languages.setLanguageConfiguration(languageId, conf);
  }
}
