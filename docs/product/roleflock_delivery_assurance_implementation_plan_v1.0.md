# RoleFlock — Delivery Assurance Implementation Plan

**Version:** 1.0

**Date:** 28 July 2026

**Status:** In execution

**Execution progress:** M0 through M4.4 complete; M4.5 is next

**Supersedes for product direction:** orchestration-first portions of `roleflock_implementation_plan_v1.0.md`

**Preserves:** existing safety, recovery, provider, approval, usage, and local-first invariants

**Product category:** independent delivery assurance for AI-generated software

---

## 1. Outcome

RoleFlock will become the independent authority between coding agents and software delivery.

Coding agents remain responsible for proposing and implementing changes. RoleFlock becomes
responsible for:

1. recording what outcome was authorised;
2. constraining what each role may decide and do;
3. ensuring executors implement an approved plan without silently changing it;
4. routing ambiguity and feedback to the role that owns the decision;
5. independently verifying the resulting commit;
6. applying deterministic policy before acceptance or merge;
7. producing a portable, verifiable Change Passport;
8. learning which provider/model performs each role well from verified outcomes.

The product promise is:

> Use any coding agent. RoleFlock turns its work into a contract-bound,
> independently verified, policy-approved change that is safe to review and ship.

Short positioning:

> Your agents write. RoleFlock decides what is allowed to ship.

RoleFlock does not attempt to replace Codex, Claude Code, Cursor, OpenCode, Qwen Code,
Kimi Code, or future coding agents. It coordinates with them and owns the acceptance
boundary they cannot independently grant to themselves.

---

## 2. Product principles

### 2.1 The model is a proposer, not the authority

A model may propose a plan, edit, test, explanation, or permission request. Deterministic
RoleFlock code and authorised humans decide whether the proposal is allowed.

### 2.2 Every write follows a pinned plan

No writer invocation may begin without an immutable `ExecutionPlan` version. This includes
small tasks. A low-risk task may use a short automatically approved micro-plan, but the
planning and writing turns remain distinct authority scopes.

### 2.3 Roles own decisions, not merely prompts

Each role has:

- inputs it is allowed to trust;
- outputs it must produce;
- decisions it owns;
- actions it may perform;
- actions it must never perform;
- escalation targets;
- completion criteria.

Enforcement is implemented through schemas, graph transitions, permissions, and artifact
validation. Prompt wording is supporting defence, not the enforcement boundary.

### 2.4 Feedback returns to the decision owner

The executor never interprets raw stakeholder feedback and never changes the plan.

```text
Human feedback
→ Planner
→ revised Change Contract or Execution Plan
→ optional plan review/approval
→ Executor
```

Verifier findings also return to the planner. The verifier states which criterion failed
and provides evidence; it does not become a hidden planner by prescribing an unapproved
implementation.

### 2.5 Verification is independent from implementation

Writer-produced statements such as "tests passed" are execution claims, not trusted
verification. Required verification runs in a clean verifier workspace using a frozen
verification specification and no writer credentials.

### 2.6 Evidence binds intent to a commit

Evidence is useful only when it binds together:

- the authorised contract;
- the approved plan;
- the repository base commit;
- the resulting commit;
- the execution environment;
- verification results;
- policy decisions;
- human decisions.

### 2.7 Use the smallest sufficient flock

RoleFlock recommends the least complex role roster that satisfies the task's risk and
assurance requirements. More roles and models are not inherently better.

### 2.8 Recommendations are explainable and overridable

Role suggestions are produced by deterministic constraints and scored evidence. The UI
must explain why each provider/model is recommended, the confidence of the recommendation,
the fallback order, and any independence trade-off.

### 2.9 Existing tools remain first-class

Users may perform interactive refinement in their preferred coding agent or IDE. RoleFlock
must support handoff and re-entry without pretending its asynchronous workflow is a chat.

---

## 3. Target users and jobs

### 3.1 Initial ideal customer

AI-native agencies and multi-repository engineering teams with:

- 5–50 engineers;
- multiple client or product repositories;
- two or more AI coding tools in active use;
- limited senior-review capacity;
- a need to explain or prove delivery quality to another party.

Primary buyer:

- agency founder;
- CTO;
- head of engineering;
- platform lead.

Primary user:

- tech lead;
- senior reviewer;
- engineering operator coordinating multiple tasks.

Primary job:

> Deliver more accepted changes with the same reviewer capacity, without losing
> control over requirements, risk, or client trust.

### 3.2 Expansion markets

After the initial product is proven:

1. platform engineering teams governing many coding agents;
2. security teams enforcing organisation-wide AI policies;
3. regulated software teams;
4. enterprise internal developer platforms;
5. client-facing approval and assurance workflows.

### 3.3 Non-target for the paid core

A solo developer performing one interactive change at a time is better served directly by
their coding agent. A free local RoleFlock edition may serve this user as an adoption path,
but the paid product must solve multi-party trust or multi-task delivery.

---

## 4. Core domain model

### 4.1 Change Contract

The `ChangeContract` is the authoritative description of the requested outcome.

```typescript
interface ChangeContract {
  id: string;
  taskId: string;
  version: number;
  status: 'draft' | 'authorised' | 'superseded' | 'withdrawn';

  objective: string;
  acceptanceCriteria: AcceptanceCriterion[];
  prohibitedOutcomes: ProhibitedOutcome[];
  outOfScope: string[];
  requiredEvidence: EvidenceRequirement[];
  riskClass: 'low' | 'medium' | 'high' | 'critical';

  authoritySources: AuthoritySourceRef[];
  unresolvedQuestions: ClarificationQuestion[];
  parentVersionId?: string;
  changeReason?: string;

  createdBy: ActorRef;
  authorisedBy?: ActorRef;
  createdAt: string;
  authorisedAt?: string;
  hash: string;
}
```

Rules:

- an authorised version is immutable;
- revision creates a new version linked to the prior version;
- only an authorised contract may produce an executable plan;
- blocking conflicts prevent authorisation;
- acceptance criteria have stable IDs across revisions where semantics remain the same;
- contract hash is included in every downstream artifact.

### 4.2 Execution Plan

The `ExecutionPlan` is the planner-owned instruction set the executor must follow.

```typescript
interface ExecutionPlan {
  id: string;
  taskId: string;
  contractId: string;
  contractHash: string;
  version: number;
  status: 'proposed' | 'approved' | 'superseded' | 'cancelled';

  summary: string;
  assumptions: PlanAssumption[];
  steps: PlanStep[];
  allowedPaths: string[];
  expectedChangedPaths: string[];
  forbiddenPaths: string[];
  dependencyChanges: PlannedDependencyChange[];
  migrationActions: PlannedMigrationAction[];
  verificationSpecId: string;
  repairEnvelope: RepairEnvelope;
  changeBudget: ChangeBudget;
  decisionLog: PlanDecision[];

  parentPlanId?: string;
  revisionReason?: string;
  proposedBy: InvocationRef;
  reviewedBy?: InvocationRef | ActorRef;
  approvedAt?: string;
  hash: string;
}
```

Every `PlanStep` must map to one or more acceptance criteria:

```typescript
interface PlanStep {
  id: string;
  objective: string;
  criterionIds: string[];
  allowedOperations: PlannedOperation[];
  expectedFiles: string[];
  completionEvidence: EvidenceRequirement[];
}
```

Executor constraints:

- receives only an approved plan version;
- may edit only allowed paths;
- may perform only allowed operation classes;
- must report the plan step for each material action;
- may not introduce a new dependency unless explicitly planned;
- may not change architecture, schema, public API, authentication, authorisation, or
  product behaviour unless explicitly planned;
- must stop on ambiguity instead of choosing creatively;
- must never alter the contract or plan artifact.

### 4.3 Verification Specification

The verification specification is frozen before the executor begins.

```typescript
interface VerificationSpecification {
  id: string;
  taskId: string;
  contractHash: string;
  planHash: string;
  version: number;
  checks: VerificationCheck[];
  environment: VerificationEnvironment;
  testMutationPolicy: 'forbid' | 'review' | 'allow_planned';
  minimumEvidence: EvidenceRequirement[];
  authoredBy: InvocationRef | ActorRef;
  approvedAt: string;
  hash: string;
}
```

Verification checks may include:

- exact command argv;
- test selector;
- schema assertion;
- browser assertion;
- database assertion;
- static analysis;
- security scan;
- diff policy;
- manual review criterion.

The executor cannot weaken or remove a required verification check.

### 4.4 Execution Report

The executor emits a structured report:

```typescript
interface ExecutionReport {
  taskId: string;
  planId: string;
  planHash: string;
  baseCommit: string;
  resultCommit?: string;
  completedStepIds: string[];
  changedPaths: string[];
  commandsRun: CommandRecordRef[];
  claimedEvidence: EvidenceRef[];
  deviations: PlanDeviation[];
  unresolvedIssues: string[];
  createdBy: InvocationRef;
}
```

An empty deviations list is a claim checked independently by RoleFlock.

### 4.5 Plan Deviation

```typescript
interface PlanDeviation {
  id: string;
  planId: string;
  detectedBy: 'executor' | 'runtime' | 'verifier' | 'human';
  type:
    | 'unexpected_file'
    | 'unplanned_dependency'
    | 'architecture_decision'
    | 'requirement_ambiguity'
    | 'verification_gap'
    | 'scope_expansion'
    | 'policy_conflict'
    | 'environment_mismatch';
  evidence: EvidenceRef[];
  proposedOptions: string[];
  status: 'open' | 'resolved_by_plan_revision' | 'rejected' | 'waived';
}
```

Open deviations block acceptance.

### 4.6 Change Passport

The Change Passport is the portable delivery artifact.

```typescript
interface ChangePassport {
  schemaVersion: string;
  passportId: string;
  taskId: string;

  subject: {
    repositoryId: string;
    baseCommit: string;
    resultCommit: string;
    diffDigest: string;
  };

  contract: ArtifactDigestRef;
  plan: ArtifactDigestRef;
  verificationSpecification: ArtifactDigestRef;
  execution: ExecutionAttestation[];
  verification: VerificationAttestation[];
  policies: PolicyDecisionAttestation[];
  approvals: ApprovalAttestation[];
  disclosures: DisclosureManifestRef[];
  unresolvedRisks: RiskRecord[];

  verdict: 'pass' | 'fail' | 'conditional' | 'revoked';
  issuer: RunnerIdentity;
  issuedAt: string;
  signature: SignatureEnvelope;
}
```

The wire format should adapt in-toto attestations and established provenance conventions
where practical. A standalone CLI must be able to validate it without trusting the UI:

```text
roleflock passport verify <file-or-commit>
```

---

## 5. Role authority protocol

### 5.1 Planner

Purpose:

- interpret the authorised Change Contract;
- investigate repository state read-only;
- make implementation decisions;
- publish and revise the Execution Plan;
- resolve executor questions and verifier findings;
- escalate business or authority conflicts to a human.

Allowed:

- read repository and authoritative documents;
- run explicitly safe read-only inspection commands if policy permits;
- propose paths, operations, tests, and decisions;
- revise the plan through a new immutable version.

Forbidden:

- modifying source files;
- executing the implementation;
- marking its own plan as verified;
- silently deciding between conflicting authoritative requirements;
- weakening acceptance criteria without contract-authority approval.

Required output:

- schema-valid `ExecutionPlan`;
- mapping from every step to acceptance criteria;
- declared assumptions and risks;
- verification specification or a request for a test designer.

### 5.2 Plan Critic

The current `reviewer` role should be split semantically:

- `plan_critic`: model-based independent critique;
- `plan_approver`: human or deterministic policy gate.

Purpose:

- find omissions, contradictions, excessive scope, unsafe assumptions, and weak verification;
- challenge the plan without rewriting it.

Allowed:

- issue structured findings;
- recommend rejection or revision.

Forbidden:

- editing the plan;
- instructing the executor directly;
- approving high-risk exceptions unless the actor has explicit approval authority.

Routing:

```text
Plan Critic finding
→ Planner
→ revised Execution Plan
→ Plan Critic or Plan Approver
```

### 5.3 Executor

Purpose:

- implement the exact approved plan inside the leased workspace;
- produce an execution report.

Allowed:

- edit approved paths;
- run commands allowed by the plan and permission envelope;
- perform plan steps in the declared order or permitted dependency order;
- make purely mechanical corrections inside the repair envelope.

Forbidden:

- interpreting raw human feedback;
- revising the plan;
- expanding scope;
- making a new architecture or product decision;
- adding dependencies, migrations, network calls, or external side effects not in the plan;
- changing required tests to create a passing result;
- declaring final acceptance.

Ambiguity routing:

```text
Executor detects ambiguity/deviation
→ emit PlanClarificationRequest or PlanDeviation
→ stop writer lease safely
→ Planner decides
→ new plan version
→ optional re-approval
→ Executor resumes against the new pinned version
```

### 5.4 Deterministic Test Runner

Purpose:

- execute exact approved commands;
- record exit status, environment, logs, and artifact digests.

It is not an LLM role. It cannot interpret a failure or alter files.

### 5.5 Verifier

Purpose:

- assess the result against the Change Contract and Verification Specification;
- inspect independent test evidence;
- identify unsupported claims and deviations.

Allowed:

- read the clean verifier workspace;
- execute approved verification tools through the deterministic runner;
- emit criterion-scoped findings;
- recommend pass, fail, or conditional.

Forbidden:

- writing source;
- repairing the change;
- revising the plan;
- sending patch instructions directly to the executor;
- treating executor claims as independent evidence.

Routing:

```text
Verifier failure
→ Planner
→ planner classifies:
   a. implementation did not follow plan
   b. plan was incomplete
   c. contract is ambiguous or must change
→ revised plan or human clarification
→ Executor
→ independent verification
```

Exception:

A deterministic test failure may route directly to the executor only when:

- the failure type is included in the approved repair envelope;
- no new file, dependency, architecture decision, or scope change is required;
- the same plan remains sufficient;
- the retry budget is not exhausted.

Otherwise it routes to the planner.

### 5.6 Release Approver

Purpose:

- make the final human or organisation-policy decision;
- accept, reject, conditionally accept, or request contract revision.

The approver receives the review packet and Change Passport, not raw model reasoning by
default.

### 5.7 Optional specialist roles

Only add these when task risk or domain requires them:

- `test_designer`;
- `security_reviewer`;
- `migration_reviewer`;
- `performance_reviewer`;
- `accessibility_reviewer`;
- `privacy_reviewer`;
- `release_manager`.

Each specialist produces findings or a specification. Specialists do not bypass the
planner or directly direct the executor.

### 5.8 Required role handoffs

