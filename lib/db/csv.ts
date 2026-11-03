/**
 * Minimal, dependency-free CSV helpers.
 *
 * The Apex seed files contain quoted fields with embedded commas, doubled quotes
 * (`""`), and CRLF line endings, so a naive `split(",")` is not enough. This parser
 * follows the RFC 4180 conventions that the source files actually use.
 */

/**
 * Parse a CSV document into a matrix of raw string cells.
 * Quoted fields may span newlines and contain commas or escaped quotes.
 */
export function parseCsv(input: string): string[][] {
  // Normalise line endings and strip a leading UTF-8 BOM if present.
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // skip the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  // Flush the final field/row unless the document ended on a trailing newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Convert a parsed CSV matrix into an array of header-keyed records.
 * The first row is treated as the header; blank trailing rows are ignored.
 */
export function csvToRecords(input: string): Record<string, string>[] {
  const rows = parseCsv(input);
  if (rows.length === 0) return [];

  const [header, ...dataRows] = rows;
  return dataRows
    .filter((cells) => cells.some((cell) => cell.trim() !== ""))
    .map((cells) => {
      const record: Record<string, string> = {};
      header.forEach((key, columnIndex) => {
        record[key] = cells[columnIndex] ?? "";
      });
      return record;
    });
}

/**
 * Normalise a cell value: trim surrounding whitespace and treat an empty result
 * as `null`. Per the agreed import policy we do not otherwise transform values
 * (booleans, states, phone numbers and dates are stored exactly as provided).
 */
export function toNullableText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
