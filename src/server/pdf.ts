// Minimal PDF text extraction (no dependencies): enough for single-page Canva exports.
// Inflates Flate streams, follows Form XObjects, maps glyph codes through each font's
// ToUnicode CMap, and groups upright text by baseline into lines (top to bottom, left to right).

interface PdfName {
  name: string;
}
interface PdfOp {
  op: string;
}
interface PdfRef {
  ref: number;
}
type PdfDict = Map<string, PdfValue>;
// Strings are raw bytes as latin1.
type PdfValue = number | boolean | string | null | PdfName | PdfOp | PdfRef | PdfValue[] | PdfDict;
type Matrix = [number, number, number, number, number, number];

const isName = (v: PdfValue | undefined): v is PdfName => typeof v === 'object' && v !== null && 'name' in v;
const isOp = (v: PdfValue | undefined): v is PdfOp => typeof v === 'object' && v !== null && 'op' in v;
const isRef = (v: PdfValue | undefined): v is PdfRef => typeof v === 'object' && v !== null && 'ref' in v;
const nameOf = (v: PdfValue | undefined): string | undefined => (isName(v) ? v.name : undefined);
const dictOf = (v: PdfValue | undefined): PdfDict | undefined => (v instanceof Map ? v : undefined);
const lookup = (dict: PdfDict | undefined, key: string | undefined): PdfValue | undefined =>
  key === undefined ? undefined : dict?.get(key);
// Malformed operands become NaN, as plain arithmetic on them would.
const num = (v: PdfValue | undefined): number => (typeof v === 'number' ? v : Number.NaN);

const latin1 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
};

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// --- Tokenizer for PDF objects and content streams ---

const WS = /[\0\t\n\f\r ]/;
const DELIM = /[()<>[\]{}/%]/;
const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };

class Lexer {
  s: string;
  i = 0;

  constructor(s: string) {
    this.s = s;
  }

  skip() {
    const { s } = this;
    while (this.i < s.length) {
      if (WS.test(s.charAt(this.i))) this.i++;
      else if (s[this.i] === '%') while (this.i < s.length && s[this.i] !== '\n' && s[this.i] !== '\r') this.i++;
      else break;
    }
  }

  // Returns a value: number, { name }, { op }, string (bytes as latin1), array, dict (Map), { ref }, or null at end.
  next(): PdfValue {
    this.skip();
    const { s } = this;
    if (this.i >= s.length) return null;
    const c = s[this.i];
    if (c === '/') {
      let j = ++this.i;
      while (j < s.length && !WS.test(s.charAt(j)) && !DELIM.test(s.charAt(j))) j++;
      const name = s
        .slice(this.i, j)
        .replace(/#([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
      this.i = j;
      return { name };
    }
    if (c === '(') return this.literal();
    if (c === '<' && s[this.i + 1] === '<') {
      this.i += 2;
      const dict: PdfDict = new Map();
      for (;;) {
        this.skip();
        if (s.startsWith('>>', this.i)) {
          this.i += 2;
          return dict;
        }
        const key = this.next();
        if (!key) return dict;
        dict.set(nameOf(key) ?? '', this.value());
      }
    }
    if (c === '<') {
      const end = s.indexOf('>', this.i);
      const hex = s.slice(this.i + 1, end).replace(/\s+/g, '');
      this.i = end + 1;
      let out = '';
      for (let k = 0; k < hex.length; k += 2)
        out += String.fromCharCode(parseInt(hex.slice(k, k + 2).padEnd(2, '0'), 16));
      return out;
    }
    if (c === '[') {
      this.i++;
      const arr: PdfValue[] = [];
      for (;;) {
        this.skip();
        if (s[this.i] === ']' || this.i >= s.length) {
          this.i++;
          return arr;
        }
        arr.push(this.value());
      }
    }
    if (c === ']' || c === '>' || c === ')' || c === '{' || c === '}') {
      this.i++;
      return this.next();
    }
    let j = this.i;
    while (j < s.length && !WS.test(s.charAt(j)) && !DELIM.test(s.charAt(j))) j++;
    const word = s.slice(this.i, j);
    this.i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
    if (word === 'true' || word === 'false') return word === 'true';
    if (word === 'null') return null;
    return { op: word };
  }

  // Like next(), but folds "12 0 R" into a reference (only meaningful outside content streams).
  value(): PdfValue {
    const v = this.next();
    if (typeof v !== 'number') return v;
    const save = this.i;
    const gen = this.next();
    const r = this.next();
    if (typeof gen === 'number' && isOp(r) && r.op === 'R') return { ref: v };
    this.i = save;
    return v;
  }

  literal(): string {
    const { s } = this;
    let depth = 0;
    let out = '';
    for (this.i++; this.i < s.length; this.i++) {
      const c = s[this.i];
      if (c === '\\') {
        const n = s.charAt(++this.i);
        const esc = ESCAPES[n];
        if (esc) out += esc;
        else if (/[0-7]/.test(n)) {
          let oct = n;
          while (oct.length < 3 && /[0-7]/.test(s.charAt(this.i + 1))) oct += s.charAt(++this.i);
          out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        } else if (n === '\r') {
          if (s[this.i + 1] === '\n') this.i++;
        } else if (n !== '\n') out += n;
      } else if (c === '(') {
        depth++;
        out += c;
      } else if (c === ')') {
        if (depth-- === 0) {
          this.i++;
          return out;
        }
        out += c;
      } else out += c;
    }
    return out;
  }
}

// --- Document: objects by number, with lazily decoded streams ---

interface PdfDoc {
  resolve(v: PdfValue | undefined): PdfValue | undefined;
  streamData(ref: PdfValue | undefined): Promise<string>;
  pages: PdfDict[];
  created: Date | null;
}

function parseDocument(bytes: Uint8Array<ArrayBuffer>): PdfDoc {
  const s = latin1(bytes);
  const objects = new Map<number, { value: PdfValue; stream: { start: number } | null }>();
  const re = /(\d+)\s+\d+\s+obj\b/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const lex = new Lexer(s);
    lex.i = re.lastIndex;
    const value = lex.value();
    lex.skip();
    let stream: { start: number } | null = null;
    if (value instanceof Map && s.startsWith('stream', lex.i)) {
      let start = lex.i + 6;
      if (s[start] === '\r') start++;
      if (s[start] === '\n') start++;
      stream = { start };
    }
    objects.set(Number(m[1]), { value, stream });
    re.lastIndex = stream ? s.indexOf('endstream', stream.start) : lex.i;
  }

