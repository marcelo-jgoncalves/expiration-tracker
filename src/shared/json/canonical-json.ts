/**
 * Canonical JSON serialization — D-192 §8 (`bulk-import-documents-requirements-scoping/
 * estado-final-consolidado.md`): "chaves ordenadas alfabeticamente, recursivamente em todo
 * nível; arrays preservam ordem; lança em tipo não coberto". Single call site today:
 * `columnMappingSha256 = sha256(canonicalJsonStringify(columnMapping))` (import-service.ts) —
 * the integrity guarantee that the commit/parse path never silently applies a different
 * mapping than what a client's `/mapping` POST or `/schema` preview showed depends on this
 * being deterministic across property insertion order, never plain `JSON.stringify` (which is
 * insertion-order-dependent for object keys).
 */
export function canonicalJsonStringify(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "number") {
    if (!Number.isFinite(value as number)) throw new TypeError("canonicalJsonStringify: non-finite number not supported.");
    return JSON.stringify(value);
  }
  if (t === "boolean") return JSON.stringify(value);
  if (t === "undefined") throw new TypeError("canonicalJsonStringify: undefined not supported at this position.");
  if (Array.isArray(value)) {
    return `[${value.map((v) => serialize(v)).join(",")}]`;
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${serialize(obj[k])}`).join(",")}}`;
  }
  throw new TypeError(`canonicalJsonStringify: unsupported type ${t}.`);
}
