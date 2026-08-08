# Roflock CLI Distribution & Existing Coding Harness Integration Plan

**Version:** 1.0  
**Date:** 8 August 2026  
**Status:** Approved product/implementation supplement  
**Companion:** Roflock Evolution Implementation Plan v1.0

---

# 1. Decision summary

Roflock must ship a **first-class CLI** and must integrate with coding harnesses developers already use.

Roflock is not another coding agent that forces developers to abandon Codex, Claude Code, Pi, OpenCode, Cursor, T3 Code, or similar tools.

The product model is:

```text
Existing coding harnesses
          +
       Roflock
```

Roflock owns:

- workflow definition;
- graph orchestration;
- role assignment;
- bounded retries;
- deterministic verification;
- repository/worktree coordination;
- policies and permissions;
- human approvals;
- evidence and provenance;
- replay and evaluation.

The coding harness continues to own:

- its internal agent loop;
- model interaction;
- file editing;
- harness-specific tools;
- session/context behavior;
- provider authentication.

Core message:

> **Keep your coding agents. Orchestrate them with Roflock.**

---

# 2. CLI is a permanent product surface

The Roflock CLI is not a temporary development utility.

It is a first-class surface alongside:

```text
Roflock Language
Roflock Runtime
Roflock CLI
Roflock Studio
Roflock Playground
Roflock SDK/API
```

Initial developer experience:

```bash
npm install -g roflock

roflock check .roflock/bugfix.roflock
roflock run .roflock/bugfix.roflock
roflock status run_123
roflock evidence run_123
```

Zero-install trial where practical:

```bash
npx roflock check example.roflock
```

The CLI must work without a Roflock Cloud account.

---

# 3. Initial distribution strategy

## 3.1 Phase 1 — npm / npx

The first public CLI release should use the Node/npm ecosystem.

Preferred:

```bash
npm install -g roflock
```

If the unscoped package name cannot be used, publish:

```text
@roflock/cli
```

while keeping the executable name:

```text
roflock
```

Example:

```json
{
  "name": "@roflock/cli",
  "bin": {
    "roflock": "./dist/bin/roflock.js"
  }
}
```

Package-name availability is a release-time decision. The executable name remains `roflock`.

## 3.2 OS targets

The Node CLI should target:

- macOS;
- Linux;
- Windows.

Language/compiler/validation features must remain cross-platform.

Driver support may vary by OS and must report capabilities truthfully.

---

# 4. Apple Developer Program decision

## 4.1 Not required for initial CLI

An npm-distributed Node CLI does not require an Apple Developer Program membership merely because it runs on macOS.

Initial Roflock distribution does not need to wait for a paid Apple developer account.

These do not make Apple membership a product requirement:

```text
GitHub source
npm package
npx usage
web Playground
Docker/self-host server
Node-based CLI
```

## 4.2 When Apple Developer becomes relevant

Signing/notarization becomes relevant when Roflock distributes native macOS artifacts directly, for example:

```text
Roflock Studio.app
roflock-darwin-arm64
roflock-darwin-x64
signed installer/package
```

At that point release engineering should include:

- Developer ID signing;
- hardened runtime where applicable;
- notarization;
- signed-release automation.

Native packaging must not block CLI v0.x.

## 4.3 Recommended timing

```text
Public alpha
   → npm / npx

Early adoption
   → optional Homebrew / standalone builds

Native Studio/binaries
   → Apple signing + notarization
```

---

# 5. Harness interoperability is a core feature

Roflock supports integration in **two directions**.

## Mode A — Roflock invokes an existing harness

```text
roflock run
     ↓
Roflock Runtime
     ↓
AgentDriver
     ↓
Codex / Claude Code / Pi / OpenCode / ...
```

Example workflow:

```roflock
flow BugFix {
  Builder -> Tests
  Tests.fail -> Builder { max 3 }
  Tests.pass -> Reviewer
}
```

Execution profile concept:

```text
Builder  → Codex
Reviewer → Claude Code
```

Changing harness must not require rewriting the workflow.

## Mode B — Existing harness invokes Roflock

A developer may remain inside Claude Code, Codex, Pi, OpenCode, or another UI and invoke Roflock using:

```text
Roflock CLI
Roflock MCP
Roflock local API
Roflock SDK
```

Concept:

```text
Claude Code
    ↓
Roflock MCP / CLI
    ↓
Roflock daemon
    ↓
BugFix.roflock
    ↓
Codex + deterministic checks + reviewer + approval
```

This is a major adoption strategy because users do not need to change their preferred coding interface.

---

# 6. Coding harness vs control surface

Not every external coding product should be modeled identically.

## Coding harness / agent runtime

Examples:

