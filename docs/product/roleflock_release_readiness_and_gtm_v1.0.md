# RoleFlock release readiness and go-to-market gate

**Status:** release decision record

**Version:** 1.0

**Date:** 29 July 2026

**Scope:** coding-first RoleFlock local beta; payment is explicitly excluded from this
readiness assessment

## 1. Executive verdict

RoleFlock is ready to **enter the market**, but it is not ready for an unsupported public
self-serve release.

The distinction is important:

- marketing, demonstrations, a waitlist, and design-partner recruitment can begin now;
- a small founder-led private beta is appropriate after a short release-hardening sprint;
- a paid beta is appropriate after the P0 product and operational gates in this document
  pass;
- an anonymous user should not yet be expected to discover, purchase, install, activate,
  operate, upgrade, recover, and obtain support without help;
- team and enterprise claims require outbound GitHub and organisation capabilities that are
  not yet connected.

The current product should be described as a **reliable local beta with a strong assurance
core**, not as a finished enterprise delivery gate.

## 2. Readiness by release tier

| Release tier             | Verdict                  | What it means                                                                         |
| ------------------------ | ------------------------ | ------------------------------------------------------------------------------------- |
| Market entry             | Ready now                | Landing page, demo, waitlist, content, and design-partner outreach                    |
| Founder-led private beta | Nearly ready             | 5–15 technical users, narrow platform support, assisted onboarding                    |
| Paid design-partner beta | Ready after P0 hardening | Commercial use with explicit limitations and direct support                           |
| Public self-serve beta   | Not ready                | Users can install, activate, upgrade, recover, and succeed without founder help       |
| Team beta                | Not ready                | GitHub/PR delivery integration and shared team identity operate end to end            |
| Enterprise/GA            | Not ready                | Organisation trust, SSO, hosted or self-hosted control plane, and support commitments |

## 3. Evidence behind the verdict

### 3.1 What is strong

The coding-first product has substantial implementation and automated coverage:

- Change Contracts and human authorisation;
- planner-owned Execution Plans;
- role boundaries and planner-routed feedback;
- external worktrees and writer leases;
- deterministic verification commands;
- clean independent verification workspaces;
- verification specifications and criterion verdicts;
- commit-bound Change Passports;
- role and model recommendations;
- provider discovery, routing, failover, quota cooldowns, and usage;
- crash recovery and resumable graphs;
- evidence, diagnostics, backup, and local deletion;
- localhost authentication, CSRF, origin checks, and path protections;
- a significantly improved local UI.

The audit at the time of this decision found:

- full workspace build passes;
- lint passes;
- typecheck passes;
- package, CLI, web, and daemon tests pass in their supported environment;
- three preview tests were blocked by the audit sandbox from listening on `::1`, then the
  affected file passed 7/7 outside that sandbox;
- the working tree was clean after the preceding documentation task.

This is strong evidence that the core is ready for controlled real-user testing. Automated
tests are not evidence of product-market fit or self-serve operability.

### 3.2 What the repository already says honestly

The repository describes itself as a `reliable local beta` and its existing readiness report
states that it is ready for local Verified Fix use but not a packaged DMG or live public
deployment:

- [`README.md`](../../README.md)
- [`docs/test-plans/mvp-readiness.md`](../test-plans/mvp-readiness.md)

The delivery-assurance plan also records known reach gaps:

- no outbound GitHub client or GitHub App;
- no metadata-sync transport or hosted control plane;
- no SSO;
- signing-key storage is not yet backed by the OS keychain in the daemon;
- default workflow graphs do not set `authorityRole`, leaving the executor plan-pinning
  gate dormant until assurance artifacts are created per task.

See
[`roleflock_delivery_assurance_implementation_plan_v1.0.md`](roleflock_delivery_assurance_implementation_plan_v1.0.md).

### 3.3 What is not yet productised

The current setup still assumes a repository contributor:

- clone source;
- install Node 24 and pnpm;
- install workspace dependencies;
- build the monorepo;
- start the local daemon;
- open the token-bearing URL.

The root, daemon, CLI, and web packages are private workspace packages. There is no public
installer, signed desktop artifact, package-distribution channel, or automatic updater.

