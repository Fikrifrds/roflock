# Roflock for VS Code

This extension adds `.roflock` syntax highlighting, snippets, bracket/comment
rules, and diagnostics from the installed `roflock-lsp` compiler server.

Install the public `roflock` CLI first. The extension starts `roflock-lsp` on
your machine and sends only open editor documents to that local process. It does
not start the daemon, run an agent, upload source, or grant a workflow any
permission.

If the executable is not on `PATH`, set `roflock.languageServer.command` to its
absolute path. `roflock.languageServer.args` supplies any required arguments.

The extension is a local editor client for the same compiler contract used by
the CLI and Playground; it is not a second parser or workflow runtime.