  const resolve = (v: PdfValue | undefined): PdfValue | undefined =>
    isRef(v) ? (objects.get(v.ref)?.value ?? null) : v;
  const streamData = async (ref: PdfValue | undefined): Promise<string> => {
    const obj = isRef(ref) ? objects.get(ref.ref) : undefined;
    const dict = dictOf(obj?.value);
    if (!obj?.stream || !dict) return '';
    let length = resolve(dict.get('Length'));
    if (typeof length !== 'number') length = s.indexOf('endstream', obj.stream.start) - obj.stream.start;
    let data = bytes.subarray(obj.stream.start, obj.stream.start + length);
    const filter = resolve(dict.get('Filter'));
    const filters = Array.isArray(filter) ? filter : filter ? [filter] : [];
    for (const f of filters) {
      if (nameOf(f) !== 'FlateDecode') return '';
      data = await inflate(data);
    }
    return latin1(data);
  };
  const pages: PdfDict[] = [];
  const walk = (node: PdfValue | undefined): void => {
    const dict = dictOf(resolve(node));
    if (!dict) return;
    if (nameOf(dict.get('Type')) === 'Pages') {
      const kids = resolve(dict.get('Kids'));
      for (const kid of Array.isArray(kids) ? kids : []) walk(kid);
    } else pages.push(dict);
  };
  const trailerRoot = s.match(/\/Root\s+(\d+)\s+\d+\s+R/);
  const catalog = trailerRoot && objects.get(Number(trailerRoot[1]))?.value;
  if (catalog instanceof Map) walk(catalog.get('Pages'));
  const infoRef = s.match(/\/Info\s+(\d+)\s+\d+\s+R/);
  const info = infoRef && objects.get(Number(infoRef[1]))?.value;
  return { resolve, streamData, pages, created: info instanceof Map ? parseDate(info.get('CreationDate')) : null };
}

// PDF date string "D:YYYYMMDDHHmmSS+HH'mm'" → Date (null when missing or malformed).
function parseDate(str: PdfValue | undefined): Date | null {
  const m =
    typeof str === 'string' &&
    str.match(/^D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?(?:([+-])(\d{2})'?(\d{2})?'?|Z)?/);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', sec = '00', sign, oh = '00', om = '00'] = m;
  const offset = sign ? (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om)) : 0;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), +h, +mi, +sec) - offset * 60_000);
}

