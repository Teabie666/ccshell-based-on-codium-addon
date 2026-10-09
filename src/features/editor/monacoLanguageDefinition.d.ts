// The shape of Monaco's language definition modules, which ship without type declarations.
// tsconfig.web.json maps `monaco-editor/languages/definitions/*` here for type checking only;
// the bundle uses the real modules. ccshell reads just their `conf` (languageConfig.ts).
import type { languages } from 'monaco-editor/editor/editor.api';

export declare const conf: languages.LanguageConfiguration;
export declare const language: unknown;
