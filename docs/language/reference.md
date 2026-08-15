# Roflock language reference

This document describes the `.roflock` language implemented by Roflock 0.1.
It is a reference for shipped behavior, not a catalogue of planned Graph IR
features.

A source file is tokenized and parsed into an AST, compiled into canonical Graph
IR 1.0, validated, and only then bridged into the single governed runtime. Use
`roflock check` to validate source and `roflock compile` to inspect the exact IR.

```bash
roflock check workflow.roflock
roflock compile workflow.roflock --out workflow.json
roflock validate-ir workflow.json
roflock hash workflow.json
roflock render workflow.roflock --out workflow.mmd
```

## Complete example

```roflock
workflow VerifiedFix {
  version "1.0.0"
  description "Change code, run a deterministic check, review, and accept"
  max_cost 5
}

role implementer {
  write
  requires "coding.write"
  dispatch writer
}

role critic {
  readonly
  requires "coding.review"
  dispatch verifier
}

artifact Patch
artifact ReviewReport

agent Builder {
  role implementer
  objective "Make the smallest safe change"
  produces Patch
  retry 2
}

check Tests {
  run "npm test"
  required
  consumes Patch
}

agent Reviewer {
  role critic
  objective "Review correctness and scope"
  consumes Patch
  produces ReviewReport
  reviews
}

human Accept {
  title "Accept the verified change"
  decisions approve, reject
}

flow main {
  Builder -> Tests
  Tests.pass -> Reviewer
  Tests.fail -> Builder { max 3 }
  Reviewer -> Accept
  Reviewer.changes -> Builder { max 3 }
}
```

The two bounded return edges belong to one strongly connected component, so the
compiler emits one loop group with a maximum of three attempts. `Tests` and
`Reviewer` are both rejection gates; the compiler selects the one furthest
along the success path as the loop verifier.

## Lexical rules

- Files conventionally use the `.roflock` extension and UTF-8 text.
- Identifiers start with `A–Z`, `a–z`, or `_`, followed by letters, digits, or
  `_`. They are case-sensitive. Hyphens and dots are not identifier characters.
- Declaration and property words are contextual, not globally reserved. A node
  may therefore be named `Flow` or `Check`.
- Strings use double quotes. `\n` and `\t` decode to newline and tab; a backslash
  before another character keeps that character. Multiline string literals are
  not supported.
- Numbers are non-negative whole decimal integers.
- Whitespace is insignificant. Semicolons are neither required nor accepted.
- `#` and `//` begin a line comment.

```roflock
# hash comment
role writer { write } // slash comment
```

## File structure

A file contains declarations and one or more flow blocks in any order:

```text
source       = { declaration | flow } ;
declaration  = workflow | role | artifact | agent | check | action | human ;
```

The normal form has one `workflow` declaration, at least one executable node,
and a `flow` connecting every node. A workflow declaration is technically
optional; when omitted, the compiler derives the identity from the configured
workflow ID, first flow name, or `workflow`, and uses version `0.1.0`.

Every node must be reachable. A runnable public-alpha workflow also needs a
reachable terminal outcome; in source syntax this normally means a final human
approval node.

### Workflow

```text
workflow NAME {
  version STRING
  description STRING
  max_cost INTEGER
}
```

All properties are optional and may appear in any order.

- `version` is the author-facing workflow version. If absent, it is `0.1.0`.
- `description` is descriptive metadata and participates in semantic identity.
- `max_cost` is a whole-unit actual-cost ceiling. Crossing it pauses the run for
  operator attention instead of discarding completed work.

The language does not assign currency meaning by itself. Execution profiles and
usage adapters must use one consistent cost unit.

### Roles

```text
role NAME {
  readonly | write
  requires STRING
  authority PROFILE
  dispatch SLOT
}
```

- `readonly` or `write` sets workspace access. A writing role automatically
  gives its agents a `workspace_write` effect at medium risk.
- `requires` may repeat. It records required capabilities independently of a
  provider or model.
- `authority` opts the role into a deterministic Role Protocol authority
  profile. It is never inferred from the role name.
- `dispatch` explicitly maps the role to the coding runtime slot `planner`,
  `reviewer`, `writer`, `test`, `verifier`, or `accept`. Without it, the current
  bridge infers agent dispatch from access mode and graph position.

The compatibility runtime currently enforces these authority profiles:
`contract_planner`, `contract_authority`, `planner`, `plan_critic`,
`plan_approver`, `executor`, `test_runner`, `verifier`, and
`release_approver`. Any other explicit profile is preserved by Graph IR but
fails runtime bridging; it never degrades silently into an ungated role.

