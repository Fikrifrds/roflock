# RoleFlock beyond coding: verified work and web intelligence

**Status:** product direction note

**Version:** 1.0

**Date:** 29 July 2026

**Relationship to current product:** extends ADR-014 without replacing the coding-first
go-to-market wedge

## 1. Decision summary

RoleFlock is not fundamentally a coding tool. Coding is the first vertical in which its
assurance model has been implemented.

The more durable product boundary is:

> RoleFlock is the independent assurance and control layer for work delegated to AI agents
> and external tools.

Models, agents, search APIs, browsers, data providers, IDEs, and execution environments
perform work. RoleFlock controls what they are allowed to do, keeps authoritative decisions
outside model output, captures provenance, verifies the result independently, and produces a
reviewable acceptance record.

The coding product remains the first commercial wedge because it is already implemented and
has a concrete high-value artifact: a commit-bound software change. The second proposed
vertical is **Verified Web Intelligence**: evidence-backed research and structured data
collection from the internet and licensed data providers.

This expansion must not reposition RoleFlock as a generic multi-agent orchestrator. Agent
coordination and tool calling are implementation capabilities. The differentiated product is
the authority, evidence, and verification boundary around delegated work.

## 2. Why the assurance model generalises

The failure modes addressed by RoleFlock are not unique to code:

- a model may reinterpret an ambiguous request;
- an executor may expand scope without approval;
- a tool may access a source or credential it was not authorised to use;
- a model may fabricate a missing field or citation;
- one provider may return stale or incomplete information;
- the worker may grade its own work;
- a polished output may hide low coverage, contradictions, or missing evidence;
- feedback may bypass the planner and silently change the intended result;
- a later reviewer may be unable to reproduce how the result was produced.

The same authority chain applies across domains:

```text
Human or organisation intent
        │
        ▼
Authorised Work Contract
        │
        ▼
Planner-owned Execution Plan
        │
        ▼
Bounded agents and tool providers
        │
        ▼
Captured source evidence and provenance
        │
        ▼
Independent verification and coverage audit
        │
        ▼
Human or policy acceptance
        │
        ▼
Signed Work Passport
```

The subject of assurance changes by domain:

| Domain              | Work product                          | Binding identity                                      |
| ------------------- | ------------------------------------- | ----------------------------------------------------- |
| Software delivery   | Git result commit and diff            | commit, tree, and diff digests                        |
| Web intelligence    | Versioned dataset and source manifest | dataset, schema, query-plan, and source digests       |
| Document production | Versioned document artifact           | document and source-reference digests                 |
| Financial analysis  | Model inputs, workbook, and report    | input snapshot, formula, workbook, and report digests |
| Compliance review   | Case file and findings                | evidence bundle, policy version, and decision digest  |

The domain-specific artifact changes. The authority boundaries do not.

## 3. Product architecture: core plus domain packs

RoleFlock should evolve into two layers.

### 3.1 Domain-neutral assurance core

The core owns:

- versioned intent and acceptance criteria;
- planner-owned execution plans;
- role authority and feedback routing;
- provider, model, tool, network, credential, and budget grants;
- deterministic state transitions;
- evidence and provenance capture;
- independent verification;
- human and policy approvals;
- signed passports and revocation;
- outcome history and role/provider recommendations.

The domain-neutral canonical objects are:

```text
WorkContract
ExecutionPlan
RoleRoster
PermissionEnvelope
ToolGrant
EvidenceRecord
ProvenanceLink
VerificationSpecification
VerificationAttestation
AcceptanceDecision
WorkPassport
```

The current `ChangeContract` and `ChangePassport` are coding-specialised implementations of
these concepts. They should not be renamed prematurely. A future generalisation should be
introduced through compatible abstractions and adapters, not a repository-wide terminology
rewrite before a second vertical is proven.

### 3.2 Domain packs

A domain pack defines:

- the contract schema;
- the work-product schema and identity;
- required and optional roles;
- eligible model and tool capabilities;
- permission and credential profiles;
- workflow graph templates;
- verification rules;
- quality and coverage metrics;
- export formats;
- passport subject and claims;
- legal, privacy, and source-policy constraints.

Initial domain packs:

```text
code_assurance
web_intelligence
```

Possible future packs:

```text
market_research
competitive_intelligence
procurement_research
document_production
due_diligence
compliance_evidence
financial_analysis
```

