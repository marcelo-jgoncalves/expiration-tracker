/**
 * Regression test for a real production bug found in M5 (2026-08-21, confirmed via
 * `aws lambda invoke` against a real deployed function after the ADOT layer rollout):
 * esbuild's ESM->CJS export transform defines `exports.handler` as a getter-only accessor
 * with `configurable: false` (live-binding emulation for `export async function handler`).
 * The ADOT Lambda layer's OpenTelemetry auto-instrumentation tries to
 * Object.defineProperty-wrap that same property to add tracing, which throws
 * "TypeError: Cannot redefine property: handler" against a non-configurable accessor -
 * crashing every real invocation.
 *
 * scripts/build-lambdas.ts's esbuild `footer` option fixes this by replacing
 * `module.exports` with a brand-new plain object after the bundle body runs - this test
 * proves that fix holds by actually running esbuild with the exact same options against a
 * minimal fixture handler and requiring the real output, asserting the exported `handler`
 * is a normal writable/configurable/enumerable own property (not the getter-only shape).
 *
 * The require() happens in a directory OUTSIDE this repo (os.tmpdir()) specifically because
 * the repo's own package.json declares "type": "module" - requiring the bundle from INSIDE
 * the repo's directory tree hits an unrelated ambient-ESM-misclassification quirk that has
 * nothing to do with this bug (and doesn't affect the real Lambda zip, which never contains
 * that outer package.json) - see NEXT_SESSION_PROMPT.md for how this was diagnosed.
 */
import { describe, expect, it } from "vitest";
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

describe("build-lambdas.ts's esbuild footer - handler export shape", () => {
  it("produces a writable/configurable/enumerable `handler` export, not esbuild's default getter-only accessor", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "build-lambdas-export-shape-"));
    try {
      const entry = path.join(tmpDir, "fixture-handler.ts");
      fs.writeFileSync(entry, "export async function handler(event: unknown): Promise<unknown> { return event; }\n");
      const outFile = path.join(tmpDir, "index.js");

      // Exact esbuild options from scripts/build-lambdas.ts - kept in sync manually (no
      // shared import, since that script's `main()` has its own side-effecting CLI entry).
      await esbuild.build({
        entryPoints: [entry],
        outfile: outFile,
        bundle: true,
        platform: "node",
        target: "node20",
        format: "cjs",
        sourcemap: "external",
        minify: false,
        footer: { js: "module.exports = { handler: module.exports.handler };" },
      });

      const verifyScript = path.join(tmpDir, "verify.cjs");
      fs.writeFileSync(
        verifyScript,
        `
        const mod = require("./index.js");
        const descriptor = Object.getOwnPropertyDescriptor(mod, "handler");
        console.log(JSON.stringify({ typeofHandler: typeof mod.handler, descriptor }));
        `,
      );

      const output = execFileSync(process.execPath, [verifyScript], { cwd: tmpDir, encoding: "utf-8" });
      const { typeofHandler, descriptor } = JSON.parse(output) as {
        typeofHandler: string;
        descriptor: PropertyDescriptor | undefined;
      };

      expect(typeofHandler).toBe("function");
      // `value` isn't asserted here - functions don't survive JSON.stringify across the
      // child process boundary, so the verify script only reports the flags that matter for
      // this bug (whether the property CAN be redefined), not the function reference itself.
      expect(descriptor).toEqual({ writable: true, enumerable: true, configurable: true });

      // The exact failure mode this bug caused: OTel's shimmer library redefining the
      // property to add tracing instrumentation. A configurable/writable property allows
      // this; esbuild's default getter-only export (configurable: false) throws here.
      expect(() => {
        const mod = { handler: undefined } as { handler: unknown };
        Object.defineProperty(mod, "handler", descriptor!);
        Object.defineProperty(mod, "handler", { value: () => {}, writable: true, configurable: true, enumerable: true });
      }).not.toThrow();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