The product can create a local backup, but it does not yet expose a tested restore workflow.
The update service checks version metadata but does not download or install an update.

The public website and domain deployment were not started at the time of this decision. This
is expected product work, not a code defect, but it means the market currently has no
discoverable acquisition surface.

## 4. Definitions

### 4.1 Ready to market

RoleFlock is ready to market when:

- the problem and target buyer are clear;
- claims match current product reach;
- a credible demo exists;
- interested users have a landing page and call to action;
- a small number of qualified users can be onboarded manually;
- limitations are disclosed rather than hidden.

By this definition, RoleFlock can begin go-to-market work now.

### 4.2 Ready for private beta

RoleFlock is ready for private beta when:

- the supported OS and provider prerequisites are explicit;
- the release artifact installs reliably on a clean machine;
- the first successful workflow is guided;
- data can be backed up and recovered;
- critical secrets use an appropriate platform store;
- support is available directly;
- the beta cohort and feedback process are controlled.

### 4.3 Ready for public self-serve

RoleFlock is ready for public self-serve when an unknown qualified user can:

```text
discover
→ understand
→ install
→ connect a provider
→ register a repository
→ produce a fully assured result
→ inspect evidence
→ upgrade
→ recover data
→ get support
```

without requiring repository knowledge or direct founder intervention.

### 4.4 Ready for enterprise

Enterprise readiness additionally requires:

- organisation identity and authentication;
- centrally enforceable policy and RBAC;
- trusted runners and key lifecycle;
- integration with pull requests and protected branches;
- metadata and passport sync;
- security, privacy, compliance, and support commitments;
- deployment, audit, and incident-response options appropriate to the buyer.

## 5. P0 blockers besides payment

### P0.1 Distribution, installation, and lifecycle

The first paid beta must not require users to operate the source monorepo.

Minimum outcome:

```text
download
→ install
→ open RoleFlock
→ connect provider
→ start first task
```

Recommended scope:

- support macOS first;
- choose one signed and notarised desktop or single-command installation path;
- bundle or manage the compatible runtime;
- provide start-on-demand behaviour;
- provide a visible version;
- provide uninstall instructions that distinguish application removal from local-data
  deletion;
- publish checksums and release notes;
- test clean install, upgrade, downgrade refusal, and uninstall.

Supporting every OS before validating demand would delay learning. Other platforms should be
added after the first supported platform is reliable.

### P0.2 Assurance must be the default for the assured product path

The product promise is not credible if a user can unknowingly complete a default workflow
without the authority chain that differentiates RoleFlock.

Required outcome:

- define one canonical `Assured` workflow mode;
- ensure its graph activates contract, plan, frozen verification, independent verifier, and
  passport gates by default;
- set and enforce role authority on shipped assured graphs;
- visibly distinguish direct or legacy execution from assured execution;
- prevent marketing and UI from calling an unassured result fully verified;
- make the recommended first-run path use the assured mode.

Low-friction direct modes may remain, but they must have weaker, explicit labels.

### P0.3 Signing keys must use the OS keychain

The daemon currently uses an encrypted local-file secret store whose key is colocated with
the encrypted data. This is better than plaintext SQLite but does not satisfy the intended
OS-keychain boundary.

Required outcome for the initial platform:

- store issuer signing material in macOS Keychain;
- migrate or rotate existing local identities safely;
- handle locked, missing, revoked, or corrupt key state;
- keep local self-attestation visibly distinct from organisation trust;
- test backup and restore behaviour without exporting private signing keys accidentally.

### P0.4 Backup, restore, and migration safety

Backup without a tested restore path is not sufficient for a product that owns contracts,
plans, evidence, passports, and audit history.

Required outcome:

- automatic pre-upgrade backup;
- explicit restore command or UI;
- schema compatibility validation;
- migration failure rollback or safe-stop behaviour;
- restore tests from at least the previous supported version;
- clear handling of worktrees and provider credentials;
- documented disaster-recovery procedure for a non-contributor user.

### P0.5 Reproducible release pipeline

Local green status is not the final release gate.

Required outcome:

- push all release commits;
- pass CI from a clean checkout;
- assign a beta version;
- produce immutable release artifacts;
- generate checksums;
- retain build provenance;
- publish changelog and known limitations;
- smoke-test the exact downloaded artifact, not a development checkout;
- define rollback and withdrawal procedures.

