export type KnowledgeItem = {
  id: string;
  projectId?: string;
  type: string;
  title: string;
  body: string;
  state: string;
  provenance?: string;
  createdAt: string;
};

export type DisclosureGrant = {
  id: string;
  projectId: string;
  providerConnectionId: string;
  scope: Record<string, unknown>;
  createdAt: string;
  revokedAt?: string;
};

export type Task = {
  id: string;
  projectId?: string;
  title: string;
  type: string;
  state: string;
  risk: string;
  brief: string;
  maxAttempts: number;
  maxActualCostUsd?: number;
  workflowGraphVersionId: string;
  expectedBehaviour?: string;
  actualBehaviour?: string;
  verificationCommand?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ContractQuestion = {
  id: string;
  question: string;
  blocking: boolean;
  status: 'open' | 'resolved' | 'waived';
  resolution?: string;
  resolvedBy?: string;
  resolvedAt?: string;
};

export type ChangeContract = {
  id: string;
  taskId: string;
  projectId: string;
  repositoryId: string;
  version: number;
  parentVersionId?: string;
  changeReason?: string;
  status:
    | 'draft'
    | 'needs_clarification'
    | 'awaiting_authorisation'
    | 'authorised'
    | 'superseded'
    | 'withdrawn';
  objective: string;
  acceptanceCriteria: Array<{
    id: string;
    statement: string;
    verificationType: string;
    requiredEvidenceIds: string[];
  }>;
  prohibitedOutcomes: Array<{
    id: string;
    statement: string;
    severity: string;
  }>;
  outOfScope: string[];
  risk: string;
  requiredEvidence: Array<{
    id: string;
    type: string;
    description: string;
    mandatory: boolean;
  }>;
  authoritySources: Array<{
    id: string;
    kind: string;
    locator: string;
    digest: string;
    title?: string;
  }>;
  unresolvedQuestions: ContractQuestion[];
  draftedBy: string;
  authorisedBy?: string;
  authorisedAt?: string;
  createdAt: string;
  hashAlgorithm: 'sha256';
  hash: string;
};

export type ChangeContractAggregate = {
  id: string;
  taskId: string;
  projectId: string;
  repositoryId: string;
  currentContractVersion: number;
  currentVersionId: string;
  currentHash: string;
  status: ChangeContract['status'];
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ChangeContractResponse = {
  aggregate: ChangeContractAggregate;
  contract: ChangeContract;
  replayed?: boolean;
};

export type ChangeContractVersionsResponse = {
  aggregate: ChangeContractAggregate;
  versions: Array<{ versionId: string; contract: ChangeContract }>;
};

export type Project = {
  id: string;
  name: string;
  resolvedPath: string;
  status: string;
};

export type ActiveExecution = {
  phase: string;
  roleDisplayName: string;
  providerDisplayName: string;
  configuredModelDisplayName: string;
  effort?: string;
  permissionProfileId: string;
  currentActivity?: string;
  activeTool?: string;
  activeCommandPreview?: string;
  liveOutput?: string;
  reasoningChars?: number;
  previousTurn?: {
    roleDisplayName: string;
    providerDisplayName: string;
    configuredModelDisplayName: string;
    liveOutput: string;
  };
  liveDiff?: {
    patch: string;
    status: string;
    changedFiles: string[];
    added: number;
    removed: number;
  };
  lastHeartbeatAt: string;
  attempt: number;
  actualCost?: number;
  shadowCost?: number;
  inputTokens?: number;
  outputTokens?: number;
  usageConfidence?: string;
};

export type Approval = {
  id: string;
  taskId?: string;
  requestType: string;
  rationale: string;
  riskClass: string;
  fingerprint: string;
};

export type TaskDocument = {
  id: string;
  fileName: string;
  kind: string;
  authority: string;
  sha256: string;
  byteSize: number;
  hasExtractedText?: boolean;
  extractedTextPreview?: string;
  createdAt: string;
};

export type Provider = {
  id: string;
  displayName: string;
  status: string;
  connectionType?: string;
  health?: { status: string; detail?: string };
  capabilities: Record<string, boolean>;
  account?: {
    loggedIn: boolean;
    email?: string;
    label?: string;
    authMethod?: string;
    subscriptionType?: string;
    orgName?: string;
    supportsLogin: boolean;
    supportsSwitch: boolean;
    detail?: string;
    usageLinks?: Array<{ id: string; label: string; url: string; hint?: string }>;
    commandHints?: { login: string; logout: string; switch: string };
  };
  localUsage?: {
    entryCount: number;
    inputTokens: number;
    outputTokens: number;
    models: Array<{
      providerConnectionId: string;
      modelId: string;
      inputTokens: number;
      outputTokens: number;
      entryCount: number;
    }>;
    note: string;
  };
};

export type EvidenceBundle = {
  findings: Array<Record<string, unknown>>;
  testRuns: Array<Record<string, unknown>>;
  artefacts: Array<Record<string, unknown>>;
  disclosures: Array<Record<string, unknown>>;
};

export type Usage = {
  scope?: string;
  note?: string;
  entries?: Array<Record<string, unknown>>;
  summary?: {
    actualCostUsd?: number;
    shadowCostUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
    budget?: {
      remainingUsd?: number;
      warning?: boolean;
      hardStop?: boolean;
      maxActualCostUsd?: number;
    };
  };
};

export type Workflow = {
  id: string;
  version?: string;
  label: string;
  description: string;
  roles?: string[];
};

/** Read-only projection of a graph run, from `/api/tasks/:id/graph`. */
export type BlockedRun = {
  role: string;
  reason: string;
  resumable: boolean;
  refusals: Array<{
    providerId: string;
    providerDisplayName: string;
    modelId: string;
    modelDisplayName: string;
    reason: string;
    detail: string;
    /** When the candidate becomes eligible again. Absent if it never ran. */
    until?: string;
  }>;
};

export type GraphRunView = {
  taskId: string;
  graphRunId: string | null;
  runState: string;
  /** Set when the run stopped because no configured provider would answer. */
  blocked: BlockedRun | null;
  graph: {
    id: string;
    version: string;
    label: string;
    description: string;
    maxConcurrency: number;
    maxLoopIterations: number;
    edges: Array<{ from: string; to: string; when: string }>;
    nodes: Array<{
      id: string;
      role: string;
      kind: string;
      dependsOn: string[];
      required: boolean;
      writer: boolean;
      maxAttempts: number;
      focus: string | null;
      primaryProviderId: string | null;
      primaryProviderDisplayName: string | null;
      primaryModelId: string | null;
      primaryModelDisplayName: string | null;
      state: string;
      outcome: string | null;
      startedAt: string | null;
      completedAt: string | null;
      attempts: number;
    }>;
  };
};

export type TaskWorkspace =
  | { available: false }
  | {
      available: true;
      path: string;
      inPlace: boolean;
      branchName: string;
      baseCommit: string;
      headCommit: string;
      headSubject: string;
      writerLeaseActive: boolean;
      worktreeStatus: string;
      remote: string | null;
      ahead: number;
      behind: number;
      files: Array<{
        path: string;
        indexStatus: string;
        worktreeStatus: string;
        added: number;
        removed: number;
      }>;
      patch: string;
      stagedPatch: string;
    };

export type TaskFileDiff = {
  path: string;
  staged: boolean;
  patch: string;
  added: number;
  removed: number;
  binary: boolean;
};

export type RoleCandidateView = {
  providerId: string;
  modelId: string;
  effort?: string;
  enabled: boolean;
  /** ISO timestamp when a parked candidate becomes eligible again. */
  coolingDownUntil?: string;
};

export type RoleView = {
  id: string;
  label: string;
  description: string;
  candidates: RoleCandidateView[];
};

export type ProviderCatalogue = {
  providerId: string;
  displayName: string;
  status: string;
  models: Array<{ id: string; displayName: string; effort?: string; family?: string }>;
};

export type RolesResponse = {
  roles: RoleView[];
  providers: ProviderCatalogue[];
  efforts: string[];
  cooldowns: Array<{
    providerConnectionId: string;
    modelId: string;
    reason: string;
    detail?: string;
    until: string;
  }>;
};
