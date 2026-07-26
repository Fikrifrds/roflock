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
  activeCommandPreview?: string;
  lastHeartbeatAt: string;
  attempt: number;
  actualCost?: number;
  shadowCost?: number;
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
    actualCostUsd: number;
    shadowCostUsd: number;
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
export type GraphRunView = {
  taskId: string;
  graphRunId: string | null;
  runState: string;
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
      state: string;
      outcome: string | null;
      startedAt: string | null;
      completedAt: string | null;
      attempts: number;
    }>;
  };
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
