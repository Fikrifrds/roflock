/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extensions through CommonJS. */
const { spawn } = require('node:child_process');
const vscode = require('vscode');

function frame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

function startClient() {
  const configuration = vscode.workspace.getConfiguration('roflock.languageServer');
  const command = configuration.get('command', 'roflock-lsp');
  const args = configuration.get('args', []);
  const process = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const diagnostics = vscode.languages.createDiagnosticCollection('roflock');
  let buffer = Buffer.alloc(0);
  let requestId = 0;

  function send(message) {
    process.stdin.write(frame({ jsonrpc: '2.0', ...message }));
  }

  function sync(document, method) {
    if (document.languageId !== 'roflock') return;
    send({
      method,
      params:
        method === 'textDocument/didClose'
          ? { textDocument: { uri: document.uri.toString() } }
          : {
              textDocument:
                method === 'textDocument/didOpen'
                  ? {
                      uri: document.uri.toString(),
                      languageId: 'roflock',
                      version: document.version,
                      text: document.getText(),
                    }
                  : { uri: document.uri.toString(), version: document.version },
              ...(method === 'textDocument/didChange'
                ? { contentChanges: [{ text: document.getText() }] }
                : {}),
            },
    });
  }

  function publish(params) {
    if (!params || typeof params.uri !== 'string' || !Array.isArray(params.diagnostics)) return;
    diagnostics.set(
      vscode.Uri.parse(params.uri),
      params.diagnostics.map((diagnostic) => {
        const range = new vscode.Range(
          diagnostic.range.start.line,
          diagnostic.range.start.character,
          diagnostic.range.end.line,
          diagnostic.range.end.character,
        );
        return new vscode.Diagnostic(range, diagnostic.message, diagnostic.severity);
      }),
    );
  }

  process.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const match = /^content-length:\s*(\d+)\s*$/im.exec(
        buffer.subarray(0, headerEnd).toString('utf8'),
      );
      if (!match) {
        buffer = Buffer.alloc(0);
        return;
      }
      const start = headerEnd + 4;
      const length = Number(match[1]);
      if (buffer.length < start + length) return;
      const message = JSON.parse(buffer.subarray(start, start + length).toString('utf8'));
      buffer = buffer.subarray(start + length);
      if (message.method === 'textDocument/publishDiagnostics') publish(message.params);
    }
  });
  process.on('error', (error) => {
    vscode.window.showWarningMessage(`Roflock language server could not start: ${error.message}`);
  });

  send({
    id: ++requestId,
    method: 'initialize',
    params: { processId: process.pid, rootUri: null, capabilities: {} },
  });
  send({ method: 'initialized', params: {} });
  vscode.workspace.textDocuments.forEach((document) => sync(document, 'textDocument/didOpen'));

  return {
    diagnostics,
    subscriptions: [
      vscode.workspace.onDidOpenTextDocument((document) => sync(document, 'textDocument/didOpen')),
      vscode.workspace.onDidChangeTextDocument(({ document }) =>
        sync(document, 'textDocument/didChange'),
      ),
      vscode.workspace.onDidCloseTextDocument((document) =>
        sync(document, 'textDocument/didClose'),
      ),
      {
        dispose: () => {
          send({ id: ++requestId, method: 'shutdown' });
          send({ method: 'exit' });
          process.kill();
        },
      },
    ],
  };
}

function activate(context) {
  const client = startClient();
  context.subscriptions.push(client.diagnostics, ...client.subscriptions);
  context.subscriptions.push(
    vscode.commands.registerCommand('roflock.openPlayground', () =>
      vscode.env.openExternal(
        vscode.Uri.parse('https://github.com/Fikrifrds/roflock/tree/main/apps/playground'),
      ),
    ),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
