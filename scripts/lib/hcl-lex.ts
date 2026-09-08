/**
 * Minimal HCL lexical sanitizer — E-020/D-232 (rollback manifest coverage bug). Not a full HCL
 * parser: it only neutralizes line comments (#, //), block comments, quoted strings
 * (with backslash-escape handling), and heredocs (`<<EOT`/`<<-EOT ... EOT`) by replacing their
 * content with spaces (newlines preserved, so line numbers and line-based regexes downstream stay
 * valid). This exists so that `scripts/generate-lambda-manifest.ts`'s brace-counting block scanner
 * and `test/scripts/lambda-manifest.test.ts`'s independent line-scan oracle can both trust that a
 * `module "x" {` or `source = "..."` string appearing inside a comment/string/heredoc (e.g. an
 * inline IAM policy JSON heredoc elsewhere in infra/main.tf) is never mistaken for a real HCL
 * block header — without either of them duplicating a brace-depth parser that could carry the same
 * blind spot on both sides (real gap the round-2 Claude<->Codex review on this bug found — see
 * decisions-log.md D-232). This is deliberately NOT a defense against arbitrary adversarial/
 * malformed HCL — `terraform fmt -check`/`terraform validate` already gate that in CI.
 */

export function stripCommentsStringsAndHeredocs(text: string): string {
  const out: string[] = [];
  let i = 0;
  const n = text.length;

  const blank = (s: string): string => s.replace(/[^\n]/g, " ");

  while (i < n) {
    const two = text.slice(i, i + 2);

    // Line comments: // or #
    if (two === "//" || text[i] === "#") {
      let j = i;
      while (j < n && text[j] !== "\n") j++;
      out.push(blank(text.slice(i, j)));
      i = j;
      continue;
    }

    // Block comments: /* ... */
    if (two === "/*") {
      const end = text.indexOf("*/", i + 2);
      const j = end === -1 ? n : end + 2;
      out.push(blank(text.slice(i, j)));
      i = j;
      continue;
    }

    // Quoted strings: "..." with \-escapes (HCL interpolation braces ${...} can nest quotes, but
    // for our purpose — never letting a `{`/`}`/`module "x" {` inside a string count as real HCL
    // structure — treating the whole string body up to the closing unescaped quote as opaque is
    // enough; we never need to see inside a string value).
    if (text[i] === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      out.push(blank(text.slice(i, j)));
      i = j;
      continue;
    }

    // Heredocs: <<EOT / <<-EOT ... up to a line that is exactly the marker (optionally indented
    // when the `-` variant is used).
    const heredocMatch = /^<<-?([A-Za-z_][A-Za-z0-9_]*)/.exec(text.slice(i));
    if (heredocMatch) {
      const marker = heredocMatch[1];
      const indented = text[i + 2] === "-";
      // Find end of the intro line first.
      let introEnd = text.indexOf("\n", i);
      if (introEnd === -1) introEnd = n;
      const markerRe = indented
        ? new RegExp(`^[ \\t]*${marker}[ \\t]*$`, "m")
        : new RegExp(`^${marker}[ \\t]*$`, "m");
      const rest = text.slice(introEnd + 1);
      const found = markerRe.exec(rest);
      const bodyEnd = found ? introEnd + 1 + found.index + found[0].length : n;
      out.push(blank(text.slice(i, bodyEnd)));
      i = bodyEnd;
      continue;
    }

    out.push(text[i] ?? "");
    i++;
  }

  return out.join("");
}