Role IDs are otherwise arbitrary stable identifiers. Provider/model choice is
not language syntax: it belongs to an execution profile outside semantic
workflow identity.

### Artifacts

```text
artifact NAME
```

An artifact declaration creates a named Graph IR artifact type. In language
0.1 it has no inline schema, media type, confidentiality, or retention syntax.
Agents and checks connect required single-value ports with `consumes` and
`produces`:

```roflock
artifact Patch

agent Builder {
  role writer
  produces Patch
}

check Tests {
  run "npm test"
  consumes Patch
}
```

A required input must have a declared producer that can run before the
consumer. The validator rejects missing, mistyped, or unreachable producers.

## Node declarations

### Agent

```text
agent NAME {
  role ROLE
  objective STRING
  consumes ARTIFACT
  produces ARTIFACT
  effect EFFECT [risk RISK]
  reviews
  retry INTEGER
}
```

`role` is mandatory because authority and workspace access come from the role.
`objective` defaults to `Run NAME`. `consumes`, `produces`, and `effect` may
repeat.

`reviews` adds the `changes` outcome, allowing a reviewer to return work. It
does not grant approval authority.

`retry N` bounds retries of that node's own failure, such as a provider error.
It is distinct from a loop's `{ max N }`, which bounds re-entry of an entire
cycle. Both values must be positive to be executable.

### Check

```text
check NAME {
  run STRING
  required
  consumes ARTIFACT
  produces ARTIFACT
  retry INTEGER
}
```

`run` is mandatory. The public-alpha bridge executes command checks directly,
without a shell. `required` means every accepted path must pass through this
check; a bypass is a compile error. Artifact properties may repeat.

The command is stored as written, then split by the command runner into an exact
binary and argument vector. Shell operators, expansions, and redirections do
not acquire shell semantics.

### Action

```text
action NAME {
  run STRING
  effect EFFECT [risk RISK]
}
```

An action is deterministic non-agent work. For public-alpha execution, `run` is
required and only a command action without declared effects can cross the
compatibility bridge. Effect-bearing actions compile to valid Graph IR where
their approval path can be analysed, but runtime bridging rejects them until
their exact approval semantics are supported. This is fail-closed behavior.

### Human

```text
human NAME {
  title STRING
  decisions IDENTIFIER, IDENTIFIER
}
```

The defaults are the node name as title and `approve, reject` as decisions. A
human node in the middle of a flow is a non-terminal gate; a human node with no
outgoing approval edge is the accepted terminal.

Language 0.1 can represent custom decision labels in Graph IR, but the
public-alpha runtime deliberately executes only a plain `approve, reject`
approval gate. Custom decisions fail bridging instead of being approximated.
Approval remains external: an agent, MCP caller, or process that starts a run
does not gain the right to approve it.

## Effects and risk

The complete language 0.1 effect vocabulary is:

```text
workspace_write          dependency_change       network_access
database_write           external_side_effect    secret_access
git_push                 merge                   deploy
production_access        payment_mutation        public_publish
destructive
```

Risk is `low`, `medium`, `high`, or `critical`; omitted risk defaults to
`medium`.

The default protected effects are `git_push`, `merge`, `deploy`,
`production_access`, `payment_mutation`, `public_publish`, and `destructive`.
The validator requires a human node on every path reaching one of them.
Declaring an effect describes required authority; it does not itself grant that
authority.

## Flows and outcomes

```text
flow [NAME] {
  FROM [ . OUTCOME ] -> TO [ { max INTEGER } ]
}
```

Flow names are optional metadata. Multiple flow blocks are combined in source
order. Edge priority follows transition order.

An unqualified transition selects the node kind's primary success outcome:

| Node kind | `A -> B` means          |
| --------- | ----------------------- |
| agent     | `A.completed -> B`      |
| check     | `A.pass -> B`           |
| action    | `A.completed -> B`      |
| human     | `A.human_approved -> B` |

The outcomes authors may route are:

| Declaration          | Outcomes                                                  |
| -------------------- | --------------------------------------------------------- |
| agent                | `completed`, `blocked`, `timeout`, `provider_unavailable` |
| agent with `reviews` | the agent outcomes plus `changes`                         |
| check                | `pass`, `fail`, `timeout`                                 |
| action               | `completed`, `fail`, `timeout`                            |
| human                | `human_approved`, `human_rejected`                        |

An edge from any other outcome is rejected. Outcomes are typed control-plane
facts; model prose cannot invent a transition.

### Parallelism

Nodes with no dependency path between them may run concurrently. A workflow
defaults to one writer per worktree, and validation rejects two writing nodes
that could overlap. Read-only branches can run in parallel.

### Bounded loops

