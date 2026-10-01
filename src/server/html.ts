const NAMED = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  aring: 'å',
  Aring: 'Å',
  auml: 'ä',
  Auml: 'Ä',
  ouml: 'ö',
  Ouml: 'Ö',
  eacute: 'é',
  Eacute: 'É',
  uuml: 'ü',
  Uuml: 'Ü',
  ndash: '–',
  mdash: '—',
  rdquo: '”',
  ldquo: '“',
  rsquo: '’',
  lsquo: '‘',
  copy: '©',
  hellip: '…',
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return NAMED[e] ?? m;
  });
}

// Applies a regex replacement until the string stops changing, so removed markup can't
// reassemble from its leftovers (e.g. "<scr<script></script>ipt>").
function replaceAll(s, re, to) {
  let prev;
  do {
    prev = s;
    s = s.replace(re, to);
  } while (s !== prev);
  return s;
}

// Flattens an HTML page into trimmed, non-empty text lines (one per block element).
// The result is plain text: it is only ever rendered with textContent.
export function htmlToLines(html) {
  let text = replaceAll(html, /<(script|style|noscript)[\s\S]*?<\/\1>/gi, '');
  text = replaceAll(text, /<!--[\s\S]*?-->/g, '');
  text = text.replace(/<(br|\/p|\/div|\/h\d|\/li|\/tr)[^>]*>/gi, '\n');
  text = replaceAll(text, /<[^>]+>/g, '');
  return decodeEntities(text)
    .replace(/[\u200b\u00a0]/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
