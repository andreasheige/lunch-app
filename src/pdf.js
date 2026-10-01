// Minimal PDF text extraction (no dependencies): enough for single-page Canva exports.
// Inflates Flate streams, follows Form XObjects, maps glyph codes through each font's
// ToUnicode CMap, and groups upright text by baseline into lines (top to bottom, left to right).

const latin1 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
};

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// --- Tokenizer for PDF objects and content streams ---

const WS = /[\0\t\n\f\r ]/;
const DELIM = /[()<>[\]{}/%]/;

class Lexer {
  constructor(s) { this.s = s; this.i = 0; }

  skip() {
    const { s } = this;
    while (this.i < s.length) {
      if (WS.test(s[this.i])) this.i++;
      else if (s[this.i] === '%') while (this.i < s.length && s[this.i] !== '\n' && s[this.i] !== '\r') this.i++;
      else break;
    }
  }

  // Returns a value: number, { name }, { op }, string (bytes as latin1), array, dict (Map), { ref }, or null at end.
  next() {
    this.skip();
    const { s } = this;
    if (this.i >= s.length) return null;
    const c = s[this.i];
    if (c === '/') {
      let j = ++this.i;
      while (j < s.length && !WS.test(s[j]) && !DELIM.test(s[j])) j++;
      const name = s.slice(this.i, j).replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
      this.i = j;
      return { name };
    }
    if (c === '(') return this.literal();
    if (c === '<' && s[this.i + 1] === '<') {
      this.i += 2;
      const dict = new Map();
      for (;;) {
        this.skip();
        if (s.startsWith('>>', this.i)) { this.i += 2; return dict; }
        const key = this.next();
        if (!key) return dict;
        dict.set(key.name, this.value());
      }
    }
    if (c === '<') {
      const end = s.indexOf('>', this.i);
      const hex = s.slice(this.i + 1, end).replace(/\s+/g, '');
      this.i = end + 1;
      let out = '';
      for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.slice(k, k + 2).padEnd(2, '0'), 16));
      return out;
    }
    if (c === '[') {
      this.i++;
      const arr = [];
      for (;;) {
        this.skip();
        if (s[this.i] === ']' || this.i >= s.length) { this.i++; return arr; }
        arr.push(this.value());
      }
    }
    if (c === ']' || c === '>' || c === ')' || c === '{' || c === '}') { this.i++; return this.next(); }
    let j = this.i;
    while (j < s.length && !WS.test(s[j]) && !DELIM.test(s[j])) j++;
    const word = s.slice(this.i, j);
    this.i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
    if (word === 'true' || word === 'false') return word === 'true';
    if (word === 'null') return null;
    return { op: word };
  }

  // Like next(), but folds "12 0 R" into a reference (only meaningful outside content streams).
  value() {
    const v = this.next();
    if (typeof v !== 'number') return v;
    const save = this.i;
    const gen = this.next();
    const r = this.next();
    if (typeof gen === 'number' && r?.op === 'R') return { ref: v };
    this.i = save;
    return v;
  }

  literal() {
    const { s } = this;
    let depth = 0;
    let out = '';
    for (this.i++; this.i < s.length; this.i++) {
      const c = s[this.i];
      if (c === '\\') {
        const n = s[++this.i];
        const esc = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[n];
        if (esc) out += esc;
        else if (/[0-7]/.test(n)) {
          let oct = n;
          while (oct.length < 3 && /[0-7]/.test(s[this.i + 1])) oct += s[++this.i];
          out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        } else if (n === '\r') { if (s[this.i + 1] === '\n') this.i++; }
        else if (n !== '\n') out += n;
      } else if (c === '(') { depth++; out += c; }
      else if (c === ')') { if (depth-- === 0) { this.i++; return out; } out += c; }
      else out += c;
    }
    return out;
  }
}

// --- Document: objects by number, with lazily decoded streams ---