| Producer              | Required input                                        | Required output                                         | Consumer                    | Invalid shortcut                                |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------- | --------------------------- | ----------------------------------------------- |
| Contract Planner      | Brief and authority sources                           | Draft `ChangeContract`                                  | Contract Authority          | Contract Planner self-authorises requirements   |
| Contract Authority    | Draft contract and conflicts                          | Authorised contract hash                                | Planner                     | Executor receives an unauthorised brief         |
| Planner               | Authorised contract and read-only repository evidence | Proposed `ExecutionPlan` and verification specification | Plan Critic/Approver        | Planner edits source                            |
| Plan Critic           | Proposed plan                                         | Criterion-scoped critique                               | Planner                     | Critic rewrites plan or instructs executor      |
| Plan Approver         | Plan, critique, policy                                | Approved plan hash                                      | Executor                    | Executor starts from a proposed plan            |
| Executor              | Approved pinned plan                                  | Result commit and `ExecutionReport`                     | Test Runner/Verifier        | Executor consumes raw stakeholder feedback      |
| Test Runner           | Frozen verification specification and result commit   | Deterministic attestations                              | Verifier                    | Runner edits files or selects easier tests      |
| Verifier              | Contract, plan, result, independent attestations      | Criterion verdicts/findings                             | Planner or Release Approver | Verifier repairs code or directs executor       |
| Planner after failure | Findings and current artifacts                        | Revised plan or escalation                              | Approver/Executor           | Finding is appended directly to executor prompt |
| Release Approver      | Review packet and valid passport candidate            | Accept/reject/revision decision                         | Passport issuer or Planner  | Approver accepts missing required evidence      |

An artifact is the handoff boundary. Conversation text may explain an artifact, but it
cannot replace the required schema-valid, hashed artifact.

---

## 6. Feedback and revision state machine

### 6.1 States

```text
DRAFT_CONTRACT
CONTRACT_NEEDS_CLARIFICATION
CONTRACT_AWAITING_AUTHORISATION
CONTRACT_AUTHORISED
PLAN_PROPOSED
PLAN_NEEDS_REVISION
PLAN_AWAITING_APPROVAL
PLAN_APPROVED
EXECUTING
EXECUTION_BLOCKED_ON_PLAN
VERIFYING
VERIFICATION_FAILED
READY_FOR_ACCEPTANCE
ACCEPTED
REJECTED
WITHDRAWN
```

### 6.2 Authoritative transitions

```text
DRAFT_CONTRACT
→ Contract Planner/contract compiler
→ CONTRACT_AWAITING_AUTHORISATION
→ authorised human/policy
→ CONTRACT_AUTHORISED

CONTRACT_AUTHORISED
→ Planner
→ PLAN_PROPOSED

PLAN_PROPOSED
→ Plan Critic
→ PLAN_NEEDS_REVISION or PLAN_AWAITING_APPROVAL

PLAN_AWAITING_APPROVAL
→ authorised human/policy
→ PLAN_APPROVED

PLAN_APPROVED
→ Executor
→ EXECUTING

EXECUTING
→ deviation/ambiguity
→ EXECUTION_BLOCKED_ON_PLAN
→ Planner
→ PLAN_PROPOSED

EXECUTING
→ completed execution report
→ VERIFYING

VERIFYING
→ failed criterion
→ VERIFICATION_FAILED
→ Planner
→ PLAN_PROPOSED

VERIFYING
→ all required criteria satisfied
→ READY_FOR_ACCEPTANCE

READY_FOR_ACCEPTANCE
→ human feedback
→ Planner
→ contract revision or plan revision

READY_FOR_ACCEPTANCE
→ approval
→ ACCEPTED
```

### 6.3 Feedback classes

Every feedback item is classified before routing:

| Feedback class                | Owner                                                                       | Required result                         |
| ----------------------------- | --------------------------------------------------------------------------- | --------------------------------------- |
| Requirement change            | Contract authority + planner                                                | New contract and plan version           |
| Implementation preference     | Planner                                                                     | Plan revision or explicit rejection     |
| Mechanical defect within plan | Executor, if repair envelope permits                                        | New execution attempt                   |
| Plan incompleteness           | Planner                                                                     | New plan version                        |
| Verification gap              | Planner/test designer                                                       | New verification spec and possibly plan |
| Policy exception              | Authorised human/policy owner                                               | Typed approval or rejection             |
| Cosmetic interactive tweak    | Preferred IDE/agent handoff, then planner re-entry if assurance is required | Updated plan/passport                   |

No raw feedback is appended directly to an executor prompt.

---

## 7. Role Suggestion Engine

### 7.1 User outcome

On task creation and on the Roles page, RoleFlock recommends:

- which roles are necessary;
- which installed provider/model should fill each role;
- effort level;
- fallback order;
- whether independent provider/model families are required;
- expected cost/latency trade-off;
- recommendation confidence and evidence.

The user may accept all recommendations, adjust one role, or keep a saved organisation
profile.

### 7.2 Inputs

Task signals:

- task type;
- risk class;
- repository size and language mix;
- estimated changed components;
- security/auth/database/migration indicators;
- test availability and test maturity;
- requirement ambiguity;
- expected context size;
- need for browser, image, shell, patch, or network tools;
- client or compliance policy;
- time and cost budget.

Provider/model signals:

- installed and authenticated status;
- tool, write, patch, headless, and structured-output capabilities;
- supported effort levels;
- context capacity when known;
- subscription/quota availability;
- privacy and data-residency constraints;
- user-supplied preferences;
- observed performance history;
- current cooldown/health.

### 7.3 Model capability profile

```typescript
interface ModelCapabilityProfile {
  providerId: string;
  modelId: string;
  profileVersion: string;

  traits: {
    planningDepth?: ScoredTrait;
    instructionAdherence?: ScoredTrait;
    repositoryNavigation?: ScoredTrait;
    patchPrecision?: ScoredTrait;
    toolReliability?: ScoredTrait;
    implementationStrength?: ScoredTrait;
    testReasoning?: ScoredTrait;
    criticalReview?: ScoredTrait;
    securityReasoning?: ScoredTrait;
    longContext?: ScoredTrait;
    speed?: ScoredTrait;
    costEfficiency?: ScoredTrait;
  };

  capabilities: {
    writes: boolean;
    patches: boolean;
    tools: boolean;
    headless: boolean;
    structuredOutput: boolean;
    imageInput?: boolean;
    browser?: boolean;
  };

  sources: CapabilityEvidenceSource[];
  updatedAt: string;
}

interface ScoredTrait {
  score: number; // 0..1
  confidence: number; // 0..1
  source: 'curated' | 'observed' | 'user_asserted' | 'provider_reported';
  sampleSize?: number;
}
```

Rules:

- unknown stays unknown; it is not converted to an invented average;
- curated profiles are versioned and visibly labelled;
- observed organisation outcomes outrank generic curated scores once sample size and
  confidence thresholds are reached;
- provider marketing claims never count as verified outcome evidence;
- user overrides remain explicit and auditable.

### 7.4 Role requirements

Planner prioritises:

- planning depth;
- instruction adherence;
- repository navigation;
- long-context handling;
- structured output.

Executor prioritises:

- implementation strength;
- instruction adherence;
- patch precision;
- tool reliability;
- write/sandbox compatibility.

Plan Critic prioritises:

- critical review;
- contradiction detection;
- test reasoning;
- independence from the planner for elevated risk.