Every release candidate must be reproducible from its tag and must not depend on uncommitted
or previously generated local `dist` files.

### P0.6 Guided first-run activation

The user should not need to understand the graph architecture before obtaining value.

Recommended first-run path:

```text
Welcome and local-data disclosure
→ provider/CLI detection
→ authentication health
→ repository registration
→ first governed task
→ contract authorisation
→ plan approval
→ frozen verification
→ run
→ acceptance
→ passport
```

Required UX:

- prerequisites checked before task start;
- unavailable providers explained with a resolution action;
- one recommended role roster;
- one recommended assured workflow;
- progress and next action always visible;
- no empty state that spins forever;
- no terminal error without recovery guidance;
- sample or fixture repository available for a risk-free first success.

Target: first assured passport in less than 15 minutes for a qualified new user.

### P0.7 Trust, legal, and support surface

Before accepting external paid users:

- publish a privacy policy matching runtime behaviour;
- publish product terms or EULA and the applicable software licence;
- publish third-party notices where required;
- provide a security contact;
- provide a support channel and expected beta response window;
- provide a known-limitations page;
- provide an issue-report path using redacted diagnostics;
- document what local self-attestation does and does not prove;
- define how a compromised or defective release is withdrawn.

### P0.8 Real-user validation

The product needs evidence that its assurance reduces review cost or increases trust enough
to justify the additional steps.

Minimum design-partner cohort:

- 5–15 qualified developers or technical leads;
- repositories that are not RoleFlock fixtures;
- at least one real provider per participant;
- repeated use across more than one week;
- direct observation of first-run and recovery problems.

Automated test count must not be used as a proxy for customer value.

## 6. Work that can be deferred

These capabilities should not block the first solo-developer or technical-lead beta:

- SSO;
- hosted metadata sync;
- organisation control plane;
- full enterprise RBAC UI;
- SIEM integrations;
- Windows and Linux installers;
- managed provider billing;
- automatic central telemetry;
- user-authored workflow graphs.

### 6.1 GitHub integration depends on the claim

Outbound GitHub integration may be deferred only when the beta promise is local assurance
and portable evidence.

It becomes P0 before RoleFlock claims:

- protected branches can require a RoleFlock result;
- a pull request automatically shows the passport;
- new commits invalidate a published GitHub check;
- PR feedback automatically routes into planning.

The internal decision model does not satisfy an external integration claim.

### 6.2 Payment is not the primary readiness blocker

Payment can be manual during a design-partner beta. A billing system should not be built
before users can install, activate, recover, and repeatedly obtain value.

Payment becomes necessary for public self-serve, but it does not replace the product,
security, support, and distribution gates above.

## 7. Claims policy

### 7.1 Claims permitted for the initial beta

Subject to the exact workflow used, RoleFlock may say:

- local-first assurance workspace for AI-generated software changes;
- works with supported existing coding agents and CLIs;
- binds authorised intent and an approved plan to a result;
- executes deterministic verification;
- can run an independent verifier against a clean result workspace;
- produces commit-bound local Change Passports;
- keeps executor claims separate from independent evidence;
- exposes provider/model routing and evidence;
- supports local backup, export, deletion, and crash recovery.

### 7.2 Claims not yet permitted

RoleFlock must not yet say:

- every default workflow is fully assured;
- a RoleFlock PASS is organisation-trusted by default;
- GitHub protected branches can require RoleFlock;
- passports are published automatically to pull requests;
- signing keys are stored in the OS keychain on all platforms;
- the product has automatic updates;
- restore is fully supported;
- SSO or hosted team sync exists;
- the product is enterprise-ready;
- all AI-generated code is safe to ship.

### 7.3 Recommended initial positioning

> Use your existing coding agents. RoleFlock turns delegated changes into authorised,
> independently verified, commit-bound evidence you can review without replaying the work.

Short form:

> Your agents write. RoleFlock proves what is ready to review.

Until GitHub delivery gates and organisation trust are active, avoid wording that implies
RoleFlock itself merges, protects, or authorises production release for a team.

## 8. Go-to-market sequence

### Stage G0 — Prepare the market surface