function parseDocument(bytes) {
  const s = latin1(bytes);
  const objects = new Map();
  const re = /(\d+)\s+\d+\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const lex = new Lexer(s);
    lex.i = re.lastIndex;
    const value = lex.value();
    lex.skip();
    let stream = null;
    if (value instanceof Map && s.startsWith('stream', lex.i)) {
      let start = lex.i + 6;
      if (s[start] === '\r') start++;
      if (s[start] === '\n') start++;
      stream = { start };
    }
    objects.set(Number(m[1]), { value, stream });
    re.lastIndex = stream ? s.indexOf('endstream', stream.start) : lex.i;
  }

  const resolve = (v) => (v && typeof v === 'object' && 'ref' in v ? objects.get(v.ref)?.value ?? null : v);
  const streamData = async (ref) => {
    const obj = objects.get(ref.ref);
    if (!obj?.stream) return '';
    const dict = obj.value;
    let length = resolve(dict.get('Length'));
    if (typeof length !== 'number') length = s.indexOf('endstream', obj.stream.start) - obj.stream.start;
    let data = bytes.subarray(obj.stream.start, obj.stream.start + length);
    const filter = resolve(dict.get('Filter'));
    const filters = Array.isArray(filter) ? filter : filter ? [filter] : [];
    for (const f of filters) {
      if (f.name !== 'FlateDecode') return '';
      data = await inflate(data);
    }
    return latin1(data);
  };
  const pages = [];
  const walk = (node) => {
    const dict = resolve(node);
    if (!(dict instanceof Map)) return;
    if (dict.get('Type')?.name === 'Pages') for (const kid of resolve(dict.get('Kids')) ?? []) walk(kid);
    else pages.push(dict);
  };
  const trailerRoot = s.match(/\/Root\s+(\d+)\s+\d+\s+R/);
  const catalog = trailerRoot && objects.get(Number(trailerRoot[1]))?.value;
  if (catalog instanceof Map) walk(catalog.get('Pages'));
  return { resolve, streamData, pages };
}

// --- ToUnicode CMaps ---

const utf16be = (str) => {
  let out = '';
  for (let k = 0; k + 1 < str.length; k += 2) out += String.fromCharCode((str.charCodeAt(k) << 8) | str.charCodeAt(k + 1));
  return out;
};
const codeOf = (str) => [...str].reduce((n, ch) => n * 256 + ch.charCodeAt(0), 0);

function parseCMap(text) {
  const map = new Map();
  let width = 1;
  const lex = new Lexer(text);
  const tokens = [];
  for (let t = lex.next(); t !== null; t = lex.next()) tokens.push(t);
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t?.op === 'begincodespacerange' && typeof tokens[k + 1] === 'string') width = tokens[k + 1].length;
    if (t?.op === 'beginbfchar') {
      for (k++; tokens[k]?.op !== 'endbfchar' && k < tokens.length; k += 2) map.set(codeOf(tokens[k]), utf16be(tokens[k + 1]));
    }
    if (t?.op === 'beginbfrange') {
      for (k++; tokens[k]?.op !== 'endbfrange' && k < tokens.length; k += 3) {
        const lo = codeOf(tokens[k]);
        const hi = codeOf(tokens[k + 1]);
        const dst = tokens[k + 2];
        for (let code = lo; code <= hi; code++) {
          if (Array.isArray(dst)) map.set(code, utf16be(dst[code - lo] ?? ''));
          else {
            const base = utf16be(dst);
            map.set(code, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + code - lo));
          }
        }
      }
    }
  }
  return { map, width };
}

// --- Content streams ---

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const ID = [1, 0, 0, 1, 0, 0];