Verifier prioritises:

- test reasoning;
- critical review;
- evidence discipline;
- instruction adherence;
- independence from the executor.

Specialist roles add domain-specific requirements.

### 7.5 Hard constraints before scoring

A candidate is excluded when:

- the provider is unavailable or unauthenticated;
- required write/patch/tool capability is absent;
- policy forbids the provider for the repository or sensitivity;
- the model is cooling down;
- the provider cannot enforce the role's permission envelope;
- the candidate violates required independence;
- known context limits cannot hold the role's required context;
- the candidate cannot produce the required structured artifact.

### 7.6 Independence policy

```typescript
type IndependenceLevel =
  | 'separate_invocation'
  | 'different_model'
  | 'different_model_family'
  | 'different_provider'
  | 'different_runner';
```

Defaults:

| Risk     | Planner vs executor       | Executor vs verifier                     | Planner vs critic               |
| -------- | ------------------------- | ---------------------------------------- | ------------------------------- |
| Low      | Separate invocation       | Separate invocation                      | Critic optional                 |
| Medium   | Separate invocation       | Different model preferred                | Different model preferred       |
| High     | Different model preferred | Different model family required          | Different model family required |
| Critical | Different model family    | Different provider plus different runner | Different provider preferred    |

Policy may strengthen these defaults.

### 7.7 Deterministic scoring

After hard constraints:

```text
candidate score
= role-specific weighted traits
+ observed verified success rate
+ availability and quota confidence
+ user/organisation preference
- expected cost penalty
- latency penalty
- low-confidence penalty
- correlation penalty with roles requiring independence
```

The scorer must be deterministic for identical inputs and profile versions. An LLM may
explain a recommendation, but it must not secretly select the winner.

### 7.8 Cold-start recommendation

Before RoleFlock has organisation-specific outcomes:

1. use versioned curated model profiles;
2. filter by provider capability and policy;
3. show low/medium confidence honestly;
4. prefer robust instruction adherence for executor roles;
5. prefer deeper reasoning for planner roles;
6. prefer independent families/providers for verifier roles;
7. preserve at least one eligible fallback where possible.

RoleFlock should present model families and traits, not hard-code the product identity to
today's model names. Shipping presets may mention current models, but the recommendation
engine operates on capability profiles and evidence.

### 7.9 Outcome learning

Each completed role assignment records:

- task class and risk;
- provider/model/profile version;
- role and effort;
- plan acceptance/revision rate;
- execution adherence;
- first-pass verification;
- number and type of deviations;
- human acceptance/rejection;
- rollback or escaped defect when later reported;
- actual/shadow cost;
- latency and intervention count.

Observed scoring must:

- require minimum sample size;
- separate correlation from claimed causation;
- avoid comparing materially different task classes;
- retain the routing policy and profile version used;
- allow users to reset or exclude anomalous runs;
- never silently alter a pinned running task.

### 7.10 UI

The recommendation view should show:

```text
Planner
Recommended: <provider / model / effort>
Why: strong planning depth, large repository context, read-only support
Confidence: Medium — curated profile, 3 local outcomes
Fallback: <candidate>

Executor
Recommended: <provider / model / effort>
Why: writer-capable, strong instruction adherence, precise patches
Constraint: must follow Execution Plan v3; no architecture decisions

Verifier
Recommended: <provider / model / effort>
Why: independent model family from executor, strong test reasoning
Independence: model family + clean runner
```

The default action is `Apply recommended roster`, with per-role adjustment available.

---

## 8. Target architecture

### 8.1 Planes

```text
Experience plane
├── Task/contract intake
├── Role recommendation
├── Review inbox
├── Change Passport viewer
└── IDE/agent handoff

Authority plane
├── Contract authorisation
├── Role authority protocol
├── Policy decisions
├── Approval identities
└── Credential grants

Execution plane
├── Agent adapters
├── External worktrees
├── Writer leases
├── Parallel task scheduler
└── Run control/recovery

Assurance plane
├── Frozen verification specs
├── Clean verifier runner
├── Artifact/evidence capture
├── Attestation and signing
└── Passport verification

Intelligence plane
├── Capability profiles
├── Role suggestion scoring
├── Outcome history
└── Quality/cost/risk routing
```

### 8.2 Package changes

New packages:

```text
packages/change-contracts       # contract and plan schemas, versions, validation
packages/role-protocol          # role authority, artifact I/O, feedback routing
packages/role-recommender       # capability profiles, constraints, scoring
packages/verification-runner    # clean worktree verification and attestations
packages/change-passport        # portable schema, signing, verification
packages/agent-events           # cross-agent normalised session/action events
```

Existing packages to extend:

```text
packages/contracts              # shared actor, digest, attestation references
packages/database               # migrations and repositories
packages/graph-core             # new role/state transitions
packages/graph-runtime          # artifact-gated edges and planner-owned loops
packages/context-compiler       # role-specific artifact context
packages/policy-engine          # contract, role, independence, merge policies
packages/provider-core          # structured output and model capability metadata
packages/evidence               # event-time evidence, not export-time rehash only
packages/repository-runtime     # external worktrees and verifier workspaces
packages/approval-engine        # contract/plan/passport approval fingerprints
apps/daemon                     # orchestration, APIs, signing service
apps/web                        # contract, recommendations, review packet, passport
```

### 8.3 Local-first and team architecture

MVP:

- execution and source stay local;
- local runner owns worktrees and process control;
- passports are signed by a local installation identity;
- trust level is displayed as `local attestation`.

Team phase:

- optional hosted or self-hosted organisation authority plane;
- organisation runner identities;
- central policies and RBAC;
- metadata/passport sync without mandatory source upload;
- revocation and transparency log;
- SIEM export.

The UI must distinguish local self-attestation from organisation-trusted attestation.

---

## 9. Database and event model

### 9.1 New tables

```text
change_contracts
change_contract_versions
execution_plans
execution_plan_versions
verification_specs
plan_deviations
role_artifacts
role_feedback
model_capability_profiles
role_recommendations
role_recommendation_candidates
verification_runs
verification_attestations
runner_identities
change_passports
passport_signatures
outcome_observations
```

### 9.2 Required event families

```text
contract.drafted
contract.clarification_requested
contract.authorised
contract.superseded

plan.proposed
plan.critique_recorded
plan.revision_requested
plan.approved
plan.superseded

executor.started
executor.plan_step_started
executor.plan_step_completed
executor.deviation_detected
executor.blocked_on_planner
executor.reported

feedback.received
feedback.classified
feedback.routed_to_planner
feedback.resolved

verification.started
verification.check_completed
verification.finding_recorded
verification.completed

role.recommendation.generated
role.recommendation.applied
role.recommendation.overridden

passport.issued
passport.verified
passport.revoked
```

Every event includes:

- event ID;
- aggregate ID and version;
- task ID;
- actor/invocation identity;
- artifact hashes when relevant;
- timestamp;
- previous-event hash for attested streams in the assurance phase.

### 9.3 Migration policy

- migrations are additive until old graph runs finish;
- existing tasks keep their pinned graph version;
- pre-contract tasks are labelled `legacy_uncontracted`;
- legacy evidence exports remain readable but cannot be shown as signed passports;
- no migration invents authorisation or evidence that did not occur.

---

## 10. API plan

Representative endpoints:

```text
POST   /api/tasks/:taskId/contracts
GET    /api/tasks/:taskId/contracts
POST   /api/contracts/:contractId/authorise
POST   /api/contracts/:contractId/revise

POST   /api/contracts/:contractId/plans
GET    /api/tasks/:taskId/plans
POST   /api/plans/:planId/critique
POST   /api/plans/:planId/approve
POST   /api/plans/:planId/revise

POST   /api/tasks/:taskId/feedback
GET    /api/tasks/:taskId/feedback
POST   /api/feedback/:feedbackId/resolve

POST   /api/tasks/:taskId/role-recommendations
GET    /api/tasks/:taskId/role-recommendations/latest
POST   /api/role-recommendations/:id/apply
POST   /api/role-recommendations/:id/override

POST   /api/tasks/:taskId/verification-runs
GET    /api/tasks/:taskId/verification-runs

POST   /api/tasks/:taskId/passports
GET    /api/tasks/:taskId/passports/latest
POST   /api/passports/:id/verify
POST   /api/passports/:id/revoke
```

Mutating endpoints require:

- CSRF and local auth;
- optimistic aggregate version;
- idempotency key;
- typed actor;
- policy evaluation;
- durable audit event.

---

## 11. Graph redesign

### 11.1 New core roles

```typescript
type WorkflowRole =
  | 'contract_planner'
  | 'planner'
  | 'plan_critic'
  | 'plan_approver'
  | 'executor'
  | 'test_runner'
  | 'verifier'
  | 'release_approver';
```

Compatibility aliases may temporarily map:

```text
writer   → executor
reviewer → plan_approver for legacy graphs only
accept   → release_approver
test     → test_runner
```

### 11.2 Artifact-gated nodes

```typescript
interface GraphNode {
  // existing fields
  requiredInputs?: ArtifactRequirement[];
  requiredOutputs?: ArtifactRequirement[];
  authority?: RoleAuthorityRef;
}
```

A node cannot start until all required artifact hashes are present and valid. A node
cannot complete unless its structured output passes schema and semantic validation.

### 11.3 Default graphs

Low risk:

```text
Micro Planner
→ Executor
→ Deterministic Test Runner
→ Release Approver
```

Medium risk:

```text
Planner
→ Plan Critic
→ Plan Approver
→ Executor
→ Deterministic Test Runner
→ Verifier
→ Release Approver
```

High/critical:

```text
Planner
→ independent Plan Critic
→ human Plan Approver
→ Executor
→ clean Test Runner
→ independent Verifier
→ policy gate
→ human Release Approver
```

### 11.4 Corrected failure routing

Current graphs route verifier feedback directly to the writer. New graphs route it to the
planner:

```text
verifier.on_needs_changes → planner
executor.on_ambiguity → planner
executor.on_deviation → planner
human.on_request_changes → planner
```

Only an explicitly classified mechanical test failure may use:

```text
test_runner.on_repairable_failure → executor
```

Graph validation rejects:

- executor without an approved plan input;
- executor receiving raw feedback;
- verifier writing files;
- verifier-to-executor edges except typed repair-envelope edges;
- planner with write permission;
- acceptance without contract, plan, verification, and policy artifacts;
- fallback assignments that violate independence policy.

---

## 12. Implementation milestones

Milestones are ordered. Each milestone must pass its exit gate before work begins on a
dependent milestone.

### M0 — Product and architecture freeze

Goal:

- make the new product boundary explicit before runtime changes.

Deliverables:

- accept ADR-013 with revised wording: unattended execution is parity, delivery assurance
  is the product;
- ADR-014: independent delivery assurance boundary;
- ADR-015: versioned Change Contract and Execution Plan;
- ADR-016: role authority and planner-owned feedback routing;
- ADR-017: independent verification trust boundary;
- ADR-018: Change Passport and signing;
- ADR-019: deterministic role recommendation and outcome scoring;
- update README positioning;
- mark old orchestration-first implementation plan as historical.

Exit criteria:

- no product document calls multi-agent orchestration the primary differentiator;
- role ownership and feedback routing have one canonical definition;
- security review approves the trust-boundary model.

### M1 — Change Contract runtime

Goal:

- make authorised intent a first-class immutable runtime object.

Implementation:

- create `packages/change-contracts`;
- add schemas and semantic validators;
- add database migrations/repositories;
- implement contract version APIs;
- add contract authorisation fingerprint;
- add task UI for criteria, prohibited outcomes, scope, and authority sources;
- migrate new tasks to require an authorised contract before start.

Tests:

- authorised versions cannot mutate;
- revision preserves history and links;
- unresolved blocking questions prevent authorisation;
- every criterion has a verification type;
- stale optimistic version is rejected;
- legacy tasks remain readable.

Exit criteria:

- a new task cannot start execution without an authorised contract hash;
- contract revisions are visible and auditable;
- no inferred data is presented as human-authorised.

### M2 — Execution Plan and role authority protocol

Goal:

- prevent the executor from becoming an implicit planner.

Implementation:

- create `packages/role-protocol`;
- add Execution Plan, Plan Critique, Plan Deviation, and Execution Report schemas;
- add artifact-gated graph nodes;
- update context compiler so executor context begins with the pinned plan artifact;
- enforce plan allowed paths through permission envelopes;
- add planner clarification and revision flow;
- replace verifier-to-writer routing with verifier-to-planner routing;
- add repair-envelope classifier for deterministic failures;
- update UI to show plan version pinned to each execution attempt.

Tests:

- executor cannot start without approved plan;
- executor cannot edit a path absent from the plan;
- raw feedback cannot target executor;
- verifier findings create planner work;
- a new plan version invalidates unstarted executor attempts;
- running executor stops safely when its plan is superseded;
- repairable failures route directly only when every repair-envelope predicate passes.

Exit criteria:

- all new write runs follow an immutable approved plan;
- every deviation is recorded or blocked by runtime;
- planner is the single owner of plan revisions.

### M3 — External worktrees and task-level parallelism

Goal:

- restore unattended parallel delivery as required product parity.

Implementation:

- default new tasks to external worktrees;
- preserve one writer per worktree, allow writers on distinct worktrees concurrently;
- introduce per-project and global concurrency policies;
- add collision prediction for tasks based on expected paths;
- add task queue, pause, cancel, and disk cleanup policy;
- add `Open in Codex`, `Open in Claude Code`, `Open in Cursor`, and `Open folder` handoffs;
- preserve branch and contract/plan identity across handoff.

Tests:

- two tasks can write concurrently in separate worktrees;
- no two writers can own one worktree;
- dirty primary checkout is not modified;
- restart recovers leases and plan pins;
- concurrent tasks report expected path overlap before execution;
- handoff does not lose task/passport lineage.

Exit criteria:

- at least four independent fixture tasks complete concurrently;
- primary checkout remains untouched;
- recovery test passes after forced daemon termination.

### M4 — Independent verification runner

Goal:

- separate execution claims from trusted verification.

Implementation:

- create `packages/verification-runner`;
- create clean verifier worktree from result commit;
- freeze verification specification before executor starts;
- run exact argv without shell interpolation;
- remove writer credentials and restrict network;
- capture environment/tool versions and command digests;
- compare test-file mutations against plan policy;
- create structured verification attestations.

Tests:

- writer cannot modify the frozen spec;
- verifier uses result commit, not dirty writer filesystem;
- modified package test script is detected;
- missing required command fails closed;
- verifier credentials differ from writer credentials;
- attestation binds contract, plan, base, result, environment, and output.