Can begin immediately and run in parallel with hardening:

- acquire and configure the domain;
- deploy a focused landing page;
- publish a 90–120 second product demonstration;
- show the assurance chain and Change Passport;
- provide a design-partner application;
- publish the local-first privacy position;
- create one technical deep-dive explaining why agent output is a claim, not evidence.

Primary call to action:

> Apply for the founding design-partner beta.

Avoid a public download button until the installation and support path is ready.

### Stage G1 — Internal release candidate

- resolve P0.1 through P0.6 for the first supported platform;
- push and pass CI;
- install on a clean machine;
- run one real assured bug-fix workflow;
- recover from an interrupted run;
- back up and restore;
- upgrade from the previous candidate;
- verify the passport offline.

### Stage G2 — Founding design-partner beta

- 5–15 users;
- assisted onboarding;
- narrow supported environment;
- weekly feedback;
- explicit beta limitations;
- direct support;
- no promise of enterprise GitHub enforcement.

### Stage G3 — Paid beta

Entry gate:

- repeat activation is reliable;
- support burden is understood;
- P0 security and recovery gates pass;
- at least several users return for repeated work;
- the value metric is stronger than “the workflow ran”.

Payment may remain manual while the cohort is controlled.

### Stage G4 — Public self-serve beta

Entry gate:

- public installer and update lifecycle;
- in-product onboarding;
- published support and legal surfaces;
- reliable restore;
- automated release channel;
- product analytics or a privacy-compatible activation measurement strategy;
- no founder intervention required for the common first-run path.

### Stage G5 — Team and enterprise expansion

- GitHub App and required checks;
- PR packet publication and invalidation;
- organisation identity;
- trusted runners;
- metadata sync;
- shared policy;
- SSO;
- enterprise deployment and support model.

## 9. Design-partner offer

### 9.1 Target user

Initial users should be:

- AI-native agencies;
- technical leads delegating several changes;
- multi-repository teams with constrained senior-review capacity;
- developers already using Codex, Claude Code, or Cursor Agent;
- users willing to run a local-first beta and provide direct feedback.

A solo developer making rapid interactive colour or copy edits is not the strongest paid
buyer. Direct agent chat is faster for that job.

### 9.2 Narrow beta job

The first beta should optimise one job:

> Delegate a real bug fix, return later, and decide whether to accept it from a contract,
> plan, independent verification, diff, and Change Passport.

Do not launch every workflow and future domain at once.

### 9.3 Offer boundaries

- supported platform and CLI versions are explicit;
- users bring their own provider accounts;
- local self-attestation is labelled honestly;
- no source code is uploaded to a RoleFlock control plane;
- direct founder support is included;
- the beta may require recovery assistance;
- design partners agree to provide workflow-level feedback.

## 10. Success metrics

### 10.1 Activation

- landing-page application conversion;
- install success rate;
- provider connection success rate;
- repository registration success rate;
- first task started;
- first authorised contract;
- first approved plan;
- first fully assured passport;
- time to first assured passport.

### 10.2 Product value

- human review minutes per accepted change;
- percentage of delegated tasks accepted without replaying the full agent session;
- independent verification findings that change the outcome;
- first-pass verification rate;
- plan revision rate;
- support interventions per completed task;
- repeated use in week two and week four;
- accepted changes per reviewer hour.

### 10.3 Safety and reliability

- repository-damage incidents: target zero;
- silent unassured PASS incidents: target zero;
- unsupported claims shown as verified: target zero;
- recovery success rate;
- restore success rate;
- interrupted-run resume success;
- provider credential exposure incidents: target zero;
- escaped defects reported after acceptance.

### 10.4 Cost and friction

- provider cost per accepted task;
- external API or model calls per accepted task;
- elapsed time;
- human approvals per task;
- percentage of users who choose direct mode because assured mode is too burdensome;
- reasons for abandoning a workflow.

RoleFlock does not need to beat direct chat on latency. It must reduce review effort,
increase trustworthy delegation, or provide evidence valuable to another party.

## 11. Release gate checklist

### Engineering

- [ ] Release commit is pushed and tagged.
- [ ] Clean CI build, lint, typecheck, and test pass.
- [ ] Exact release artifact passes smoke tests.
- [ ] No uncommitted generated files are required.
- [ ] Known high-risk issues are resolved or explicitly block the release.

