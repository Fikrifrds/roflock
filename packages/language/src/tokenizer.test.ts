import { describe, expect, it } from 'vitest';
import { TokenizeError, tokenize, type Token } from './tokenizer.js';

/** Tokens as compact `type:value` strings, dropping the trailing eof. */
function lex(source: string): string[] {
  return tokenize(source)
    .slice(0, -1)
    .map((token) => `${token.type}:${token.value}`);
}

describe('tokenizing .roflock source', () => {
  describe('token kinds', () => {
    it('lexes identifiers, punctuation, and the arrow', () => {
      expect(lex('Builder -> Tests')).toEqual([
        'identifier:Builder',
        'arrow:->',
        'identifier:Tests',
      ]);
    });

    it('lexes braces, commas, and dots', () => {
      expect(lex('{ , . }')).toEqual(['lbrace:{', 'comma:,', 'dot:.', 'rbrace:}']);
    });

    it('lexes numbers as single tokens regardless of width', () => {
      expect(lex('max_cost 1000000')).toEqual(['identifier:max_cost', 'number:1000000']);
    });

    it('keeps a number and an adjacent identifier apart', () => {
      // `5x` is two tokens, not a malformed number: the tokenizer reports
      // what is there and the parser says what is wrong with it.
      expect(lex('5x')).toEqual(['number:5', 'identifier:x']);
    });

    it('never reserves declaration keywords', () => {
      // `agent`, `check`, and `flow` must lex as plain identifiers so a node
      // may be named after them; position, not the word, carries meaning.
      for (const keyword of ['workflow', 'role', 'agent', 'check', 'action', 'human', 'flow']) {
        const token = tokenize(keyword)[0]!;
        expect(token.type).toBe('identifier');
        expect(token.value).toBe(keyword);
      }
    });

    it('allows underscores and digits inside identifiers but not at the start', () => {
      expect(lex('planner_tests _private a1b2')).toEqual([
        'identifier:planner_tests',
        'identifier:_private',
        'identifier:a1b2',
      ]);
      expect(() => tokenize('1abc')).not.toThrow();
      expect(lex('1abc')).toEqual(['number:1', 'identifier:abc']);
    });

    it('terminates every stream with one eof token', () => {
      const tokens = tokenize('');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.type).toBe('eof');
    });
  });

  describe('strings', () => {
    it('decodes \\n and \\t escapes', () => {
      expect(lex('"a\\nb\\tc"')).toEqual(['string:a\nb\tc']);
    });

    it('keeps the character after an unknown escape', () => {
      // Documented: a backslash before any other character keeps that
      // character, so `\x` is `x` and `\u0041` is `u0041` — not unicode.
      expect(lex('"\\x\\u0041"')).toEqual(['string:xu0041']);
    });

    it('decodes an escaped backslash and an escaped quote', () => {
      expect(lex('"C:\\\\path"')).toEqual(['string:C:\\path']);
      expect(lex('"say \\"hi\\""')).toEqual(['string:say "hi"']);
    });

    it('lexes the empty string', () => {
      expect(lex('""')).toEqual(['string:']);
    });

    it('rejects a string broken by a newline', () => {
      expect(() => tokenize('"abc\ndef"')).toThrow(TokenizeError);
      try {
        tokenize('"abc\ndef"');
      } catch (error) {
        expect((error as TokenizeError).message).toContain('Unterminated string');
        expect((error as TokenizeError).span.start.line).toBe(1);
      }
    });

    it('rejects a string left open at end of file, including a trailing escape', () => {
      expect(() => tokenize('"abc')).toThrow(TokenizeError);
      // A backslash at the very end must not read past the buffer.
      expect(() => tokenize('"abc\\')).toThrow(TokenizeError);
    });
  });

  describe('comments and whitespace', () => {
    it('skips # comments to end of line', () => {
      expect(lex('a # hidden -> { "x"\nb')).toEqual(['identifier:a', 'identifier:b']);
    });

    it('skips // comments to end of line', () => {
      expect(lex('a // hidden\nb')).toEqual(['identifier:a', 'identifier:b']);
    });

    it('skips a comment that runs to end of file without a newline', () => {
      expect(lex('a # no newline after this')).toEqual(['identifier:a']);
    });

    it('does not treat a lone slash as a comment', () => {
      expect(() => tokenize('/ x')).toThrow(TokenizeError);
    });

    it('treats spaces, tabs, and carriage returns as whitespace', () => {
      expect(lex('a\t\r\n  b')).toEqual(['identifier:a', 'identifier:b']);
    });
  });

  describe('spans', () => {
    it('tracks line, column, and offset across newlines', () => {
      const tokens = tokenize('aa\nbbb');
      const [aa, bbb] = tokens as [Token, Token];
      expect(aa.span.start).toMatchObject({ line: 1, column: 1, offset: 0 });
      expect(aa.span.end).toMatchObject({ line: 1, column: 3, offset: 2 });
      expect(bbb.span.start).toMatchObject({ line: 2, column: 1, offset: 3 });
    });

    it('counts the arrow as two columns', () => {
      const [arrow] = tokenize('  ->') as [Token];
      expect(arrow.span.start).toMatchObject({ line: 1, column: 3, offset: 2 });
      expect(arrow.span.end).toMatchObject({ line: 1, column: 5, offset: 4 });
    });

    it('places the eof span after the final token', () => {
      const tokens = tokenize('a\n');
      const eof = tokens.at(-1)!;
      expect(eof.span.start).toMatchObject({ line: 2, column: 1, offset: 2 });
    });

    it('carries the uri into every span when given', () => {
      for (const token of tokenize('a "b"', 'file.roflock')) {
        expect(token.span.uri).toBe('file.roflock');
      }
    });

    it('omits the uri when none was given', () => {
      for (const token of tokenize('a')) {
        expect('uri' in token.span).toBe(false);
      }
    });
  });

  describe('rejections', () => {
    it('rejects a stray hyphen that is not an arrow', () => {
      expect(() => tokenize('Tests - Builder')).toThrow(/Unexpected character '-'/);
    });

    it('rejects a stray closing angle bracket', () => {
      expect(() => tokenize('a > b')).toThrow(/Unexpected character '>'/);
    });

    it('rejects semicolons, which the language does not accept', () => {
      expect(() => tokenize('a;')).toThrow(/Unexpected character ';'/);
    });

    it('rejects non-ASCII characters outside strings', () => {
      expect(() => tokenize('naïve')).toThrow(TokenizeError);
    });

    it('reports the offending character and its position', () => {
      try {
        tokenize('a\n  ?');
        expect.unreachable('tokenize must throw');
      } catch (error) {
        expect((error as TokenizeError).span.start).toMatchObject({ line: 2, column: 3 });
      }
    });
  });
});