Exit criteria:

- a writer's self-reported PASS cannot satisfy a required criterion;
- only clean-runner attestations satisfy deterministic evidence requirements;
- all verifier findings map to criterion IDs.

### M5 — Change Passport v1

Goal:

- produce a portable, independently verifiable review and merge artifact.

Implementation:

- create `packages/change-passport`;
- define schema and compatibility policy;
- bind subject, contract, plan, execution, verification, policy, approval, disclosure;
- create local installation signing identity in OS keychain;
- sign passports and support revocation;
- add `roleflock passport verify`;
- add human-readable review packet;
- clearly label trust level: local, organisation, or externally anchored.

Tests:

- any modified field invalidates the signature;
- passport for another commit cannot validate;
- superseded contract/plan cannot issue a PASS passport;
- open deviations prevent PASS;
- revoked passport fails policy;
- offline CLI verification succeeds with supplied trust root.

Exit criteria:

- accepted tasks produce a valid signed passport;
- passport validation does not require trusting the web UI;
- legacy evidence is never mislabelled as signed assurance.

### M6 — Role Suggestion Engine v1

Goal:

- help users assign capable models to roles without hiding uncertainty.

Implementation:

- create `packages/role-recommender`;
- extend provider model metadata;
- create versioned curated profiles;
- implement role requirement constraints;
- implement independence constraints;
- implement deterministic scoring;
- add recommendation API and UI;
- support apply-all, per-role override, and saved roster profiles;
- record recommendation rationale and override reason.

Tests:

- writer-incompatible candidate is never recommended as executor;
- critical verifier cannot violate configured independence;
- unavailable/cooling-down models are excluded;
- identical inputs/profile versions produce identical ranking;
- unknown capability remains visible;
- override is preserved and audited;
- fallbacks meet the same hard constraints.

Exit criteria:

- a user can create a task and apply an explained roster in one action;
- each role shows capability fit, confidence, independence, and fallback;
- recommendation never relies on an unrecorded LLM decision.

### M7 — Bring-your-own-agent event ingestion

Goal:

- let RoleFlock assure changes made through tools users already prefer.

Implementation:

- create `packages/agent-events`;
- define normalised session, tool, permission, file, command, and completion events;
- add hooks/adapters for Codex, Claude Code, Cursor, and generic JSONL/HTTP ingestion;
- correlate external session with task, contract, plan, worktree, and actor;
- support re-entry after interactive handoff;
- mark missing telemetry and assurance gaps honestly.

Tests:

- imported events preserve source/provider identity;
- duplicate events are idempotent;
- missing sequence is detected;
- external writes outside plan become deviations;
- a session cannot claim another task's plan;
- incomplete telemetry reduces passport assurance level.

Exit criteria:

- at least three agent families can contribute to one normalised evidence model;
- RoleFlock can verify a change it did not directly invoke;
- users are not forced to abandon their agent's conversation context.

### M8 — GitHub delivery gate and review inbox

Goal:

- place RoleFlock at the real acceptance and merge boundary.

Implementation:

- GitHub App or CLI integration;
- map issues/PRs to Change Contracts;
- publish RoleFlock verification status;
- attach review packet and passport reference to commit/PR;
- required-check policy;
- comment/follow-up classification routed to planner;
- reviewer inbox prioritised by risk and missing evidence.

Tests:

- result commit mismatch invalidates check;
- new push invalidates prior passport;
- unauthorised comment cannot revise contract;
- request changes creates planner work, not executor prompt;
- accepted passport can satisfy required check;
- revoked passport changes status.

Exit criteria:

- a protected branch can require a valid RoleFlock passport;
- reviewers decide from a concise packet;
- every merged assured change traces back to authorised intent.

### M9 — Team authority, identities, and policy

Goal:

- support trust between multiple people and machines.

Implementation:

- hosted or self-hosted organisation control plane;
- RBAC and SSO;
- runner registration and rotation;
- short-lived scoped credentials;
- organisation policy bundles;
- multi-party approval;
- central revocation/transparency;
- SIEM/OTel export;
- optional OPA integration using structured RoleFlock inputs.

Tests:

- local user cannot forge organisation runner identity;
- revoked runner cannot issue accepted passport;
- role and repository scope is enforced;
- approval identity and authority are verified;
- offline/local operation degrades visibly rather than pretending organisation trust.

Exit criteria:

- an organisation can enforce one policy across supported agent tools;
- trusted passports identify authorising human and executing/verifying runners;
- audit history survives individual workstation loss.

### M10 — Outcome intelligence and adaptive recommendations

Goal:

- build a vendor-neutral performance and routing data moat.

Implementation:

- outcome observation pipeline;
- task-class normalisation;
- minimum-sample/confidence calculations;
- role-specific verified success metrics;
- cost/latency/intervention metrics;
- recommendation updates from observed outcomes;
- rollback and escaped-defect feedback;
- model/profile/version comparison.

Tests:

- current run never changes routing after start;
- insufficient sample does not override curated profile;
- task classes are not compared across incompatible risk/scope;
- deleted/excluded observations are not scored;
- recommendation explanation cites the observed sample and confidence.

Exit criteria:

- Roleflock can recommend a role roster using organisation-specific verified outcomes;
- users can inspect why routing changed;
- no metric is represented as causal without evidence.

### 12.1 Mergeable ticket index

Each ticket is intended to be one reviewable implementation unit. A ticket may be split
further when its diff becomes difficult to review, but it must not be combined with a
later ticket merely to make the product appear complete sooner.

