/**
 * Deterministic `expirationDate` field extraction — M7 item 5 (`PdfParserTaskHandler`, D-035
 * §1.3). Pure function over already-OCR'd text (Textract LINE blocks joined), never over raw
 * PDF bytes and never calling any AI provider — the ASL's `RunDeterministicParser` state is a
 * plain `arn:aws:states:::lambda:invoke`, no Bedrock/Textract/DynamoDB access at all.
 *
 * §1.3 requires this to be "biblioteca de funções puras importada" reusing M6's numeric
 * limits (`workers/parser-sandbox/parser.ts`'s `MAX_DECOMPRESSED_BYTES`) rather than a new,
 * unbounded parser — the OCR text itself already went through Textract (trusted), but the
 * same defensive cap still applies here so a pathological multi-page document can't make this
 * Lambda scan an unbounded string.
 */
import { MAX_DECOMPRESSED_BYTES } from "../../../workers/parser-sandbox/parser.js";
import type { ExtractionCandidateField } from "./decide-bedrock.js";

/** Below this, a raw date match is not associated with any expiration-like keyword nearby -
 * treated as a weak candidate (below `DETERMINISTIC_CONFIDENCE_THRESHOLD`, field-schema.ts),
 * so it alone never resolves the field without Bedrock corroboration. */
const WEAK_CONFIDENCE = 0.5;
/** A date found within `KEYWORD_WINDOW_CHARS` of a recognized expiration keyword — high
 * enough to clear `DETERMINISTIC_CONFIDENCE_THRESHOLD` (0.75) on its own. */
const KEYWORD_CONFIDENCE = 0.9;
const KEYWORD_WINDOW_CHARS = 40;

const EXPIRATION_KEYWORDS = [
  "validade",
  "válido até",
  "valido ate",
  "vencimento",
  "vence em",
  "expira",
  "expiration",
  "expiry",
  "valid until",
  "valid thru",
];

// dd/mm/yyyy or dd-mm-yyyy (also accepts 2-digit year).
const DATE_PATTERN_DMY = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})\b/g;
// ISO yyyy-mm-dd.
const DATE_PATTERN_ISO = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function normalizeYear(y: number): number {
  if (y >= 100) return y;
  // 2-digit year heuristic: 00-79 -> 2000-2079, 80-99 -> 1980-1999 (same convention as most
  // consumer document parsers; this pipeline only ever deals with expiration dates, which are
  // overwhelmingly future-dated, so this never matters in practice for the low end).
  return y >= 80 ? 1900 + y : 2000 + y;
}

interface RawMatch {
  index: number;
  length: number;
  isoValue: string;
}

function collectMatches(text: string): RawMatch[] {
  const matches: RawMatch[] = [];
  for (const m of text.matchAll(DATE_PATTERN_DMY)) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = normalizeYear(Number(m[3]));
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    matches.push({ index: m.index, length: m[0].length, isoValue: `${year}-${pad(month)}-${pad(day)}` });
  }
  for (const m of text.matchAll(DATE_PATTERN_ISO)) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    matches.push({ index: m.index, length: m[0].length, isoValue: `${year}-${pad(month)}-${pad(day)}` });
  }
  return matches;
}

function hasNearbyKeyword(text: string, match: RawMatch): boolean {
  const start = Math.max(0, match.index - KEYWORD_WINDOW_CHARS);
  const end = Math.min(text.length, match.index + match.length + KEYWORD_WINDOW_CHARS);
  const window = text.slice(start, end).toLowerCase();
  return EXPIRATION_KEYWORDS.some((kw) => window.includes(kw));
}

export interface DeterministicExpirationDateResult {
  /** All distinct ISO date values found anywhere in the text, regardless of keyword context -
   * this is exactly `decide-bedrock.ts`'s `ocrCandidates` input for rule (c) (2+ distinct
   * candidates = real ambiguity). */
  readonly candidates: readonly ExtractionCandidateField[];
  /** The single best candidate (highest confidence, first occurrence on ties), if any - this
   * is `deterministicCandidate` for `decide-bedrock.ts`. */
  readonly best?: ExtractionCandidateField;
}

/** Never throws on "no date found" - that is a normal, successful outcome (empty result).
 * Only ever processes up to `MAX_DECOMPRESSED_BYTES` characters of input (M6 numeric limit,
 * reused per design §1.3), silently truncating anything beyond that rather than failing the
 * whole run over a pathologically large OCR artifact. */
export function extractExpirationDateCandidates(ocrText: string): DeterministicExpirationDateResult {
  const bounded = ocrText.length > MAX_DECOMPRESSED_BYTES ? ocrText.slice(0, MAX_DECOMPRESSED_BYTES) : ocrText;
  const rawMatches = collectMatches(bounded);

  const byValue = new Map<string, ExtractionCandidateField>();
  for (const match of rawMatches) {
    const confidence = hasNearbyKeyword(bounded, match) ? KEYWORD_CONFIDENCE : WEAK_CONFIDENCE;
    const existing = byValue.get(match.isoValue);
    if (!existing || confidence > existing.confidence) {
      byValue.set(match.isoValue, { value: match.isoValue, valueType: "DATE", confidence });
    }
  }

  const candidates = [...byValue.values()];
  const best = candidates.reduce<ExtractionCandidateField | undefined>((acc, c) => (!acc || c.confidence > acc.confidence ? c : acc), undefined);
  return { candidates, best };
}
