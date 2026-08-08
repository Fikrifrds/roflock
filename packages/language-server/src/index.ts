import { compile } from '@roleflock/language';
import type { Diagnostic } from '@roleflock/graph-ir';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params: unknown;
}

export interface LspDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: 1 | 2 | 3 | 4;
  code: string;
  source: 'roflock';
  message: string;
}

export interface LanguageServer {
  handle(request: JsonRpcRequest): Array<JsonRpcResponse | JsonRpcNotification>;
}

function lspDiagnostic(diagnostic: Diagnostic): LspDiagnostic {
  const start = diagnostic.span?.start;
  const end = diagnostic.span?.end;
  return {
    range: {
      start: {
        line: Math.max(0, (start?.line ?? 1) - 1),
        character: Math.max(0, start?.column ?? 0),
      },
      end: {
        line: Math.max(0, (end?.line ?? start?.line ?? 1) - 1),
        character: Math.max(0, end?.column ?? start?.column ?? 0),
      },
    },
    severity: diagnostic.severity === 'error' ? 1 : diagnostic.severity === 'warning' ? 2 : 3,
    code: diagnostic.code,
    source: 'roflock',
    message: diagnostic.message,
  };
}

function textDocument(params: unknown): { uri: string; text: string } | undefined {
  if (typeof params !== 'object' || params === null) return undefined;
  const document = (params as { textDocument?: unknown }).textDocument;
  if (typeof document !== 'object' || document === null) return undefined;
  const candidate = document as { uri?: unknown; text?: unknown };
  return typeof candidate.uri === 'string' && typeof candidate.text === 'string'
    ? { uri: candidate.uri, text: candidate.text }
    : undefined;
}

function changedDocument(
  params: unknown,
  documents: Map<string, string>,
): { uri: string; text: string } | undefined {
  if (typeof params !== 'object' || params === null) return undefined;
  const typed = params as { textDocument?: { uri?: unknown }; contentChanges?: unknown };
  const uri = typed.textDocument?.uri;
  const changes = typed.contentChanges;
  if (typeof uri !== 'string' || !Array.isArray(changes) || changes.length === 0) return undefined;
  const latest = changes.at(-1);
  if (
    typeof latest !== 'object' ||
    latest === null ||
    typeof (latest as { text?: unknown }).text !== 'string'
  ) {
    return undefined;
  }
  const text = (latest as { text: string }).text;
  documents.set(uri, text);
  return { uri, text };
}

function publication(uri: string, source: string): JsonRpcNotification {
  const result = compile(source, { uri });
  return {
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: { uri, diagnostics: result.diagnostics.map(lspDiagnostic) },
  };
}

function reply(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function methodNotFound(id: JsonRpcRequest['id'], method: string): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

/**
 * Minimal, dependency-free LSP 3.17 surface. It deliberately shares the
 * public compiler rather than carrying editor-only grammar or validation code.
 * Text synchronization is full-document: a client may send incremental changes,
 * but its final change must include text so no silent approximation is made.
 */
export function createLanguageServer(): LanguageServer {
  const documents = new Map<string, string>();
  return {
    handle(request) {
      if (request.method === 'initialize') {
        return [
          reply(request.id, {
            capabilities: {
              positionEncoding: 'utf-16',
              textDocumentSync: 1,
              executeCommandProvider: { commands: ['roflock.compile'] },
            },
            serverInfo: { name: 'roflock-lsp', version: '0.1.0' },
          }),
        ];
      }
      if (request.method === 'shutdown') return [reply(request.id, null)];
      if (request.method === 'exit') return [];
      if (request.method === 'textDocument/didOpen') {
        const document = textDocument(request.params);
        if (!document) return [];
        documents.set(document.uri, document.text);
        return [publication(document.uri, document.text)];
      }
      if (request.method === 'textDocument/didChange') {
        const document = changedDocument(request.params, documents);
        return document ? [publication(document.uri, document.text)] : [];
      }
      if (request.method === 'textDocument/didClose') {
        const uri = (request.params as { textDocument?: { uri?: unknown } } | undefined)
          ?.textDocument?.uri;
        if (typeof uri !== 'string') return [];
        documents.delete(uri);
        return [
          {
            jsonrpc: '2.0',
            method: 'textDocument/publishDiagnostics',
            params: { uri, diagnostics: [] },
          },
        ];
      }
      if (request.method === 'workspace/executeCommand') {
        const params = request.params as { command?: unknown; arguments?: unknown } | undefined;
        if (params?.command !== 'roflock.compile' || !Array.isArray(params.arguments)) {
          return request.id === undefined ? [] : [methodNotFound(request.id, request.method)];
        }
        const [uri, source] = params.arguments;
        if (typeof uri !== 'string' || typeof source !== 'string') {
          return request.id === undefined
            ? []
            : [
                {
                  jsonrpc: '2.0',
                  id: request.id ?? null,
                  error: { code: -32602, message: 'Expected URI and source text' },
                },
              ];
        }
        const result = compile(source, { uri });
        return [reply(request.id, { ir: result.ir, diagnostics: result.diagnostics })];
      }
      return request.id === undefined ? [] : [methodNotFound(request.id, request.method)];
    },
  };
}

export function encodeJsonRpc(message: JsonRpcResponse | JsonRpcNotification): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

export function startStdioLanguageServer(input = process.stdin, output = process.stdout): void {
  const server = createLanguageServer();
  let buffer = Buffer.alloc(0);
  input.on('data', (chunk: Buffer | string) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const headers = buffer.subarray(0, headerEnd).toString('utf8');
      const match = /^content-length:\s*(\d+)\s*$/im.exec(headers);
      if (!match) {
        buffer = Buffer.alloc(0);
        return;
      }
      const contentLength = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + contentLength) return;
      const body = buffer.subarray(bodyStart, bodyStart + contentLength).toString('utf8');
      buffer = buffer.subarray(bodyStart + contentLength);
      try {
        const request = JSON.parse(body) as JsonRpcRequest;
        for (const response of server.handle(request)) output.write(encodeJsonRpc(response));
      } catch {
        // LSP transport errors have no reliable request ID. Do not write prose
        // to stdout: stdout is reserved for framed protocol messages.
      }
    }
  });
  input.resume();
}