A domain pack is not merely a prompt template. Its schemas, grants, verification rules, and
acceptance gates are enforced by deterministic code.

## 4. Verified Web Intelligence

Verified Web Intelligence turns a broad research request into a versioned, source-backed
dataset that states what is known, unknown, conflicted, inferred, and stale.

The product promise is:

> Ask for structured intelligence. RoleFlock plans the coverage, routes the right search and
> data providers, records field-level provenance, verifies claims independently, and returns
> a dataset whose limits are visible.

RoleFlock does not become a search engine or data broker. It integrates search, crawl,
browser, extraction, enrichment, and licensed dataset providers while owning the assurance
boundary around their use.

## 5. Example: Indonesian startup intelligence

### 5.1 User request

An example request is:

> Build a comprehensive dataset of startups in Indonesia, from decacorns and unicorns to
> small startups. Include origin, category, funding journey, current known round, founders,
> and team information.

This request is valuable but cannot be executed safely as one open-ended model prompt.
Terms such as `startup`, `Indonesia`, `small`, `current round`, `team`, and `complete` require
an authorised definition.

### 5.2 Contract questions

Before work begins, the planner must resolve:

- Does “Indonesia” mean incorporated in Indonesia, headquartered in Indonesia, founded by
  Indonesians, or operating in Indonesia?
- Are inactive, acquired, merged, and shut-down companies included?
- What is the minimum evidence required to classify an entity as a startup?
- Does “small” have an employee, funding, age, revenue, or visibility threshold?
- Is the target a census claim or a best-effort discovery dataset?
- Which date establishes the dataset's freshness?
- Which paid/licensed sources may be used?
- May personal information about founders or employees be collected?
- Which team fields are permitted and necessary?
- How should undisclosed funding amounts and conflicting reports be represented?
- Are historical valuations required, or only the latest publicly supported valuation?

The contract must never authorise the word `complete` without a measurable coverage frame.
Open-web discovery has no reliable universal denominator. The accepted contract should use
language such as:

> Best-effort coverage across the declared source frame as of 2026-07-29, with every entity
> carrying discovery provenance and every required field carrying a verified, conflicted,
> single-source, inferred, or unknown status.

### 5.3 Proposed company schema

```typescript
interface StartupEntity {
  entityId: string;
  legalName?: SourcedValue<string>;
  displayName: SourcedValue<string>;
  aliases: SourcedValue<string[]>;
  officialWebsite?: SourcedValue<string>;

  relationshipToIndonesia: SourcedValue<
    'incorporated' | 'headquartered' | 'founded' | 'operates' | 'multiple'
  >;
  foundedAt?: SourcedValue<string>;
  foundedLocation?: SourcedValue<Location>;
  headquarters?: SourcedValue<Location>;

  categories: SourcedValue<string[]>;
  businessModel?: SourcedValue<string>;
  operatingStatus: SourcedValue<
    'active' | 'acquired' | 'merged' | 'inactive' | 'closed' | 'unknown'
  >;

  valuationClass?: SourcedValue<'decacorn' | 'unicorn' | 'sub_unicorn' | 'unknown'>;
  latestSupportedValuation?: SourcedMoney;

  fundingRounds: FundingRound[];
  totalDisclosedFunding?: SourcedMoney;
  latestKnownRound?: SourcedValue<FundingRoundRef>;

  founders: PersonRole[];
  currentLeadership: PersonRole[];
  employeeEstimate?: SourcedRange;

  discoveredBy: DiscoveryRecord[];
  quality: EntityQuality;
  lastVerifiedAt: string;
}
```

Every `SourcedValue` includes:

```typescript
interface SourcedValue<T> {
  value?: T;
  status: 'verified' | 'single_source' | 'conflicted' | 'inferred' | 'unknown';
  confidence: number;
  observedAt?: string;
  effectiveAt?: string;
  sourceRefs: string[];
  explanation?: string;
}
```

An absent field remains `unknown`. The extractor must never fill gaps with a plausible value.

### 5.4 Funding-round schema

Each funding round should preserve:

- announced date;
- round type as reported;
- normalised round category;
- disclosed amount and currency;
- optional normalised USD amount with exchange-rate source and date;
- pre-money or post-money valuation only when explicitly supported;
- named lead investors;
- named participating investors;
- source references;
- contradiction status;
- whether the amount is exact, estimated, range-based, or undisclosed.