```text
Codex
Claude Code
Pi
OpenCode
compatible/custom agent runtimes
```

These belong primarily behind `AgentDriver`.

## Control surface

A product such as T3 Code may primarily be a UI/control surface over coding agents.

Preferred future integration:

```text
T3 Code
   ↓
Roflock API / integration
   ↓
Roflock Runtime
   ↓
Codex / Claude / Pi
```

Avoid making this the default execution path:

```text
Roflock → T3 → Codex
```

when a stable direct path exists:

```text
Roflock → Codex
```

T3-style integration is valuable as an optional client/control surface, not as a core runtime dependency.

---

# 7. AgentDriver must become a major public contract

Target conceptual interface:

```typescript
interface AgentDriver {
  id: string;

  detect(): Promise<DriverAvailability>;

  authenticate?(): Promise<AuthStatus>;

  capabilities(): Promise<DriverCapabilities>;

  start(request: AgentRunRequest): AsyncIterable<AgentEvent>;

  resume?(sessionId: string, request: AgentResumeRequest): AsyncIterable<AgentEvent>;

  interrupt?(runId: string): Promise<InterruptResult>;

  dispose?(sessionId: string): Promise<void>;
}
```

The final public v1 contract requires an RFC.

---

# 8. Capability-driven integration

Roflock must never assume all harnesses support identical behavior.

Example conceptual capability schema:

```typescript
interface DriverCapabilities {
  streaming: boolean;
  structuredOutput: boolean;

  workspaceRead: boolean;
  workspaceWrite: boolean;

  sessions: boolean;
  resume: boolean;

  cancellation: 'none' | 'local-process' | 'cooperative' | 'remote-confirmed';

  usageReporting: boolean;
  modelSelection: boolean;
  effortSelection: boolean;

  toolEvents: boolean;
  permissionControls: boolean;
}
```

Capability reporting must be truthful.

If a driver cannot prove remote cancellation, Roflock must not claim the remote work has certainly stopped.

---

# 9. Initial driver priority

Recommended order:

```text
1. Fake deterministic driver
2. Codex
3. Claude Code
4. Pi
5. OpenCode
6. OpenAI-compatible
7. Anthropic-compatible
8. Generic custom HTTP/local endpoints
9. Cursor / others where stable integration exists
```

Fake-driver conformance comes first because graph/runtime semantics must be testable without provider uncertainty.

---

# 10. Codex integration direction

Preferred:

```text
Roflock Runtime
      ↓
CodexDriver
      ↓
stable Codex programmatic surface
      ↓
Codex harness
```

Prefer a supported programmatic server/API surface over shell scraping when possible.

Roflock should reuse Codex's own:

- coding loop;
- file editing;
- tool execution;
- model behavior.

Roflock controls the outer workflow/governance.

---

# 11. Claude Code integration direction

The Claude driver should map supported harness behavior into Roflock events, including where available:

- non-interactive execution;
- model/effort selection;
- structured/streaming output;
- session identity;
- resume;
- tool/permission modes;
- process identity;
- usage;
- interruption.

Claude-specific concepts must not become Graph IR semantics.

---

# 12. Pi integration direction

Pi is strategically useful because it can function as a lightweight/extensible coding harness.

Prefer a stable programmatic integration such as:

```text
Pi RPC
```

or supported SDK/session APIs.

A `driver-pi` implementation must pass the same public driver conformance suite as other integrations.

---

# 13. OpenCode and additional harnesses

Integrate through:

- native driver where a stable programmatic contract exists;
- compatible protocol when appropriate;
- CLI/process adapter only where necessary.

Do not create separate graph semantics for each provider.

All harnesses converge on:

```text
AgentDriver
   ↓
AgentEvent
```

---

# 14. Workflow portability

Harness identity should normally live outside core workflow semantics.

Preferred:

```roflock
role Builder {
  requires coding.write
}

role Reviewer {
  requires coding.review
  readonly
}
```

Execution profile:

```text
Builder  = codex
Reviewer = claude
```

Another developer can choose:

```text
Builder  = claude
Reviewer = pi
```

without changing `bugfix.roflock`.

This is a core portability requirement.

---

# 15. CLI command model

## Language

```bash
roflock check workflow.roflock
roflock compile workflow.roflock
roflock format workflow.roflock
roflock validate-ir workflow.ir.json
```

## Runtime

```bash
roflock run workflow.roflock
roflock status run_123
roflock events run_123
roflock logs run_123
roflock pause run_123
roflock resume run_123
roflock stop run_123
roflock cancel run_123
```

## Approval/evidence

```bash
roflock approve run_123 Approval
roflock reject run_123 Approval
roflock evidence run_123
roflock why run_123 --file src/payment.ts
```

## Setup/health

