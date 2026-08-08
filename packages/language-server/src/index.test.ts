import { describe, expect, it } from 'vitest';
import { createLanguageServer, encodeJsonRpc } from './index.js';

describe('Roflock language server', () => {
  it('publishes compiler diagnostics for an opened Roflock document', () => {
    const server = createLanguageServer();
    const messages = server.handle({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: { textDocument: { uri: 'file:///broken.roflock', text: 'workflow {' } },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      method: 'textDocument/publishDiagnostics',
      params: { uri: 'file:///broken.roflock', diagnostics: [{ source: 'roflock', severity: 1 }] },
    });
  });

  it('offers a full-document compiler command without editor-only semantics', () => {
    const server = createLanguageServer();
    const messages = server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'workspace/executeCommand',
      params: {
        command: 'roflock.compile',
        arguments: [
          'file:///valid.roflock',
          'workflow Demo { version "1.0.0" } role reviewer { readonly } agent Review { role reviewer objective "Review" } human Accept { title "Accept" decisions approve, reject } flow { Review -> Accept }',
        ],
      },
    });

    expect(messages[0]).toMatchObject({ jsonrpc: '2.0', id: 1, result: { diagnostics: [] } });
  });

  it('frames outbound protocol messages with a byte-accurate content length', () => {
    const encoded = encodeJsonRpc({ jsonrpc: '2.0', method: 'test', params: { message: 'é' } });

    expect(encoded).toMatch(/^Content-Length: \d+\r\n\r\n/);
    const [, body] = encoded.split('\r\n\r\n');
    const length = Number(/^Content-Length: (\d+)/.exec(encoded)?.[1]);
    expect(Buffer.byteLength(body!, 'utf8')).toBe(length);
  });
});
