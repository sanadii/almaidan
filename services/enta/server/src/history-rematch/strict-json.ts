/** Validate grammar, nesting and decoded object keys before materializing JSON. */
export function strictJSON(text: string, maxBytes: number): unknown {
  if (typeof text !== 'string' || !Number.isSafeInteger(maxBytes) || maxBytes < 0 || Buffer.byteLength(text, 'utf8') > maxBytes) throw new SyntaxError('JSON bound');
  let i = 0;
  const ws = () => { while (text[i] === ' ' || text[i] === '\t' || text[i] === '\r' || text[i] === '\n') i++; };
  const string = (decode: boolean): string => {
    const start = i;
    if (text[i++] !== '"') throw new SyntaxError('JSON string');
    while (i < text.length) {
      const c = text.charCodeAt(i++);
      if (c === 34) return decode ? JSON.parse(text.slice(start, i)) as string : '';
      if (c < 32) throw new SyntaxError('JSON string');
      if (c === 92) {
        const escape = text[i++];
        if (escape === 'u') {
          for (let n = 0; n < 4; n++) if (!/[0-9a-fA-F]/.test(text[i++] ?? '')) throw new SyntaxError('JSON escape');
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) throw new SyntaxError('JSON escape');
      }
    }
    throw new SyntaxError('JSON string');
  };
  const value = (depth: number): void => {
    if (depth > 8) throw new SyntaxError('JSON depth');
    ws();
    if (text[i] === '{') {
      i++; ws(); const seen = new Set<string>();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        ws(); const key = string(true);
        if (seen.has(key)) throw new SyntaxError('Duplicate JSON key');
        seen.add(key); ws(); if (text[i++] !== ':') throw new SyntaxError('JSON colon');
        value(depth + 1); ws();
        if (text[i] === '}') { i++; return; }
        if (text[i++] !== ',') throw new SyntaxError('JSON object');
      }
    }
    if (text[i] === '[') {
      i++; ws(); if (text[i] === ']') { i++; return; }
      for (;;) {
        value(depth + 1); ws();
        if (text[i] === ']') { i++; return; }
        if (text[i++] !== ',') throw new SyntaxError('JSON array');
      }
    }
    if (text[i] === '"') { string(false); return; }
    for (const literal of ['true', 'false', 'null']) if (text.startsWith(literal, i)) { i += literal.length; return; }
    const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
    number.lastIndex = i; const match = number.exec(text);
    if (!match) throw new SyntaxError('JSON value');
    i = number.lastIndex;
  };
  value(0); ws(); if (i !== text.length) throw new SyntaxError('JSON suffix');
  return JSON.parse(text) as unknown;
}
