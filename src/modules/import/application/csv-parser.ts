/**
 * Parser de CSV — M11 (D-042). Suporte mínimo a RFC4180 (aspas duplas, aspas duplas escapadas
 * `""`, vírgula/quebra de linha dentro de campo entre aspas) - suficiente para o limite de v1
 * (5 MiB/5.000 linhas, arquivo inteiro em memória, nunca streaming real - o limite já garante
 * isso é seguro). `\r\n` e `\n` são ambos aceitos como fim de linha; um `\r`/`\n` LITERAL
 * dentro de um campo SEM aspas é tratado como fim de linha (comportamento RFC4180 padrão) -
 * a REJEIÇÃO de controle embutido (`import-row.ts`) acontece depois, sobre o valor já
 * extraído de um campo ENTRE ASPAS, não aqui.
 */
export interface ParsedCsv {
  header: string[];
  rows: string[][];
}

const enum State {
  FieldStart,
  Unquoted,
  Quoted,
  QuotedQuote,
}

/** Parse puro, síncrono - todo o buffer em memória (seguro dado o limite de 5 MiB de v1,
 * nunca chamado com entrada maior sem revalidar esse limite primeiro). */
export function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let state: State = State.FieldStart;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (state === State.FieldStart) {
      if (c === '"') {
        state = State.Quoted;
        continue;
      }
      state = State.Unquoted;
      // fall through - re-process this char as Unquoted below.
    }

    if (state === State.Unquoted) {
      if (c === ",") {
        pushField();
        state = State.FieldStart;
      } else if (c === "\n") {
        pushRow();
        state = State.FieldStart;
      } else if (c === "\r") {
        if (text[i + 1] === "\n") i++;
        pushRow();
        state = State.FieldStart;
      } else {
        field += c;
      }
      continue;
    }

    if (state === State.Quoted) {
      if (c === '"') {
        state = State.QuotedQuote;
      } else {
        field += c;
      }
      continue;
    }

    if (state === State.QuotedQuote) {
      if (c === '"') {
        field += '"';
        state = State.Quoted;
      } else if (c === ",") {
        pushField();
        state = State.FieldStart;
      } else if (c === "\n") {
        pushRow();
        state = State.FieldStart;
      } else if (c === "\r") {
        if (text[i + 1] === "\n") i++;
        pushRow();
        state = State.FieldStart;
      } else {
        // Malformed input (content directly after a closing quote, no separator) - treat the
        // stray character as starting a new unquoted run rather than throwing, matching the
        // rest of this parser's "never throws on malformed input" posture; row-level
        // validation downstream will reject nonsensical values on their own merits.
        field += c;
        state = State.Unquoted;
      }
      continue;
    }
  }

  // Final field/row, if the input didn't end with a trailing newline.
  if (field.length > 0 || row.length > 0 || state === State.Quoted || state === State.QuotedQuote) {
    pushRow();
  }

  const [header, ...dataRows] = rows;
  return { header: header ?? [], rows: dataRows };
}

/** Converte as linhas cruas (array posicional) em objetos nomeados pelo cabeçalho - mapeamento
 * fixo de v1 (case-insensitive, espaços ao redor do nome da coluna ignorados). */
export function mapCsvRowsToNamedFields(header: string[], rows: string[][]): Record<string, string>[] {
  const normalizedHeader = header.map((h) => h.trim().toLowerCase());
  return rows.map((row) => {
    const named: Record<string, string> = {};
    for (let i = 0; i < normalizedHeader.length; i++) {
      const key = normalizedHeader[i];
      if (key) named[key] = row[i] ?? "";
    }
    return named;
  });
}
