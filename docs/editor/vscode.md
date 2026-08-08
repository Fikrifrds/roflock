# VS Code and language server

Roflock includes a local Language Server Protocol (LSP) executable and a VS Code
extension source package. Both use the public `.roflock` compiler. They do not
parse workflow syntax independently, start the daemon, execute a workflow, or
upload source.

## Language server

The npm package installs `roflock-lsp`. It communicates only through framed
JSON-RPC on standard input/output. Do not write logs, diagnostics, or shell
messages to its stdout: protocol clients treat stdout as LSP frames.

It supports:

- `initialize` / `shutdown` / `exit`;
- full-document `textDocument/didOpen`, `didChange`, and `didClose`;
- compiler diagnostics via `textDocument/publishDiagnostics`; and
- `workspace/executeCommand` with `roflock.compile`, receiving URI and source
  text and returning canonical Graph IR plus compiler diagnostics.

The server intentionally uses full-document synchronization. A client must send
the current complete text for a change; Roflock will not approximate incremental
edits and risk showing semantics different from the CLI or runtime.

## VS Code extension

The extension source is at
[`extensions/vscode-roflock`](../../extensions/vscode-roflock). It provides:

- `.roflock` syntax highlighting and comment/bracket behavior;
- workflow and deterministic-check snippets;
- live compiler diagnostics from `roflock-lsp`; and
- a command to open the public Language Playground.

Install the public `roflock` CLI first so `roflock-lsp` is on `PATH`. For a
custom location, configure:

```json
{
  "roflock.languageServer.command": "/absolute/path/to/roflock-lsp",
  "roflock.languageServer.args": []
}
```

The extension runs the server locally. An open editor document is sent to that
local process for compilation, but no Roflock daemon, provider, repository, or
credential is involved. Use `roflock run` or Studio separately when you intend
to execute a governed workflow.

## Packaging the extension

The extension is intentionally source-first until the VS Code Marketplace
publisher identity is configured. From its directory, a maintainer can package
it with the standard VS Code extension tooling after reviewing its manifest and
the installed CLI contract. Marketplace publication is an operator action and
does not alter Roflock's npm release or local-runtime trust model.