| Ticket  | Scope                                               | Depends on      | Done when                                                 |
| ------- | --------------------------------------------------- | --------------- | --------------------------------------------------------- |
| M0.1 ✅ | ADR-014 delivery-assurance boundary                 | Plan acceptance | Authority vs agent boundary is frozen                     |
| M0.2 ✅ | ADR-015 Change Contract and Execution Plan          | M0.1            | Versioning and immutability rules are frozen              |
| M0.3 ✅ | ADR-016 role authority and feedback routing         | M0.2            | Planner-owned revision protocol is frozen                 |
| M0.4 ✅ | ADR-017 independent verification                    | M0.2            | Writer/verifier trust boundary is frozen                  |
| M0.5 ✅ | ADR-018 Change Passport and signing                 | M0.4            | Attestation/trust levels are frozen                       |
| M0.6 ✅ | ADR-019 role recommendation                         | M0.3            | Constraint/scoring/learning rules are frozen              |
| M0.7 ✅ | README, positioning, threat-model alignment         | M0.1–M0.6       | Product docs have no conflicting primary position         |
| M1.1 ✅ | Change Contract TypeScript schemas                  | M0.2            | Canonical validation and hash tests pass                  |
| M1.2 ✅ | Contract database migrations/repository             | M1.1            | Versions persist and authorised rows are immutable        |
| M1.3 ✅ | Contract domain service and events                  | M1.2            | Draft/revise/authorise state tests pass                   |
| M1.4 ✅ | Contract API with idempotency/version checks        | M1.3            | API integration tests pass                                |
| M1.5 ✅ | Contract intake and authorisation UI                | M1.4            | User can resolve and authorise criteria                   |
| M1.6 ✅ | Start gate and legacy-task compatibility            | M1.3            | New uncontracted task is blocked; legacy task is labelled |
| M2.1 ✅ | Execution Plan, critique, deviation, report schemas | M1.1            | Artifact semantic-validation tests pass                   |
| M2.2 ✅ | Role Protocol package and authority matrix          | M2.1            | Invalid role actions are rejected deterministically       |
| M2.3 ✅ | Artifact-gated graph node contracts                 | M2.2            | Executor cannot schedule without approved plan hash       |
| M2.4 ✅ | Planner context and structured plan output          | M2.3            | Planner produces schema-valid plans                       |
| M2.5 ✅ | Executor context pinning and path enforcement       | M2.3            | Executor sees one plan version and cannot leave its paths |
| M2.6 ✅ | Feedback classifier and planner routing             | M2.2            | Raw feedback never targets executor                       |
| M2.7 ✅ | Verifier-to-planner graph migration                 | M2.3            | All non-mechanical findings route through planner         |
| M2.8 ✅ | Repair-envelope classifier                          | M2.7            | Only approved mechanical repairs bypass planner           |
| M2.9 ✅ | Plan/deviation UI and end-to-end tests              | M2.4–M2.8       | Full revision loop passes fixture test                    |
| M3.1 ✅ | External worktree default for new tasks             | M2.5            | Primary checkout stays untouched                          |
| M3.2 ✅ | Per-worktree writer lease concurrency               | M3.1            | Distinct worktrees write concurrently                     |
| M3.3 ✅ | Global/project concurrency policy                   | M3.2            | Limits remain durable across restart                      |
| M3.4 ✅ | Expected-path collision analysis                    | M2.1, M3.1      | Overlap warning appears before start                      |
| M3.5 ✅ | IDE/agent handoff commands                          | M3.1            | Handoff preserves contract/plan/task identity             |
| M3.6 ✅ | Parallel crash-recovery test suite                  | M3.2–M3.5       | Forced daemon restart recovers safely                     |
| M4.1 ✅ | Verification Specification schema and freeze gate   | M2.1            | Executor cannot mutate verification input                 |
| M4.2 ✅ | Clean verifier worktree lifecycle                   | M3.1, M4.1      | Verification runs from result commit                      |
| M4.3 ✅ | Restricted deterministic verifier runner            | M4.2            | Exact argv and credential isolation tests pass            |
| M4.4 ✅ | Test-mutation and command-drift detection           | M4.3            | Weakened tests/scripts are detected                       |
| M4.5    | Verification attestation schema/capture             | M4.3            | Attestation binds all required digests                    |
| M4.6    | Criterion verdict UI and adversarial suite          | M4.4–M4.5       | False writer PASS cannot satisfy criterion                |
| M5.1    | Change Passport schema and compatibility policy     | M0.5, M4.5      | Golden fixtures validate                                  |
| M5.2    | Local runner identity and keychain signing          | M5.1            | Key never persists in plaintext DB                        |
| M5.3    | Passport issue/verify/revoke service                | M5.2            | Tamper, mismatch, and revocation tests pass               |
| M5.4    | Standalone passport verification CLI                | M5.3            | Offline verification succeeds                             |
| M5.5    | Review packet and assurance-level UI                | M5.3            | Local vs organisation trust is explicit                   |
| M6.1    | Model Capability Profile schema/source policy       | M0.6            | Unknown and confidence semantics are tested               |
| M6.2    | Provider catalogue capability extensions            | M6.1            | Required metadata is normalised                           |
| M6.3    | Role hard-constraint engine                         | M6.2            | Ineligible models are excluded                            |
| M6.4    | Independence policy engine                          | M6.3            | Risk-specific separation is enforced                      |
| M6.5    | Deterministic role scorer and rationale             | M6.3–M6.4       | Identical inputs produce identical ranking                |
| M6.6    | Curated profile bundle/versioning                   | M6.1            | Cold-start recommendations cite profile version           |
| M6.7    | Recommendation persistence/API                      | M6.5–M6.6       | Applied and overridden rosters are audited                |
| M6.8    | Role recommendation UI                              | M6.7            | Apply-all and per-role override work                      |
| M6.9    | Recommendation integration/adversarial tests        | M6.8            | Fallbacks cannot weaken hard constraints                  |
| M7.1    | Normalised external agent event schema              | M2.2            | Source identity and ordering rules are frozen             |
| M7.2    | Generic JSONL/HTTP ingest and correlation           | M7.1            | Replay and cross-task claims are rejected                 |
| M7.3    | Codex adapter/hook ingestion                        | M7.2            | Codex session maps to plan and worktree                   |
| M7.4    | Claude Code adapter/hook ingestion                  | M7.2            | Claude session maps to plan and worktree                  |
| M7.5    | Cursor adapter/API ingestion                        | M7.2            | Cursor session maps to plan and worktree                  |
| M7.6    | Handoff re-entry and assurance-gap calculation      | M7.3–M7.5       | Missing telemetry lowers assurance visibly                |
| M8.1    | GitHub identity/repository integration              | M5.3            | Repo and actor mapping are durable                        |
| M8.2    | Issue/PR to contract linkage                        | M8.1            | Authority source is traceable                             |
| M8.3    | Commit-bound RoleFlock status check                 | M8.1, M5.3      | New commit invalidates old PASS                           |
| M8.4    | PR review packet/passport publication               | M8.3            | Reviewer can inspect assurance from PR                    |
| M8.5    | Comment feedback classification to planner          | M8.2, M2.6      | Comments never bypass planner                             |
| M8.6    | Required-check and revocation tests                 | M8.3–M8.5       | Protected branch blocks invalid passport                  |
| M9.1    | Organisation/actor/RBAC schema                      | M0.5            | Authority checks have durable identities                  |
| M9.2    | Trusted runner registration and rotation            | M9.1            | Revoked runner cannot issue trusted passport              |
| M9.3    | Shared policy bundles and scoped credentials        | M9.1            | Cross-agent policy is enforced                            |
| M9.4    | Multi-party approval and transparency log           | M9.2–M9.3       | Approval/signature chain is verifiable                    |
| M9.5    | Hosted/self-hosted metadata sync                    | M9.2            | Source upload is not required                             |
| M9.6    | SIEM/OTel and optional OPA adapter                  | M9.3            | Structured events and decisions export                    |
| M10.1   | Outcome Observation schema and ingestion            | M5.3, M6.1      | Role outcomes retain task/profile versions                |
| M10.2   | Task-class normalisation and confidence             | M10.1           | Incompatible samples are not pooled                       |
| M10.3   | Role performance analytics                          | M10.2           | Quality/cost/intervention metrics are inspectable         |
| M10.4   | Observed-outcome recommendation input               | M10.2, M6.5     | Thresholded evidence can affect future ranking            |
| M10.5   | Rollback/escaped-defect feedback                    | M10.1           | Post-merge outcomes update observations                   |
| M10.6   | Adaptive-routing explanation and controls           | M10.3–M10.5     | User can explain, exclude, or override changes            |

---

## 13. Cross-cutting test strategy

### 13.1 Unit tests

- canonical hashes and signatures;
- state transitions;
- role authority;
- artifact validation;
- recommendation constraints/scoring;
- independence policies;
- feedback classification;
- repair-envelope predicates.

### 13.2 Integration tests

- contract → plan → executor → verifier → passport;
- planner revision after executor ambiguity;
- planner revision after verifier failure;
- external agent event ingestion;
- task-level parallel worktrees;
- restart recovery with pinned artifacts;
- GitHub status invalidation on new commit.

### 13.3 Adversarial tests