### Assurance

- [ ] First-run workflow creates an authorised contract.
- [ ] Executor is pinned to an approved plan.
- [ ] Verification specification is frozen.
- [ ] Independent verifier runs from the correct result identity.
- [ ] Passport binds the exact result.
- [ ] Unassured and legacy results cannot appear fully assured.

### Installation and lifecycle

- [ ] Clean install succeeds on the supported OS.
- [ ] Application starts without a source checkout.
- [ ] Version is visible.
- [ ] Update path is tested.
- [ ] Uninstall behaviour is documented.
- [ ] Local data retention and deletion are explicit.

### Security and privacy

- [ ] Signing key uses the supported OS keychain.
- [ ] Provider credentials are appropriately scoped.
- [ ] Session token permissions are correct.
- [ ] Diagnostics remain redacted.
- [ ] Privacy claims match runtime behaviour.
- [ ] Threat model and known limitations are published.

### Data safety

- [ ] Automatic pre-upgrade backup works.
- [ ] Restore works on a supported backup.
- [ ] Migration failure is recoverable.
- [ ] Worktree recovery is documented.
- [ ] Data deletion does not delete registered repositories.

### Onboarding

- [ ] Provider prerequisites are detected.
- [ ] Missing authentication has a resolution path.
- [ ] First project registration is understandable.
- [ ] Recommended workflow and roster are preselected.
- [ ] Every state has a visible next action.
- [ ] First assured passport target is met in usability testing.

### Operations

- [ ] Support channel exists.
- [ ] Security contact exists.
- [ ] Release rollback/withdrawal process exists.
- [ ] Diagnostics collection requires explicit user action.
- [ ] Incident severity and response ownership are defined.

### Legal and trust

- [ ] Privacy policy is published.
- [ ] Terms/EULA or licence is published.
- [ ] Third-party notices are reviewed.
- [ ] Local self-attestation limitations are clear.
- [ ] Marketing claims have an implementation owner and evidence.

### Go-to-market

- [ ] Domain and landing page are live.
- [ ] Demo reflects the exact release build.
- [ ] Design-partner qualification form exists.
- [ ] Beta scope and limitations are public.
- [ ] Activation and success metrics are recorded.

## 12. Recommended execution order

The most efficient sequence is:

```text
R0  Push current work and require clean CI
R1  Make the canonical assured workflow default and truthful
R2  Move signing identity to the initial OS keychain
R3  Implement backup restore and migration safety
R4  Package one supported platform and release lifecycle
R5  Build guided first-run activation
R6  Publish trust, legal, support, landing, and demo surfaces
R7  Run the design-partner beta and measure repeated value
R8  Add self-serve payment only when the self-serve product gate passes
```

G0 landing-page and design-partner outreach preparation can run in parallel, but downloads
should remain gated until R1 through R6 are sufficiently complete.

## 13. Relationship to the beyond-coding direction

RoleFlock's long-term domain is broader than coding; see
[`roleflock_beyond_coding_verified_work_v1.0.md`](roleflock_beyond_coding_verified_work_v1.0.md).

That direction must not expand the first release scope.

The coding-first beta should prove:

- users value delegated work with evidence;
- the authority chain is understandable;
- provider-neutral routing is useful;
- independent verification changes review decisions;
- passports are valuable to someone other than the worker.

Verified Web Intelligence should proceed as a separate validation track after the release
foundation is reusable. It must not delay the coding design-partner beta unless a shared core
abstraction is necessary to avoid irreversible packaging or identity decisions.

## 14. Final release decision

**Go** for:

- market preparation;
- landing page and demo;
- waitlist;
- founding design-partner recruitment;
- a controlled private beta after the P0 hardening sprint.

**No-go** today for:

- unrestricted public download;
- unsupported paid self-serve;
- enterprise assurance claims;
- GitHub required-check claims;
- organisation-trusted passport claims.

The correct next milestone is not “payment complete.” It is:

> A qualified new user can install RoleFlock on a clean supported machine and produce,
> inspect, recover, and trust one fully assured result without repository knowledge or
> founder intervention.
