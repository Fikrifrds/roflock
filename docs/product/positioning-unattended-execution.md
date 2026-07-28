# Positioning: unattended execution over interactive iteration

Status: accepted as a foundation by ADR-013 and refined by ADR-014.

ADR-014 preserves the conclusion that RoleFlock must not compete with the interactive
agent loop. It advances the primary position from unattended parallel execution to
independent delivery assurance. Parallel execution remains required product parity.

## The question this answers

Designing "what happens after a workflow is accepted" surfaced a prior question that
has to be settled first: **why would anyone use RoleFlock instead of opening Claude
Code, typing an instruction, and replying with feedback?** RoleFlock is slower and
has more steps. Any feedback design that cannot answer this is decorating the wrong
shape.

## Finding: the interactive loop is lost ground

RoleFlock wraps the same CLI agents it competes with (Codex, Cursor Agent, Claude).
The intelligence is identical, so the value cannot come from output quality. It has
to come from the wrapper — and the wrapper is a net cost in the interactive case.

A "request changes" loop bolted onto the `accept` node loses to chat on both axes
that matter when a human is sitting there:

- **Context loss per round.** A chat follow-up ("not that one, the sidebar") lands in
  a conversation that still holds every prior turn. In RoleFlock the writer receives
  a *compiled* context (`packages/context-compiler`) in a fresh invocation; the
  conversational history is not carried. One-line feedback to an agent that has
  forgotten the last twenty minutes produces a worse revision than chat does.
- **Wrong latency order.** Chat answers in seconds. A RoleFlock round is a new CLI
  invocation, a context recompile, `writer → test → verifier`, and a human gate —
  minutes. For "the colour is wrong" the ratio is absurd.

This is not an implementation gap to be closed. It is structural. RoleFlock should
not try to win here.

## The premise to hold

> Work you delegate without watching, that arrives with proof — so it can be trusted
> without being re-read.

Litmus test for any future feature: if the answer to "why not just use Claude Code"
is not *"because I was not there"* or *"because someone else has to be able to trust
this"*, the feature is probably pointed the wrong way.

## Differentiator audit

Honest sorting of what exists in the repo today.

| Capability | Verdict |
|---|---|
| Enforced verification, fails closed (`test` node, `NodeFailure`) | **Replicable.** A `Stop`/`PostToolUse` hook in `settings.json` can force a test run and fail hard. This is hygiene, not a differentiator. |
| Evidence, audit trail, disclosure manifest, approval grants with expiry and use limits | **Real, but only with a second party.** Claude Code produces a transcript; RoleFlock produces a record. The difference is worth nothing to a solo developer on a private project, and a great deal to a reviewer, client, or auditor who must trust the change without redoing the work. |
| Multi-provider routing with quota failover | **Real and immediate.** But it is a feature, not a product category. |
| Running many tasks unattended and in parallel | **Required parity, currently dormant.** It creates throughput but is also native to leading coding-agent products. |
| Contract-bound intent, independent verification, policy authority, and portable commit-bound acceptance evidence | **Primary product boundary.** The coding agent is the worker; RoleFlock is the independent authority. |

## The architectural contradiction

`orchestrator.ts:446` hardcodes `mode: 'in_place'`. `prepareTaskWorkspace`
(`packages/repository-runtime/src/index.ts:227`) then checks out
`roleflock/<taskId>` **inside the project folder** — one branch at a time — and the
writer lease permits one writer per worktree. `mode: 'external'` exists and works;
it survives only as a recovery path for older runs (`orchestrator.ts:430-437`).

So RoleFlock is architecturally a **single-threaded, human-supervised** tool today:
precisely the shape where Claude Code wins outright and where RoleFlock's governance
reads as friction. This is the most expensive product decision currently encoded in
the repo.

Restoring external worktrees makes the unanswerable sentence available: five tasks
running in five worktrees while you are away, returning five branches that each
passed real verification, each with its own evidence. "Another way to give feedback"
is answerable in one sentence. That is not.

## Consequences for the feedback design

The post-acceptance design (see the accept-loop and follow-up-task proposal) is not
cancelled, but its framing inverts.

1. **Provide an escape hatch; do not fight the chat loop.** The workspace is a real
   git branch in a real folder. Offer an action that says so plainly: open this
   folder in your editor or Claude Code, iterate at full speed, then come back for
   verification, evidence, and the commit. **RoleFlock owns the boundaries, not the
   keystrokes.** This makes the product cooperative with the tools users already
   have rather than a losing substitute.
2. **Position "request changes" as an asynchronous revision queue, not a chat.** You
   review a batch of finished tasks in the evening, write the corrections, close the
   laptop, and find verified results in the morning. Chat is bad at exactly this,
   because chat requires you to be present. Framed this way the loop is worth
   building, and the lost conversational context is acceptable — the feedback is
   written as a specification rather than as an aside.
3. **Parallelism outranks the feedback loop, but assurance outranks parallelism.**
   Re-enable external worktrees so N
   tasks can run at once. Without that, every refinement to the feedback flow is
   improving the wrong shape. Parallelism supplies throughput; Change Contracts,
   independent verification, and Change Passports supply the differentiated trust layer.

## What this rules out

- Any attempt to make the accept loop feel conversational or "fast enough" to iterate
  in. It will not be, and chasing it costs the positioning.
- Judging the product against a solo developer iterating interactively on their own
  project. That user is better served by Claude Code, and no feedback design fixes
  it. If that is the intended market, the premise above is wrong and this document
  should be rejected rather than worked around.

## Buyer decision

The initial buyer is an AI-native agency or multi-repository engineering team whose
senior-review capacity is becoming the bottleneck. Client-facing, platform, security, and
regulated teams are expansion markets. Solo interactive development remains an adoption
path, not the paid product core.