- executor attempts unplanned file edit;
- executor changes tests or package scripts;
- verifier attempts write;
- malicious document tries to change role authority;
- agent claims a false command result;
- database evidence is modified before export;
- replayed approval for a new plan version;
- forged/expired/revoked runner signature;
- external session sends events for another task;
- feedback tries to bypass planner.

### 13.4 Golden workflow fixtures

Maintain fixture repositories for:

- cosmetic low-risk change;
- bug fix with regression test;
- new endpoint;
- database migration;
- authentication change;
- dependency update;
- browser/UI assertion;
- ambiguous conflicting requirements;
- verifier-discovered plan gap;
- two concurrent tasks with overlapping files.

### 13.5 Public benchmark

Measure:

- accepted changes per reviewer hour;
- human minutes per accepted change;
- first-pass verification;
- interventions;
- revisions;
- escaped defects;
- cost per accepted change;
- wall-clock time.

Compare:

- direct agent workflow;
- RoleFlock assurance workflow;
- same task, same model where possible.

RoleFlock is not required to win raw wall-clock time. It must demonstrate reduced review
effort or increased assurance for delegated work.

---

## 14. Security requirements

- role permissions are enforced outside prompts;
- executor receives least-privilege writable roots;
- planner, critic, and verifier are read-only;
- verification runner has no writer credentials;
- secrets are referenced, not copied into artifacts;
- passport redaction preserves verifiable digests;
- signature keys are never stored in SQLite plaintext;
- all approvals bind exact contract/plan/passport hashes;
- provider fallback cannot weaken privacy, permissions, or independence;
- prompt injection cannot expand authority;
- imported agent events are untrusted until correlated and validated;
- local self-attestation is never represented as independent organisation attestation.

---

## 15. Observability and metrics

### 15.1 North-star metric

```text
Accepted AI-generated changes per reviewer hour
```

### 15.2 Product metrics

- time to first valid passport;
- percentage of tasks with authorised contracts;
- percentage of executor attempts with zero deviations;
- planner revision frequency;
- first-pass verification rate;
- reviewer minutes per accepted task;
- request-change routing accuracy;
- percentage of assured merges;
- passport verification failures;
- user override rate for role recommendations.

### 15.3 Safety guardrails

- false-PASS rate;
- escaped defect and rollback rate;
- unplanned-file write attempts;
- policy bypass attempts;
- verifier/writer trust-boundary violations;
- signature or provenance failures;
- raw feedback delivered to executor: target zero.

### 15.4 Role quality metrics

Planner:

- plan approval rate;
- number of critic findings;
- plan revisions caused by missing scope;
- verifier failures attributable to plan gaps.

Executor:

- plan adherence;
- unplanned changes;
- first-pass deterministic checks;
- repair attempts;
- cost and latency per accepted change.

Verifier:

- accepted findings;
- false positive findings;
- escaped issues later attributed to verification;
- criterion coverage.

---

## 16. UX requirements

### 16.1 Task creation

The user sees:

1. outcome and supporting source;
2. generated Change Contract;
3. clarification/authorisation;
4. recommended role roster;
5. expected assurance level, cost, and duration;
6. Start.

The user does not need to understand graph terminology.

### 16.2 Active task

Show:

- current contract and plan version;
- active role and authority;
- which step is running;
- current worktree;
- deviations and questions;
- why the task is waiting;
- next authorised decision owner.

### 16.3 Review packet

Default reviewer view:

- requested outcome;
- material changes;
- criteria pass/fail;
- visual/browser evidence;
- risk and deviations;
- verification environment;
- recommendation confidence;
- Accept, Reject, Request revision, Open workspace.

Raw logs, prompts, and events remain available as drill-down evidence.

### 16.4 Role page

Replace the current roster-only mental model with:

- Recommended;
- Current;
- Why;
- Capability gaps;
- Independence;
- Fallback;
- Observed outcomes;
- Override.

---

## 17. Commercial packaging

### Free local

- one user;
- local contracts/plans;
- local runner;
- local passports labelled self-attested;
- manual provider rosters;
- limited recommendation history.

### Team

- shared policies;
- trusted runner identities;
- GitHub/GitLab gates;
- review inbox;
- outcome analytics;
- role recommendations from team outcomes;
- client/external review links.

### Enterprise

- self-hosted authority plane;
- SSO/RBAC;
- SIEM;
- retention and residency;
- organisation trust roots;
- policy bundles;
- air-gapped runners;
- audit/export controls.

Pricing should align with assured delivery value rather than model tokens alone. Candidate
units are active repositories, trusted runners, or verified changes. Pricing validation is
a separate product exercise.

---

## 18. Risks and mitigations

### Vendor platforms copy features

Mitigation:

- stay vendor- and VCS-neutral;
- use portable evidence;
- integrate rather than replace;
- own cross-provider outcome history and multi-party acceptance.

### Assurance creates too much friction

Mitigation:

- smallest-sufficient role roster;
- auto-approved low-risk micro-plans under policy;
- review packets instead of raw logs;
- IDE handoff for interactive tweaks;
- progressive assurance levels.

### Curated role profiles become stale

Mitigation:

- version profiles;
- show source/date/confidence;
- update separately from runtime releases;
- prefer observed outcomes when statistically credible;
- never claim universal "best model".

### Evidence is mistaken for proof

Mitigation:

- explicit assurance levels;
- signed attestations;
- verifier identity;
- standalone validation;
- never promote export-time hashes as independent provenance.

### Planner becomes a bottleneck

Mitigation:

- lightweight micro-planner for low risk;
- parallel read-only investigation;
- bounded clarification;
- reuse authorised organisation patterns;
- outcome-based planner recommendation.

### Executor becomes ineffective because the plan is too rigid

Mitigation:

- plan contains a bounded repair envelope;
- planner can pre-authorise implementation alternatives;
- fast planner revision path;
- measure plan-caused blocking and improve plan quality;
- never solve this by giving executor silent planning authority.

---

## 19. Definition of done for every milestone

A milestone is complete only when:

1. domain schemas and migrations are versioned;
2. safety invariants are enforced outside prompts;
3. unit, integration, restart, and relevant adversarial tests pass;
4. UI truthfully represents incomplete/unknown state;
5. evidence and audit events are durable;
6. legacy tasks remain readable or have an explicit incompatibility message;
7. docs and threat model are updated;
8. manual test path is documented;
9. no fake/simulation result can appear as production assurance;
10. the milestone's exit criteria are demonstrated on a real fixture repository.

---

## 20. Immediate execution order

Work should begin in this order:

```text
M0 Product and ADR freeze
→ M1 Change Contract runtime
→ M2 Execution Plan and role authority protocol
→ M3 External worktrees and task parallelism
→ M4 Independent verification
→ M5 Change Passport
→ M6 Role Suggestion Engine
→ M7 Bring-your-own-agent ingestion
→ M8 GitHub delivery gate
→ M9 Team authority
→ M10 Outcome intelligence
```

M6 is intentionally after the role protocol and assurance artifacts. Recommending a model
for a poorly defined role would optimise the wrong system. The role must first have
enforceable inputs, outputs, authority, and success measurements.

The first implementation slice after this plan is accepted should be:

> M0 ADR-014 through ADR-019, followed by the `ChangeContract` and `ExecutionPlan`
> schemas with validation tests—before UI or provider changes.

This gives every subsequent change a stable product and protocol foundation.