```bash
roflock init
roflock doctor
roflock drivers
roflock drivers doctor
```

## Later

```bash
roflock add
roflock publish
roflock replay
roflock fork
roflock simulate
```

---

# 16. `roflock init`

Recommended bootstrap:

```bash
roflock init
```

creates:

```text
.roflock/
  workflows/
    bugfix.roflock
  profiles/
    local.toml
  policies/
    default.toml
  roflock.toml
```

Exact config syntax remains an RFC/implementation decision.

Provider credentials must not be committed into project source by default.

---

# 17. `roflock doctor`

Because Roflock depends on external harnesses, environment diagnosis is a major usability feature.

Example:

```text
Roflock           ready
Node              ready
Git               ready

Codex             detected · authenticated
Claude Code       detected · authenticated
Pi                not installed
OpenCode          detected

Repository        valid
Worktree support  ready
Local daemon      running
```

Detection and authentication must be separate concepts.

Do not report authenticated based only on the executable existing.

---

# 18. Authentication ownership

Prefer reusing authentication already owned by the coding harness:

```text
Codex login/subscription
Claude Code login/subscription
Pi provider configuration
OpenCode provider configuration
```

Do not unnecessarily duplicate credentials.

For direct API/custom drivers, use Roflock secret-store/BYOK.

---

# 19. Playground → CLI funnel

Recommended adoption path:

```text
roflock.com/play
       ↓
write `.roflock`
       ↓
live graph + diagnostics
       ↓
simulate
       ↓
"Run for real"
       ↓
npm install -g roflock
       ↓
local runtime
       ↓
existing coding harnesses
```

The public Playground is browser-safe.

It must never directly gain unrestricted:

- shell access;
- filesystem access;
- local credentials;
- agent-process control.

Real execution belongs to local/self-hosted Roflock.

---

# 20. Local daemon architecture

```text
Studio / external harness / approved browser handoff
                    ↓
                local API
                    ↓
             Roflock daemon
                    ↓
              Runtime Core
                    ↓
              AgentDrivers
```

Any website-to-local-runtime handoff requires explicit user action and a security design.

Do not silently bridge a public origin to local shell execution.

---

# 21. MCP integration

Roflock should eventually provide an MCP interface so existing coding harnesses can use it as a tool.

Candidate operations:

```text
roflock_check
roflock_compile
roflock_simulate
roflock_run
roflock_status
roflock_events
roflock_evidence
```

Protected approval must remain external.

An agent invoking Roflock must not automatically gain authority to approve its own protected action.

Concept:

```text
Agent → roflock_run       policy-controlled
Agent → approve itself    forbidden
```

---

# 22. T3-style control-surface integration

A future T3-like client may consume:

- local HTTP API;
- SSE/WebSocket event stream;
- plugin/provider interface;
- CLI integration.

Possible UX:

```text
Runtime
○ Codex
○ Claude
○ OpenCode
● Roflock

Workflow  Bug Fix
Builder   Codex
Reviewer  Claude
State     Tests retry 2/3
```

This remains an ecosystem integration, not a core dependency.

---

# 23. Release pipeline

Recommended:

```text
main
 ↓
CI
 ↓
build / lint / typecheck / test
 ↓
version + changelog
 ↓
npm package verification
 ↓
publish
 ↓
GitHub Release
```

Prefer trusted publishing/OIDC where supported instead of long-lived registry credentials.

---

# 24. Package verification

