// the language server's checks without the server: the jq79 language plugin
// and the services the server runs (TypeScript 5.9 through Volar, and the CSS
// service), over a list of files or a tsconfig. It is what test/check.mjs
// holds the virtual code to, as the editor reads it. jq79-check itself runs on
// TypeScript 7 (check7.ts), and the same tests run on that too
import * as path from "node:path"
import { createTypeScriptChecker, createTypeScriptInferredChecker } from "@volar/kit"
import { create as createCssService } from "volar-service-css"
import { create as createTypeScriptServices } from "volar-service-typescript"
import * as ts from "typescript"
import { createJq79LanguagePlugin, jq79Resolver } from "./language"

export { findComponents } from "./files"

// TypeScript's defaults plus allowJs, so JavaScript components are read too -
// their scripts type-checked only with checkJs (or `// @ts-check` in the
// script), as any JS file; their templates always
export const INFERRED_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  noEmit: true,
}

// a tsconfig's compiler options, as TypeScript reads them
const projectOptions = (project: string): ts.CompilerOptions => {
  const config = ts.readConfigFile(project, ts.sys.readFile)
  return ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, path.dirname(project)).options
}

// `setup` reaches Volar's project (its TypeScript host), for a test that needs
// to see past what the checker maps back to the .html
type Setup = Parameters<typeof createTypeScriptInferredChecker>[4]

export const createChecker = (files: string[] | { project: string }, options: ts.CompilerOptions = INFERRED_OPTIONS, setup?: Setup) => {
  // with the options the files are checked with: a tsconfig's paths can be
  // where "jq79" resolves
  const resolving = Array.isArray(files) ? options : projectOptions(files.project)
  const languages = [createJq79LanguagePlugin(ts, jq79Resolver(ts, resolving))]
  const services = [createCssService(), ...createTypeScriptServices(ts)]
  return Array.isArray(files)
    ? createTypeScriptInferredChecker(languages, services, () => files, options, setup)
    : createTypeScriptChecker(languages, services, files.project, false, setup)
}
