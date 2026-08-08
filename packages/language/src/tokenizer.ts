import type { SourcePosition, SourceSpan } from '@roleflock/graph-ir';

/**
 * `.roflock` tokenizer.
 *
 * Keywords are not reserved: `agent`, `role`, `check` and friends are lexed as
 * plain identifiers and given meaning by position in the parser. That means a
 * node may legitimately be called `Check` or `Flow`, and adding a declaration
 * keyword later cannot break a workflow someone already wrote.
 */

export type TokenType =
  'identifier' | 'string' | 'number' | 'lbrace' | 'rbrace' | 'arrow' | 'dot' | 'comma' | 'eof';

export interface Token {
  type: TokenType;
  /** For strings, the decoded value; otherwise the source text. */
  value: string;
  span: SourceSpan;
}

export class TokenizeError extends Error {
  constructor(
    message: string,
    readonly span: SourceSpan,
  ) {
    super(message);
    this.name = 'TokenizeError';
  }
}

const PUNCTUATION: Record<string, TokenType> = {
  '{': 'lbrace',
  '}': 'rbrace',
  ',': 'comma',
  '.': 'dot',
};

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

/**
 * Deliberately excludes `.` and `-`. `.` separates a node from its outcome in
 * `Tests.pass`, and `-` would swallow the first half of `->`, turning
 * `Tests->Builder` into an identifier followed by a stray `>`.
 */
function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

export function tokenize(source: string, uri?: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  let line = 1;
  let column = 1;

  const here = (): SourcePosition => ({ line, column, offset });
  const spanFrom = (start: SourcePosition): SourceSpan =>
    uri === undefined ? { start, end: here() } : { uri, start, end: here() };

  const advance = (count = 1) => {
    for (let i = 0; i < count; i += 1) {
      if (source[offset] === '\n') {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      offset += 1;
    }
  };

  while (offset < source.length) {
    const char = source[offset]!;

    if (/\s/.test(char)) {
      advance();
      continue;
    }

    // `#` and `//` both start a line comment. `#` reads naturally in config-like
    // files; `//` is what most editors' comment shortcut inserts.
    if (char === '#' || (char === '/' && source[offset + 1] === '/')) {
      while (offset < source.length && source[offset] !== '\n') advance();
      continue;
    }

    const start = here();

    if (char === '-' && source[offset + 1] === '>') {
      advance(2);
      tokens.push({ type: 'arrow', value: '->', span: spanFrom(start) });
      continue;
    }

    const punctuation = PUNCTUATION[char];
    if (punctuation) {
      advance();
      tokens.push({ type: punctuation, value: char, span: spanFrom(start) });
      continue;
    }

    if (char === '"') {
      advance();
      let value = '';
      let closed = false;
      while (offset < source.length) {
        const current = source[offset]!;
        if (current === '\\') {
          const escaped = source[offset + 1];
          if (escaped === undefined) break;
          value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
          advance(2);
          continue;
        }
        if (current === '"') {
          advance();
          closed = true;
          break;
        }
        if (current === '\n') break;
        value += current;
        advance();
      }
      if (!closed) {
        throw new TokenizeError('Unterminated string literal', spanFrom(start));
      }
      tokens.push({ type: 'string', value, span: spanFrom(start) });
      continue;
    }

    if (/[0-9]/.test(char)) {
      let value = '';
      while (offset < source.length && /[0-9]/.test(source[offset]!)) {
        value += source[offset];
        advance();
      }
      tokens.push({ type: 'number', value, span: spanFrom(start) });
      continue;
    }

    if (isIdentifierStart(char)) {
      let value = '';
      while (offset < source.length && isIdentifierPart(source[offset]!)) {
        value += source[offset];
        advance();
      }
      tokens.push({ type: 'identifier', value, span: spanFrom(start) });
      continue;
    }

    advance();
    throw new TokenizeError(`Unexpected character '${char}'`, spanFrom(start));
  }

  const end = here();
  tokens.push({
    type: 'eof',
    value: '',
    span: uri === undefined ? { start: end, end } : { uri, start: end, end },
  });
  return tokens;
}