Before publish:

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
npm pack
```

Then install the packed artifact in a clean temporary environment and verify:

```bash
roflock --version
roflock --help
roflock check <fixture>
```

Later:

```bash
roflock run <fake-driver-fixture>
```

Source-tree execution is not enough to prove a package release works.

---

# 25. Native binaries are later

Do not prematurely convert the whole Node application into native binaries merely for aesthetics.

Add native binaries only after:

- CLI semantics stabilize;
- driver process behavior is reliable;
- installation demand justifies it.

Possible later assets:

```text
roflock-darwin-arm64
roflock-darwin-x64
roflock-linux-x64
roflock-linux-arm64
roflock-win-x64.exe
```

Native macOS assets then receive the appropriate signing/notarization workflow.

---

# 26. Homebrew is later

Homebrew can be added after npm distribution is reliable.

Do not create a second maintenance burden before core CLI packaging is stable.

---

# 27. CLI automation contract

By v1:

- documented command stability;
- machine-readable output for automation-relevant commands;
- documented exit codes;
- intentional stdout/stderr behavior;
- no non-interactive bypass of approval policy.

Illustrative exit classes:

```text
0  success
2  source/validation error
3  configuration error
4  run failure
5  blocked / approval required
6  interrupted / cancelled
7  driver/provider error
1  unexpected internal error
```

Exact numbers may change pre-v1.

---

# 28. Distribution & harness implementation stream

## D0 — CLI package readiness

- executable package boundary;
- `roflock --help`;
- `roflock --version`;
- cross-platform path/process tests;
- `npm pack` smoke test.

## D1 — Language CLI alpha

Release-capable:

```text
check
compile
validate-ir
format
```

## D2 — Runtime CLI alpha

Add:

```text
run
status
events
pause/resume/cancel
approval
evidence
```

using deterministic/fake reference execution first.

## D3 — Harness diagnostics

Add:

```text
roflock doctor
roflock drivers
```

with capability reporting.

## D4 — Real harness integrations

Minimum target:

- Codex;
- Claude Code;
- one of Pi/OpenCode or a compatible custom/API path.

## D5 — npm public alpha

- clean package install;
- npm publish;
- GitHub Release;
- quick start.

## D6 — ecosystem entry points

- MCP;
- local API documentation;
- control-surface integration guidance.

Native Studio/binaries are a separate later distribution stream.

---

# 29. Atomic ticket additions

### RF-DIST-001 — Define CLI package boundary

Identify runtime dependencies required in the published package.

### RF-DIST-002 — Stable `roflock` executable

Must work from packaged artifact.

### RF-DIST-003 — CLI help/version

Cross-platform smoke tests.

### RF-DIST-004 — `npm pack` verification

Validate included files.

### RF-DIST-005 — Clean packed-package install fixture

Run `--version`, `--help`, and `check`.

### RF-DIST-006 — `roflock doctor`

Truthful environment/harness detection.

### RF-DIST-007 — `roflock drivers`

List driver status and capabilities.

### RF-DIST-008 — Authentication status contract

Separate installed/detected/authenticated.

### RF-DIST-009 — `roflock init`

Create safe project bootstrap.

### RF-DIST-010 — Structured CLI output

Machine-readable mode for documented commands.

### RF-DIST-011 — Exit-code contract

Document and test.

### RF-DIST-012 — npm publish workflow

Dry-run/package validation before publish.

### RF-DIST-013 — npm alpha release checklist

No Cloud dependency.

### RF-HARNESS-001 — AgentDriver interoperability RFC scope

### RF-HARNESS-002 — Fake-driver conformance suite

### RF-HARNESS-003 — Codex programmatic-integration validation

### RF-HARNESS-004 — Claude Code programmatic-integration validation

### RF-HARNESS-005 — Pi integration spike

### RF-HARNESS-006 — OpenCode integration spike

### RF-HARNESS-007 — Existing-harness → Roflock invocation examples

### RF-HARNESS-008 — Roflock MCP RFC

### RF-HARNESS-009 — Initial MCP read/run tools

No implicit approval delegation.

### RF-HARNESS-010 — Control-surface integration API

### RF-HARNESS-011 — Harness portability E2E

One `.roflock`, two different execution profiles.

### RF-HARNESS-012 — Cancellation truthfulness tests

### RF-HARNESS-013 — Harness authentication reuse docs

### RF-HARNESS-014 — Playground → local-runtime handoff security design

---

# 30. First CLI alpha acceptance criteria

The first CLI alpha is ready when:

1. it installs from the packed artifact;
2. `roflock --help` and `--version` work;
3. `roflock check` compiles/validates `.roflock`;
4. `roflock compile` emits valid Graph IR;
5. deterministic/fake runtime execution works;
6. no Roflock Cloud account is required;
7. macOS/Linux/Windows CI covers core CLI;
8. installation is tested outside the monorepo;
9. quick start exists;
10. native Apple signing is not a blocker.

---

# 31. Harness interoperability acceptance criteria

Healthy interoperability means:

1. workflow semantics are vendor-independent;
2. the same workflow runs with at least two harness profiles;
3. driver capability differences are surfaced honestly;
4. Roflock invokes a harness without replacing its internal coding loop;
5. an external harness can invoke Roflock via CLI/API/MCP;
6. agents cannot approve their own protected effects;
7. cancellation state is truthful;
8. existing harness auth can be reused where supported;
9. provider-specific code remains outside Graph IR;
10. all production drivers pass a public conformance suite.

---

# 32. Product positioning

Do not market Roflock as another coding agent users need to switch to.

Preferred:

> **Roflock orchestrates the coding agents you already use.**

Supporting line:

> **Define the workflow once. Run it with Codex, Claude Code, Pi, OpenCode, or your own harness.**

Distribution funnel:

```text
Try in browser
     ↓
npm / npx
     ↓
existing coding harnesses
     ↓
optional Roflock Studio
```

This keeps adoption friction low while preserving Roflock's core differentiation: workflow, governance, deterministic verification, approvals, and proof.