“Current round” must be displayed as **latest publicly supported round as of a stated date**.
It is not proof that no later private or undisclosed round exists.

Decacorn and unicorn labels must bind a valuation, currency, source, and effective date.
Historical status must not be displayed as a current valuation without a freshness warning.

## 6. Workflow and role design

### 6.1 Recommended workflow

```text
Contract intake
→ source-frame and coverage plan
→ query-plan approval
→ candidate discovery
→ source retrieval
→ entity resolution and deduplication
→ structured extraction
→ enrichment
→ contradiction resolution
→ independent field verification
→ coverage and freshness audit
→ human acceptance
→ dataset export and Work Passport
```

### 6.2 Model roles

**Research Planner**

- defines the source frame, query families, sampling strategy, schema mapping, budget, and
  stopping conditions;
- owns revisions when coverage gaps or contradictions are found;
- cannot mark its own plan verified.

**Discovery Researcher**

- executes approved discovery queries through granted search providers;
- proposes candidate entities;
- cannot promote a candidate into the accepted dataset without evidence.

**Source Analyst**

- locates primary and high-quality secondary sources for a candidate;
- records source type, date, publisher, and relevance;
- cannot treat a search-result snippet as proof for a complex field.

**Structured Extractor**

- maps source content into the approved schema;
- attaches source references to every extracted value;
- emits `unknown` instead of guessing.

**Entity Resolution Analyst**

- proposes merges and splits for aliases, renamed companies, subsidiaries, and similarly
  named entities;
- cannot merge entities when deterministic identifiers or evidence remain ambiguous.

**Conflict Analyst**

- compares contradictory dates, amounts, categories, and people;
- records the conflict and recommends a resolution rule;
- routes contract-changing ambiguity back to the planner or human authority.

**Independent Verifier**

- samples or checks extracted claims against source evidence using an invocation independent
  from the extractor;
- checks source authority, temporal validity, field meaning, and citation support;
- cannot modify accepted dataset values directly.

**Coverage Auditor**

- measures declared source-frame coverage, query exhaustion, duplication, missingness,
  freshness, and source diversity;
- prevents “complete” from being inferred from a large row count.

### 6.3 Deterministic roles and services

These are tools, not LLM roles:

- schema validator;
- URL normaliser;
- entity-key and duplicate detector;
- dataset hasher;
- query-budget and rate-limit controller;
- field-level provenance validator;
- source timestamp and content-digest recorder;
- currency normaliser;
- export generator;
- policy and acceptance gate.

The smallest sufficient roster should be selected. Separate model roles are introduced only
when they create meaningful independence or specialised capability.

## 7. Tool and data-provider routing

Web intelligence requires a tool-provider layer distinct from the model-provider layer.

Provider categories include:

- SERP/search APIs;
- semantic web search;
- news and archive search;
- controlled browser navigation;
- page retrieval and structured extraction;
- official registries and government datasets;
- licensed company and funding databases;
- maps and geocoding;
- currency and market-data sources;
- storage and export destinations.

Examples are integrations, not hardcoded defaults:

- [Autom.dev](https://docs.autom.dev/) for structured SERP endpoints and usage/quota
  visibility;
- other search, browser, crawl, enrichment, registry, or licensed dataset APIs chosen by
  capability and policy.

Users may bring their own API credentials. RoleFlock should request a credential only when an
approved plan requires that capability.

Each tool profile declares:

```typescript
interface ToolProviderProfile {
  providerId: string;
  capabilityVersion: string;
  capabilities: string[];
  supportedRegions?: string[];
  dataClasses: string[];
  credentialRef?: string;
  rateLimit?: RateLimit;
  unitCost?: UnitCost;
  termsRef?: string;
  sourcePolicy: {
    mayStoreContent: boolean;
    mayStoreDerivedData: boolean;
    attributionRequired: boolean;
    personalDataAllowed: boolean;
  };
}
```

Routing must consider:

- required source or search capability;
- geography and language;
- freshness;
- structured-result quality;
- provider health and quota;
- expected unit cost;
- data-use and retention terms;
- personal-data policy;
- reproducibility;
- independence requirements.

A fallback cannot silently weaken source quality, legal policy, privacy, or verification.
When no eligible provider exists, the task pauses and asks the user for an allowed provider
or credential.

## 8. Evidence, provenance, and verification

### 8.1 Evidence requirements

For each run, RoleFlock records:

- approved query plan and query parameters;
- provider, endpoint, region, language, and invocation time;
- result identifiers and canonical URLs;
- retrieval timestamp;
- source publisher and source type;
- content or response digest where storage policy permits;
- extraction invocation and schema version;
- field-to-source provenance links;
- normalisation and entity-resolution decisions;
- conflicts and unresolved gaps;
- tool usage, quota, cost, and failures.

Search results are discovery evidence, not automatically claim evidence. A snippet may
identify a candidate source, but a funding amount or founder relationship normally requires
the underlying source or a licensed structured record.

### 8.2 Verification rules

The verification specification can require:

- authoritative source for legal identity or incorporation fields;
- two independent sources for high-value or high-volatility claims;
- primary announcement plus independent secondary confirmation for funding rounds;
- freshness windows per field type;
- no uncited required fields;
- no source reference that resolves to a different entity;
- deterministic duplicate checks;
- contradiction disclosure;
- minimum sample verification rate;
- minimum source diversity;
- explicit unknown status for unsupported values.

Passing means the dataset satisfies the authorised specification. It does not mean the open
web contains no other entities or facts.

### 8.3 Coverage reporting

Coverage must distinguish:

```text
row count
source-frame coverage
required-field completeness
verified-field rate
single-source rate
conflict rate
unknown rate
freshness compliance
duplicate rate
source diversity
```

No single percentage should be called “completeness” without naming its denominator.

## 9. Work Passport for a dataset

A Web Intelligence Passport binds:

- Work Contract version and hash;
- approved query and execution plan;
- dataset schema version;
- dataset file hashes;
- source-manifest hash;
- query log hash;
- entity-resolution and normalisation rules;
- field-level provenance summary;
- provider and tool versions;
- verification specification and attestation;
- coverage, freshness, unknown, and conflict metrics;
- data-policy and disclosure manifest;
- human or policy acceptance;
- issuer identity and assurance level.

The passport makes a dataset reviewable and comparable across refreshes. A later refresh
creates a new dataset identity and passport; it cannot inherit a prior PASS merely because
the filename is unchanged.

## 10. UX implications

The user should not have to design the role graph or choose every API manually.

The product flow should be:

```text
Describe the intelligence needed
→ resolve scope and output schema
→ RoleFlock recommends source/tool/model roster
→ show coverage plan, permissions, estimated calls, and cost
→ request only missing credentials
→ approve plan
→ run and monitor coverage
→ review conflicts and gaps
→ accept dataset
→ export CSV/JSON/XLSX plus passport
```

The UI must surface:

- why each provider is needed;
- what data will leave the machine;
- credential scope;
- rate and cost budget;
- source and licensing constraints;
- live discovered/verified/conflicted counts;
- query coverage;
- evidence behind a selected field;
- change between dataset versions;
- refresh and staleness status.

Small feedback such as a colour change is still better handled interactively in an IDE.
Likewise, a one-off factual question is better handled in a search or chat interface.
RoleFlock is valuable when the work is delegated, repeated, expensive to review, or must be
trusted by another party.

## 11. Safety, legal, and ethical boundaries

Verified Web Intelligence introduces risks beyond the coding threat model.

RoleFlock must:

- respect provider terms, rate limits, data licences, and retention rules;
- never bypass CAPTCHA, paywalls, authentication, or access controls;
- support domain allowlists and denylists;
- minimise collection of personal information;
- prohibit sensitive-person profiling without an explicit lawful use and policy;
- separate public professional-role data from private contact data;
- record whether derived data may be stored or redistributed;
- support source removal, dataset correction, and provenance-aware deletion;
- avoid presenting inference as observed fact;
- prevent prompt injection in retrieved pages from changing the plan or tool grants;
- keep retrieved content untrusted until parsed and verified;
- provide regional and organisation policy controls.

RoleFlock should govern access to data providers. It should not become a system for evading
their protections.

## 12. Positioning and market sequence

### 12.1 Umbrella category

Long-term:

> Independent work assurance for AI agents.

Supporting promise:

> Use any agent or tool. RoleFlock controls what it may do and turns its output into
> reviewable evidence.

### 12.2 Initial wedge

Near-term public positioning remains:

> Independent delivery assurance for AI-generated software changes.

This preserves a clear buyer, artifact, workflow, and proof standard while the product earns
the right to expand.

### 12.3 Second vertical

After the coding beta reaches reliable activation:

> Verified Web Intelligence — structured internet research with field-level provenance,
> independent verification, visible coverage, and refreshable passports.

Potential buyers include:

- venture and corporate-venture research teams;
- market-intelligence and research agencies;
- investment and due-diligence teams;
- procurement and vendor-intelligence teams;
- competitive-intelligence teams;
- data operations teams building maintained reference datasets.

Generic consumer research is not the initial paid market. The strongest buyer is someone
whose analyst time, dataset trust, or downstream decision cost makes independent verification
valuable.

## 13. Business-model implications

The product can support:

- bring-your-own model and data-provider credentials;
- RoleFlock subscription for orchestration, assurance, templates, and local history;
- optional managed provider credits later;
- domain-pack subscriptions;
- team policy and trusted-runner plans;
- paid recurring dataset refresh workflows.

BYO credentials are attractive for the first beta because they reduce RoleFlock's variable
cost and preserve provider choice. The UI must still estimate and cap external API usage.

## 14. Implementation consequences

The current repository is still coding-specific. This direction is not implemented merely
because the assurance concepts generalise.

Required future work includes:

1. introduce a domain-neutral work-product identity alongside `resultCommit`;
2. define compatible `WorkContract` and `WorkPassport` envelopes;
3. add domain-pack registration and schema versioning;
4. separate model providers from tool/data providers;
5. add scoped network and API credential grants;
6. add search/query-plan nodes and rate/cost budgets;
7. add source, retrieval, and field-provenance stores;
8. add dataset versioning, entity resolution, and structured export;
9. add web-content prompt-injection isolation;
10. add data-policy, licence, retention, and personal-data controls;
11. add coverage and freshness verification;
12. extend role recommendations with research and tool-provider capability profiles;
13. generalise outcome observations beyond software defects and merges.

Coding-specific paths must remain stable while these abstractions are introduced.

## 15. Proposed validation plan

### D0 — Direction and architecture

- accept or revise this direction note;
- create an ADR for domain-neutral work assurance;
- define compatibility boundaries with ADR-014 through ADR-019;
- select one narrow design-partner problem.

### D1 — Indonesian startup dataset spike

- fixed schema and source frame;
- public-web sources plus one user-provided SERP API;
- 100 stratified candidate entities for the pilot;
- CSV and JSON export;
- field-level source references;
- deterministic unknown/conflict handling;
- manual verifier review.

The pilot is a validation set, not a claim to cover every Indonesian startup.

### D2 — Provider and provenance foundation

- tool-provider registry;
- credential scopes and quota visibility;
- query-plan artifact;
- source retrieval records and digests;
- provenance graph;
- cost and rate controls.

### D3 — Independent dataset verification

- frozen verification specification;
- independent verifier invocation;
- field sampling and authoritative-source rules;
- entity-duplicate and contradiction checks;
- coverage and freshness audit.

### D4 — Product workflow

- Web Intelligence domain pack;
- guided contract intake;
- recommended role/tool roster;
- run monitoring;
- conflict review;
- version comparison;
- dataset passport and exports.

### D5 — Design-partner beta

- 5–10 research or investment teams;
- repeated monthly refresh;
- measure analyst review time, verified-field rate, correction rate, cost, and reuse;
- determine whether the product is trusted enough to replace spreadsheet-first research.

## 16. Pilot acceptance criteria

The first Web Intelligence pilot succeeds when:

- every accepted entity has discovery provenance;
- every required field has a status and source references or is explicitly `unknown`;
- no unsupported value is silently fabricated;
- entity merges are reviewable and reversible;
- high-impact sampled fields satisfy the approved source rule;
- conflicts remain visible until resolved or accepted as unresolved;
- dataset, query plan, schema, sources, and verification are hash-bound;
- provider credentials are scoped and never exposed to model output;
- cost and query budgets fail closed;
- a second run can explain what changed and why;
- a reviewer can reject or accept the dataset without replaying the entire research process.

## 17. Non-goals

RoleFlock is not:

- a proprietary foundation model;
- a general-purpose search engine;
- a replacement for every data vendor;
- a CAPTCHA or paywall bypass service;
- an unrestricted web scraper;
- a guarantee that the open web is complete or correct;
- a generic chat interface for one-off questions;
- a multi-agent demo whose primary value is the number of agents.

Its value is the governed path from delegated intent to accepted, evidence-backed work.