// --- ToUnicode CMaps ---

const utf16be = (str: string): string => {
  let out = '';
  for (let k = 0; k + 1 < str.length; k += 2)
    out += String.fromCharCode((str.charCodeAt(k) << 8) | str.charCodeAt(k + 1));
  return out;
};
const codeOf = (str: string): number => [...str].reduce((n, ch) => n * 256 + ch.charCodeAt(0), 0);

interface Font {
  map: Map<number, string>;
  width: number;
}

const str = (v: PdfValue | undefined): string => (typeof v === 'string' ? v : '');

function parseCMap(text: string): Font {
  const map = new Map<number, string>();
  let width = 1;
  const lex = new Lexer(text);
  const tokens: PdfValue[] = [];
  for (let t = lex.next(); t !== null; t = lex.next()) tokens.push(t);
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const op = isOp(t) ? t.op : null;
    const range = tokens[k + 1];
    const endsAt = (end: string): boolean => {
      const tk = tokens[k];
      return isOp(tk) && tk.op === end;
    };
    if (op === 'begincodespacerange' && typeof range === 'string') width = range.length;
    if (op === 'beginbfchar') {
      for (k++; !endsAt('endbfchar') && k < tokens.length; k += 2)
        map.set(codeOf(str(tokens[k])), utf16be(str(tokens[k + 1])));
    }
    if (op === 'beginbfrange') {
      for (k++; !endsAt('endbfrange') && k < tokens.length; k += 3) {
        const lo = codeOf(str(tokens[k]));
        const hi = codeOf(str(tokens[k + 1]));
        const dst = tokens[k + 2];
        for (let code = lo; code <= hi; code++) {
          if (Array.isArray(dst)) map.set(code, utf16be(str(dst[code - lo])));
          else {
            const base = utf16be(str(dst));
            map.set(code, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + code - lo));
          }
        }
      }
    }
  }
  return { map, width };
}

// --- Content streams ---

const mul = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
const ID: Matrix = [1, 0, 0, 1, 0, 0];
// Last six operands as a matrix; missing ones become NaN like the out-of-range reads they replace.
const toMatrix = (vs: PdfValue[]): Matrix => {
  const [a = Number.NaN, b = Number.NaN, c = Number.NaN, d = Number.NaN, e = Number.NaN, f = Number.NaN] = vs
    .slice(-6)
    .map(num);
  return [a, b, c, d, e, f];
};

interface Piece {
  x: number;
  y: number;
  size: number;
  text: string;
}