async function runContent(doc, content, resources, ctm, pieces, fontCache, depth) {
  if (depth > 10) return;
  const fonts = doc.resolve(resources?.get('Font'));
  const xobjects = doc.resolve(resources?.get('XObject'));
  const lex = new Lexer(content);
  const stack = [];
  const gstack = [];
  let tm = ID;
  let tlm = ID;
  let leading = 0;
  let font = null;
  let fontSize = 1;

  const loadFont = async (name) => {
    const ref = fonts?.get(name);
    const key = ref?.ref ?? name;
    if (!fontCache.has(key)) {
      const dict = doc.resolve(ref);
      const toUnicode = dict instanceof Map ? dict.get('ToUnicode') : null;
      const cmap = toUnicode?.ref ? parseCMap(await doc.streamData(toUnicode)) : null;
      const twoByte = dict?.get?.('Subtype')?.name === 'Type0';
      fontCache.set(key, cmap ?? { map: new Map(), width: twoByte ? 2 : 1 });
    }
    return fontCache.get(key);
  };
  const show = (str) => {
    if (!font) return;
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
  const moveLine = (tx, ty) => { tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm; };

  for (let t = lex.next(); t !== null; t = lex.next()) {
    if (!t || typeof t !== 'object' || !('op' in t)) { stack.push(t); continue; }
    const a = stack;
    switch (t.op) {
      case 'q': gstack.push(ctm); break;
      case 'Q': ctm = gstack.pop() ?? ctm; break;
      case 'cm': ctm = mul(a.slice(-6), ctm); break;
      case 'BT': tm = tlm = ID; break;
      case 'Tf': font = await loadFont(a.at(-2)?.name); fontSize = a.at(-1); break;
      case 'TL': leading = a.at(-1); break;
      case 'Tm': tm = tlm = a.slice(-6); break;
      case 'Td': moveLine(a.at(-2), a.at(-1)); break;
      case 'TD': leading = -a.at(-1); moveLine(a.at(-2), a.at(-1)); break;
      case 'T*': moveLine(0, -leading); break;
      case 'Tj': show(a.at(-1)); break;
      case "'": moveLine(0, -leading); show(a.at(-1)); break;
      case '"': moveLine(0, -leading); show(a.at(-1)); break;
      case 'TJ': for (const part of a.at(-1) ?? []) if (typeof part === 'string') show(part); break;
      case 'BI': lex.i = content.indexOf('EI', lex.i) + 2; break;
      case 'Do': {
        const ref = xobjects?.get(a.at(-1)?.name);
        const xo = doc.resolve(ref);
        if (xo instanceof Map && xo.get('Subtype')?.name === 'Form') {
          const matrix = doc.resolve(xo.get('Matrix')) ?? ID;
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
function toLines(pieces) {
  const sorted = [...pieces].sort((p, q) => q.y - p.y || p.x - q.x);
  const rows = [];
  for (const p of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(row.y - p.y) <= p.size * 0.3) row.pieces.push(p);
    else rows.push({ y: p.y, pieces: [p] });
  }
  return rows.map(({ pieces: ps }) => {
    ps.sort((p, q) => p.x - q.x);
    let line = '';
    let prev = null;
    for (const p of ps) {
      if (prev && p.text === prev.text && p.x - prev.x < p.size * 0.15) continue;
      if (prev && p.x - prev.x > prev.size * (0.75 * prev.text.length + 2)) line += ' ';
      line += p.text;
      prev = p;
    }
    return line.replace(/\s+/g, ' ').trim();
  }).filter(Boolean);
}

export async function pdfToLines(bytes) {
  const doc = parseDocument(bytes);
  const lines = [];
  for (const page of doc.pages) {
    const pieces = [];
    const contents = page.get('Contents');
    const refs = Array.isArray(doc.resolve(contents)) ? doc.resolve(contents) : [contents];
    let content = '';
    for (const ref of refs) content += `${await doc.streamData(ref)}\n`;
    await runContent(doc, content, doc.resolve(page.get('Resources')), ID, pieces, new Map(), 0);
    lines.push(...toLines(pieces));
  }
  return lines;
}
