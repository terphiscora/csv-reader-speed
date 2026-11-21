// solve.js: a dependency-free ES module drop-in for make.fun's csv-reader 1.0.0.
// run(input) answers exactly what csv-reader 1.0.0 answers for {text, header}:
// {columns, rows, errors}, read once, left to right, with commas and double quotes.
//
// It keeps the reference's written broken-row policy line for line, and only changes
// how the characters are read. The common record is one plain line: no CR anywhere in
// it and no quote at a field start (a quote inside an unquoted field is a literal
// character). That record is found with indexOf and split, native calls, and its fields
// are the line's text split at its commas. A record with a CR out of place, or a quote
// at a field start (a quoted field, which may span lines, may hold junk after its
// closing quote, or may never close), falls back to the same per-field reading the
// reference writes, with its runs of plain characters sliced at once.

/** How a field ended: at a comma (the record goes on), at a line break or at the end of the text. */
const COMMA = 1;
const LINE_BREAK = 2;
const END = 0;

/** A line no fast record may hold: a CR anywhere, or a quote at a field start. */
const NOT_FAST = /(^|,)"|\r/;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not
  // followed by LF is dropped (stray_cr). Returns the field and how it ended; `added`
  // counts the characters kept.
  function readUnquoted(value) {
    let added = 0;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 44) { // ','
        pos += 1;
        return { value, ended: COMMA, added };
      }
      if (c === 10) { // '\n'
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      if (c === 13) { // '\r'
        if (pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          return { value, ended: LINE_BREAK, added };
        }
        error('stray_cr');
        pos += 1;
        continue;
      }
      const start = pos;
      while (pos < len) {
        const cc = text.charCodeAt(pos);
        if (cc === 44 || cc === 10 || cc === 13) break;
        pos += 1;
      }
      value += text.slice(start, pos);
      added += pos - start;
    }
    return { value, ended: END, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let closed = false;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 34) { // '"'
        if (pos + 1 < len && text.charCodeAt(pos + 1) === 34) {
          value += '"';
          pos += 2;
          continue;
        }
        pos += 1;
        closed = true;
        break;
      }
      if (c === 13) { // CRLF and a lone CR inside quotes are each one LF.
        value += '\n';
        line += 1;
        pos += (pos + 1 < len && text.charCodeAt(pos + 1) === 10) ? 2 : 1;
        continue;
      }
      if (c === 10) {
        line += 1;
        value += '\n';
        pos += 1;
        continue;
      }
      const start = pos;
      while (pos < len) {
        const cc = text.charCodeAt(pos);
        if (cc === 34 || cc === 13 || cc === 10) break;
        pos += 1;
      }
      value += text.slice(start, pos);
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"');
    }
    if (pos >= len) return { value, ended: END, added: 0 };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA, added: 0 };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK, added: 0 };
    }
    if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK, added: 0 };
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) error('quote_junk');
    return junk;
  }

  while (true) {
    if (pos >= len) break;

    // One line of it: the record ends at its LF, its CRLF, or at the end of the text.
    const eol = text.indexOf('\n', pos);
    const end = eol === -1 ? len : eol;
    const hasEOL = eol !== -1;
    let lineEnd = end;
    if (hasEOL && end > pos && text.charCodeAt(end - 1) === 13) lineEnd = end - 1; // CRLF: the CR is the line break's own
    const lineText = text.slice(pos, lineEnd);

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    if (!NOT_FAST.test(lineText)) {
      // A plain line: its fields are its text split at its commas, a line left with no
      // characters is no record, and everything the record needs is already known.
      pos = hasEOL ? end + 1 : len;
      if (hasEOL) line += 1;
      if (lineText !== '') {
        const fields = lineText.split(',');
        if (width < 0) width = fields.length;
        if (header && columns === null) {
          columns = fields;
        } else {
          if (fields.length < width) {
            errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
            while (fields.length < width) fields.push('');
          } else if (fields.length > width) {
            errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
          }
          rows.push(fields);
        }
      }
      continue;
    }

    // Slow path: the record holds a CR out of place or a quote at a field start, and is
    // read one field at a time, exactly as the reference writes it.
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