async function runContent(
  doc: PdfDoc,
  content: string,
  resources: PdfValue | undefined,
  ctm: Matrix,
  pieces: Piece[],
  fontCache: Map<string | number | undefined, Font>,
  depth: number,
): Promise<void> {
  if (depth > 10) return;
  const res = dictOf(resources);
  const fonts = dictOf(doc.resolve(res?.get('Font')));
  const xobjects = dictOf(doc.resolve(res?.get('XObject')));
  const lex = new Lexer(content);
  const stack: PdfValue[] = [];
  const gstack: Matrix[] = [];
  let tm = ID;
  let tlm = ID;
  let leading = 0;
  let font: Font | null = null;
  let fontSize = 1;

  const loadFont = async (name: string | undefined): Promise<Font | null> => {
    const ref = lookup(fonts, name);
    const key = isRef(ref) ? ref.ref : name;
    if (!fontCache.has(key)) {
      const dict = dictOf(doc.resolve(ref));
      const toUnicode = dict?.get('ToUnicode');
      const cmap = isRef(toUnicode) && toUnicode.ref ? parseCMap(await doc.streamData(toUnicode)) : null;
      const twoByte = nameOf(dict?.get('Subtype')) === 'Type0';
      fontCache.set(key, cmap ?? { map: new Map(), width: twoByte ? 2 : 1 });
    }
    return fontCache.get(key) ?? null;
  };
  const show = (operand: PdfValue | undefined): void => {
    if (!font || typeof operand !== 'string') return;
    const str = operand;
    let text = '';
    for (let k = 0; k + font.width <= str.length; k += font.width) {
      const code = codeOf(str.slice(k, k + font.width));
      text += font.map.get(code) ?? (font.map.size ? '' : String.fromCharCode(code));
    }
    if (!text) return;
    const m = mul(tm, ctm);
    // Only upright text: rotated text is decoration (Canva's diagonal background patterns).
    if (Math.abs(m[1]) + Math.abs(m[2]) > 1e-3 * (Math.abs(m[0]) + Math.abs(m[3]))) return;
    pieces.push({ x: m[4], y: m[5], size: fontSize * Math.hypot(m[2], m[3]), text });
  };
  const moveLine = (tx: number, ty: number): void => {
    tlm = mul([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
  };

  for (let t = lex.next(); t !== null; t = lex.next()) {
    if (!t || typeof t !== 'object' || !('op' in t)) {
      stack.push(t);
      continue;
    }
    const a = stack;
    switch (t.op) {
      case 'q':
        gstack.push(ctm);
        break;
      case 'Q':
        ctm = gstack.pop() ?? ctm;
        break;
      case 'cm':
        ctm = mul(toMatrix(a), ctm);
        break;
      case 'BT':
        tm = tlm = ID;
        break;
      case 'Tf':
        font = await loadFont(nameOf(a.at(-2)));
        fontSize = num(a.at(-1));
        break;
      case 'TL':
        leading = num(a.at(-1));
        break;
      case 'Tm':
        tm = tlm = toMatrix(a);
        break;
      case 'Td':
        moveLine(num(a.at(-2)), num(a.at(-1)));
        break;
      case 'TD':
        leading = -num(a.at(-1));
        moveLine(num(a.at(-2)), num(a.at(-1)));
        break;
      case 'T*':
        moveLine(0, -leading);
        break;
      case 'Tj':
        show(a.at(-1));
        break;
      case "'":
        moveLine(0, -leading);
        show(a.at(-1));
        break;
      case '"':
        moveLine(0, -leading);
        show(a.at(-1));
        break;
      case 'TJ': {
        const parts = a.at(-1);
        if (Array.isArray(parts)) for (const part of parts) if (typeof part === 'string') show(part);
        break;
      }
      case 'BI':
        lex.i = content.indexOf('EI', lex.i) + 2;
        break;
      case 'Do': {
        const ref = lookup(xobjects, nameOf(a.at(-1)));
        const xo = dictOf(doc.resolve(ref));
        if (xo && nameOf(xo.get('Subtype')) === 'Form') {
          const m = doc.resolve(xo.get('Matrix'));
          const matrix = Array.isArray(m) ? toMatrix(m) : ID;
          const inner = doc.resolve(xo.get('Resources')) ?? resources;
          await runContent(doc, await doc.streamData(ref), inner, mul(matrix, ctm), pieces, fontCache, depth + 1);
        }
        break;
      }
    }
    stack.length = 0;
  }
}

// Groups glyph pieces sharing a baseline into lines. Word spaces are real glyphs in Canva exports,
// so only a column-sized gap (no font widths needed) adds a space. Text drawn twice at nearly the
// same spot (shadow/outline effects) is kept once.
function toLines(pieces: Piece[]): string[] {
  const sorted = [...pieces].sort((p, q) => q.y - p.y || p.x - q.x);
  const rows: { y: number; pieces: Piece[] }[] = [];
  for (const p of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(row.y - p.y) <= p.size * 0.3) row.pieces.push(p);
    else rows.push({ y: p.y, pieces: [p] });
  }
  return rows
    .map(({ pieces: ps }) => {
      ps.sort((p, q) => p.x - q.x);
      let line = '';
      let prev: Piece | null = null;
      for (const p of ps) {
        if (prev && p.text === prev.text && p.x - prev.x < p.size * 0.15) continue;
        if (prev && p.x - prev.x > prev.size * (0.75 * prev.text.length + 2)) line += ' ';
        line += p.text;
        prev = p;
      }
      return line.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
}

// Text lines of every page, plus the document's creation date.
export async function readPdf(bytes: Uint8Array<ArrayBuffer>): Promise<{ lines: string[]; created: Date | null }> {
  const doc = parseDocument(bytes);
  const lines: string[] = [];
  for (const page of doc.pages) {
    const pieces: Piece[] = [];
    const contents = page.get('Contents');
    const resolved = doc.resolve(contents);
    const refs = Array.isArray(resolved) ? resolved : [contents];
    let content = '';
    for (const ref of refs) content += `${await doc.streamData(ref)}\n`;
    await runContent(doc, content, doc.resolve(page.get('Resources')), ID, pieces, new Map(), 0);
    lines.push(...toLines(pieces));
  }
  return { lines, created: doc.created };
}
