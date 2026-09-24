import { afterAll, expect } from "vitest"

// The differential behind precompile(): `npm run check:precompile` runs the
// whole suite with this loaded first. Every test file then runs exactly as it
// does under `npm test`, while two things are recorded - every component
// source the runtime parsed (caught on its way into DOMParser) and every
// function it compiled (caught on its way into `new Function`) - and when the
// file is done, precompile() over those sources has to have produced every one
// of those functions. A function it missed is a function safe mode would have
// refused, on a page that renders what this test rendered.
//
// Recorded keys are the runtime's own [params, body], its //# sourceURL
// suffix removed, as makeFunction keys them (RECORD/2026-09-23.no-unsafe-eval.md)
const sources = new Set<string>()
const compiled = new Map<string, [string[], string]>()
const keyOf = (params: string[], body: string) => `${params.join(",")}\n${body}`

const RealFunction = globalThis.Function
globalThis.Function = new Proxy(RealFunction, {
  construct(target, args: string[]) {
    const params = args.slice(0, -1)
    // the runtime's functions, and nobody else's: an expression's or a script's
    if (params[0] === "$scope" || params[0] === "$__exports") {
      const body = String(args[args.length - 1]).replace(/\n\/\/# sourceURL=[^\n]*$/, "")
      compiled.set(keyOf(params, body), [params, body])
    }
    return Reflect.construct(target, args)
  },
})

// parseComponentString hands DOMParser `<template>${prepared}</template>`; the
// prepared text is a fixed point of the rewrites precompile applies again
const TEMPLATE_OPEN = "<template>"
const TEMPLATE_CLOSE = "</template>"
// (a file in the node environment has no DOMParser, and parses no component)
if (typeof DOMParser !== "undefined") {
  const parseFromString = DOMParser.prototype.parseFromString
  DOMParser.prototype.parseFromString = function (text: string, type: DOMParserSupportedType) {
    if (text.startsWith(TEMPLATE_OPEN) && text.endsWith(TEMPLATE_CLOSE)) {
      sources.add(text.slice(TEMPLATE_OPEN.length, -TEMPLATE_CLOSE.length))
    }
    return parseFromString.call(this, text, type)
  }
}

afterAll(async () => {
  const { precompile } = await import("../../src/precompile")
  const generated = new Set<string>()
  sources.forEach(source => precompile(source).forEach(([params, body]) => generated.add(keyOf(params, body))))
  const missed = [...compiled]
    .filter(([key]) => !generated.has(key))
    .map(([, [params, body]]) => `(${params.slice(2).join(", ")}) ${body.length > 160 ? `${body.slice(0, 160)}…` : body}`)
  expect(missed, `precompile() missed ${missed.length} of ${compiled.size} compiled functions`).toEqual([])
})