A cycle is legal only when a transition closing that cycle declares a positive
`max`:

```roflock
flow {
  Builder -> Tests
  Tests.fail -> Builder { max 3 }
}
```

The compiler finds the complete strongly connected component and emits one
loop group for it. `max 3` means at most three attempts, not three retries after
the first attempt. Multiple bounded rejection routes inside one component share
one budget; the largest declared value governs. Every generated loop requires
new evidence and fails when exhausted.

A `max` on an edge that does not close a cycle is an error. A cycle with no
bounded edge is also an error. A loop without `max_cost` can compile with an
`RF601` warning, but operators should set a cost ceiling for billable agent
work.

## Diagnostics

Diagnostics contain a stable code, severity, message, and source span when one
is available. A parse error produces no partial AST; a compile or validation
error produces no executable IR. Warnings do not block execution.

| Range   | Meaning                           |
| ------- | --------------------------------- |
| `RF1xx` | names, references, outcomes       |
| `RF2xx` | reachability, terminals, loops    |
| `RF3xx` | concurrency and writer safety     |
| `RF4xx` | roles, independence, capabilities |
| `RF5xx` | effects, approvals, permissions   |
| `RF6xx` | budgets, quotas, limits           |
| `RF7xx` | artifacts, evidence, acceptance   |
| `RF8xx` | extensions and compatibility      |

Current codes are:

| Code    | Contract                                         |
| ------- | ------------------------------------------------ |
| `RF101` | unknown/unsupported node reference               |
| `RF102` | unknown/unsupported role or authority profile    |
| `RF103` | duplicate declaration                            |
| `RF104` | execution profile binds an unknown role          |
| `RF110` | malformed source: tokenizer or parser error      |
| `RF121` | unknown outcome                                  |
| `RF201` | unreachable node                                 |
| `RF202` | missing reachable terminal                       |
| `RF203` | no entry node                                    |
| `RF210` | unbounded or invalid cycle                       |
| `RF211` | loop verifier cannot re-evaluate the cycle       |
| `RF212` | retry can occur without new evidence             |
| `RF301` | concurrent writers                               |
| `RF401` | reviewer independence weakened                   |
| `RF410` | missing required capability                      |
| `RF501` | protected effect has no guaranteed approval path |
| `RF502` | undeclared network access                        |
| `RF503` | undeclared secret access                         |
| `RF601` | missing cost boundary                            |
| `RF701` | missing artifact producer                        |
| `RF702` | artifact type mismatch                           |
| `RF710` | blocking criterion has no verifier               |
| `RF711` | required check can be bypassed                   |
| `RF801` | unsupported required extension                   |
| `RF802` | unsupported Graph IR version                     |

Example diagnostic:

```text
workflow.roflock:18:9: error RF121: 'Builder' cannot report outcome 'pass'. It declares: completed, blocked, timeout, provider_unavailable
```

## Versioning and identity

Three versions serve different purposes:

- language version `0.1` identifies the implemented source grammar;
- Graph IR version `1.0` identifies the canonical semantic schema; and
- `workflow { version "…" }` is the author's version for that workflow.

Compilation stamps two hashes:

- `sourceHash` is an FNV-1a hash of exact source bytes and changes with comments
  or formatting; and
- `semanticHash` is a SHA-256 identity of normalized meaning and remains stable
  across whitespace-only changes.

When a task is created, Roflock stores the exact source, canonical IR,
executable graph, semantic hash, and executable-graph integrity hash in one
transaction. Later edits to the file or template registry cannot alter that
task's meaning.

Changing workflow semantics should change the author-facing workflow version,
but runtime identity never trusts the label alone: the semantic and integrity
hashes remain authoritative.

## Implemented source surface versus Graph IR

Graph IR 1.0 deliberately supports more than language 0.1. The following are
not currently authorable in `.roflock`: goals and acceptance-criterion objects,
artifact schemas/confidentiality/retention, role-independence clauses,
model-call/context/join/route/evidence/event nodes, structured model output,
timeouts, execution-profile bindings, approval policy declarations, and custom
extensions.

Hand-authored IR using those features may validate as Graph IR but still fail
the public-alpha runtime bridge if the single runtime cannot execute it
faithfully. Roflock never silently drops or approximates unsupported semantics.

## See also

- [Architecture](../architecture.md)
- [Graph IR v1](../rfc/RFC-001-ROFLOCK-GRAPH-IR-V1.md)
- [CLI exit codes](../cli/exit-codes.md)
- [Playground security boundary](../security/playground-local-runtime.md)
- shipped examples in `examples/*.roflock`
- built-in workflow sources in `workflows/*.roflock`
