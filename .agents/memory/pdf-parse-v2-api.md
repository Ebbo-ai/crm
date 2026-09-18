---
name: pdf-parse v2 API break
description: pdf-parse v2.x replaced the old function export with a PDFParse class; the old pattern fails silently at runtime, not just in types.
---

`pdf-parse` v2 (2.4.5+) is a full rewrite: there is no default export function anymore. `require('pdf-parse')(buffer)` / `(await import('pdf-parse')).default(buffer)` throws `pdfParse is not a function` at runtime — this is not just a TypeScript typing complaint, it fails live.

**Why:** the npm package kept the same name across a breaking v1→v2 rewrite (class-based API, many more capabilities: tables, screenshots, embedded images). Code written against v1 docs/memory compiles under loose typing but breaks the first time a PDF is actually parsed.

**How to apply:** use `const { PDFParse } = await import('pdf-parse'); const parser = new PDFParse({ data: buffer }); const result = await parser.getText(); await parser.destroy();`. `result.text` is the extracted text, `result.total` is the page count (not `numpages`). Always smoke-test PDF extraction against a real PDF after touching this dependency — the old call pattern type-checks fine in a loosely-typed codebase but is dead code at runtime.
