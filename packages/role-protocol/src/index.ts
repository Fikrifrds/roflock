export const ROLE_IDS = [
  'contract_planner',
  'contract_authority',
  'planner',
  'plan_critic',
  'plan_approver',
  'executor',
  'test_runner',
  'verifier',
  'release_approver',
] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export const ARTIFACT_KINDS = [
  'authority_source',
  'change_contract',
  'contract_decision',
  'contract_rejection',
  'execution_plan',
  'plan_critique',
  'plan_approval',
  'verification_specification',
  'execution_report',
  'plan_deviation',
  'test_attestation',
  'verification_finding',
  'verification_verdict',
  'review_packet',
  'change_passport',
  'feedback_item',
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const ACTION_CLASSES = [
  'artifact_read',
  'repository_read',
  'repository_write',
  'run_readonly_command',
  'run_mutating_command',
  'network_access',
  'contract_draft',
  'contract_authorise',
  'contract_reject',
  'plan_publish',
  'plan_revise',
  'plan_critique',
  'plan_approve',
  'plan_reject',
  'execute_plan_step',
  'emit_deviation',
  'verification_execute',
  'verification_specify',
  'verification_assess',
  'emit_finding',
  'direct_executor',
  'feedback_classify',
  'acceptance_decide',
  'passport_issue',
] as const;
export type StructuredActionClass = (typeof ACTION_CLASSES)[number];

export type DecisionClass =
  | 'contract_meaning'
  | 'contract_authorisation'
  | 'implementation_design'
  | 'plan_quality'
  | 'plan_authorisation'
  | 'implementation_execution'
  | 'verification_capture'
  | 'verification_assessment'
  | 'release_acceptance';

export type ArtifactRequirement = {
  kind: ArtifactKind;
  statuses?: readonly string[];
  hashRequired: boolean;
  minimum: number;
};

export type ArtifactPredicate = {
  kind: ArtifactKind;
  statuses?: readonly string[];
  hashRequired: boolean;
};

export type PermissionProfile = {
  repository: 'none' | 'read' | 'planned_write';
  commands: 'none' | 'readonly' | 'approved';
  network: 'none' | 'approved';
  credentials: 'none' | 'scoped';
};

export type RoleAuthorityContract = {
  role: RoleId;
  purpose: string;
  requiredInputs: readonly ArtifactRequirement[];
  requiredOutputs: readonly ArtifactRequirement[];
  allowedActions: readonly StructuredActionClass[];
  forbiddenActions: readonly StructuredActionClass[];
  ownedDecisions: readonly DecisionClass[];
  escalationTargets: readonly RoleId[];
  completionCriteria: readonly ArtifactPredicate[];
  permissionProfile: PermissionProfile;
};

export type PresentedArtifact = {
  id: string;
  kind: ArtifactKind;
  status?: string;
  hash?: string;
  valid: boolean;
  current: boolean;
};

export type ProtocolViolationCode =
  | 'ROLE_UNKNOWN'
  | 'ACTION_NOT_ALLOWED'
  | 'ACTION_FORBIDDEN'
  | 'REQUIRED_INPUT_MISSING'
  | 'REQUIRED_INPUT_INVALID'
  | 'REQUIRED_OUTPUT_MISSING'
  | 'REQUIRED_OUTPUT_INVALID';

export class RoleProtocolViolation extends Error {
  constructor(
    readonly code: ProtocolViolationCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'RoleProtocolViolation';
  }
}

const artifact = (
  kind: ArtifactKind,
  options: Partial<Omit<ArtifactRequirement, 'kind'>> = {},
): ArtifactRequirement => ({
  kind,
  minimum: options.minimum ?? 1,
  hashRequired: options.hashRequired ?? true,
  ...(options.statuses === undefined ? {} : { statuses: options.statuses }),
});

const profile = (
  repository: PermissionProfile['repository'],
  commands: PermissionProfile['commands'],
  network: PermissionProfile['network'] = 'none',
  credentials: PermissionProfile['credentials'] = 'none',
): PermissionProfile => ({ repository, commands, network, credentials });

export const ROLE_AUTHORITY_MATRIX: Readonly<Record<RoleId, RoleAuthorityContract>> = Object.freeze(
  {
    contract_planner: {
      role: 'contract_planner',
      purpose: 'Compile authority sources into a draft Change Contract.',
      requiredInputs: [artifact('authority_source', { hashRequired: true })],
      requiredOutputs: [
        artifact('change_contract', {
          statuses: ['draft', 'needs_clarification', 'awaiting_authorisation'],
        }),
      ],
      allowedActions: ['artifact_read', 'contract_draft'],
      forbiddenActions: [
        'repository_write',
        'contract_authorise',
        'plan_publish',
        'execute_plan_step',
        'acceptance_decide',
      ],
      ownedDecisions: ['contract_meaning'],
      escalationTargets: ['contract_authority'],
      completionCriteria: [
        artifact('change_contract', {
          statuses: ['draft', 'needs_clarification', 'awaiting_authorisation'],
        }),
      ],
      permissionProfile: profile('none', 'none'),
    },
    contract_authority: {
      role: 'contract_authority',
      purpose: 'Authorise or reject the exact Change Contract version.',
      requiredInputs: [
        artifact('change_contract', {
          statuses: ['awaiting_authorisation'],
        }),
      ],
      requiredOutputs: [artifact('contract_decision', { statuses: ['authorised', 'rejected'] })],
      allowedActions: ['artifact_read', 'contract_authorise', 'contract_reject'],
      forbiddenActions: ['repository_write', 'plan_publish', 'execute_plan_step'],
      ownedDecisions: ['contract_authorisation'],
      escalationTargets: [],
      completionCriteria: [artifact('contract_decision', { statuses: ['authorised', 'rejected'] })],
      permissionProfile: profile('none', 'none'),
    },
    planner: {
      role: 'planner',
      purpose: 'Own implementation decisions and publish versioned Execution Plans.',
      requiredInputs: [artifact('change_contract', { statuses: ['authorised'] })],
      requiredOutputs: [
        artifact('execution_plan', {
          statuses: ['proposed', 'approved'],
        }),
      ],
      allowedActions: [
        'artifact_read',
        'repository_read',
        'run_readonly_command',
        'plan_publish',
        'plan_revise',
        'verification_specify',
        'feedback_classify',
      ],
      forbiddenActions: [
        'repository_write',
        'run_mutating_command',
        'contract_authorise',
        'plan_approve',
        'execute_plan_step',
        'verification_assess',
        'acceptance_decide',
      ],
      ownedDecisions: ['implementation_design'],
      escalationTargets: ['contract_authority', 'plan_critic', 'plan_approver'],
      completionCriteria: [
        artifact('execution_plan', {
          statuses: ['proposed', 'approved'],
        }),
      ],
      permissionProfile: profile('read', 'readonly'),
    },
    plan_critic: {
      role: 'plan_critic',
      purpose: 'Challenge plan completeness and safety without rewriting it.',
      requiredInputs: [
        artifact('change_contract', { statuses: ['authorised'] }),
        artifact('execution_plan', { statuses: ['proposed'] }),
      ],
      requiredOutputs: [artifact('plan_critique')],
      allowedActions: ['artifact_read', 'repository_read', 'plan_critique'],
      forbiddenActions: [
        'repository_write',
        'plan_publish',
        'plan_revise',
        'plan_approve',
        'direct_executor',
        'execute_plan_step',
      ],
      ownedDecisions: ['plan_quality'],
      escalationTargets: ['planner', 'plan_approver'],
      completionCriteria: [artifact('plan_critique')],
      permissionProfile: profile('read', 'none'),
    },
    plan_approver: {
      role: 'plan_approver',
      purpose: 'Approve or reject an exact plan hash.',
      requiredInputs: [
        artifact('change_contract', { statuses: ['authorised'] }),
        artifact('execution_plan', { statuses: ['proposed'] }),
        artifact('plan_critique'),
      ],
      requiredOutputs: [artifact('plan_approval')],
      allowedActions: ['artifact_read', 'plan_approve', 'plan_reject'],
      forbiddenActions: ['repository_write', 'plan_publish', 'plan_revise', 'execute_plan_step'],
      ownedDecisions: ['plan_authorisation'],
      escalationTargets: ['planner'],
      completionCriteria: [artifact('plan_approval')],
      permissionProfile: profile('none', 'none'),
    },
    executor: {
      role: 'executor',
      purpose: 'Execute only the exact approved plan in its leased workspace.',
      requiredInputs: [
        artifact('change_contract', { statuses: ['authorised'] }),
        artifact('execution_plan', { statuses: ['approved'] }),
        artifact('verification_specification', { statuses: ['approved'] }),
      ],
      requiredOutputs: [artifact('execution_report')],
      allowedActions: [
        'artifact_read',
        'repository_read',
        'repository_write',
        'run_mutating_command',
        'execute_plan_step',
        'emit_deviation',
      ],
      forbiddenActions: [
        'contract_authorise',
        'plan_publish',
        'plan_revise',
        'plan_approve',
        'verification_specify',
        'verification_assess',
        'feedback_classify',
        'acceptance_decide',
      ],
      ownedDecisions: ['implementation_execution'],
      escalationTargets: ['planner'],
      completionCriteria: [artifact('execution_report')],
      permissionProfile: profile('planned_write', 'approved', 'approved', 'scoped'),
    },
    test_runner: {
      role: 'test_runner',
      purpose: 'Execute frozen verification commands and capture deterministic evidence.',
      requiredInputs: [
        artifact('execution_plan', { statuses: ['approved'] }),
        artifact('verification_specification', { statuses: ['approved'] }),
        artifact('execution_report'),
      ],
      requiredOutputs: [artifact('test_attestation')],
      allowedActions: ['artifact_read', 'repository_read', 'verification_execute'],
      forbiddenActions: [
        'repository_write',
        'plan_revise',
        'verification_specify',
        'verification_assess',
        'direct_executor',
      ],
      ownedDecisions: ['verification_capture'],
      escalationTargets: ['verifier'],
      completionCriteria: [artifact('test_attestation')],
      permissionProfile: profile('read', 'approved', 'approved'),
    },
    verifier: {
      role: 'verifier',
      purpose: 'Assess independent evidence against contract criteria.',
      requiredInputs: [
        artifact('change_contract', { statuses: ['authorised'] }),
        artifact('execution_plan', { statuses: ['approved'] }),
        artifact('verification_specification', { statuses: ['approved'] }),
        artifact('execution_report'),
        artifact('test_attestation'),
      ],
      requiredOutputs: [artifact('verification_verdict')],
      allowedActions: ['artifact_read', 'repository_read', 'verification_assess', 'emit_finding'],
      forbiddenActions: [
        'repository_write',
        'plan_publish',
        'plan_revise',
        'execute_plan_step',
        'direct_executor',
        'acceptance_decide',
      ],
      ownedDecisions: ['verification_assessment'],
      escalationTargets: ['planner', 'release_approver'],
      completionCriteria: [artifact('verification_verdict')],
      permissionProfile: profile('read', 'none'),
    },
    release_approver: {
      role: 'release_approver',
      purpose: 'Make the final acceptance decision from the review packet.',
      requiredInputs: [
        artifact('review_packet'),
        artifact('change_passport'),
        artifact('verification_verdict', { statuses: ['pass', 'conditional'] }),
      ],
      requiredOutputs: [artifact('change_passport', { statuses: ['accepted'] })],
      allowedActions: ['artifact_read', 'acceptance_decide', 'passport_issue'],
      forbiddenActions: [
        'repository_write',
        'plan_publish',
        'execute_plan_step',
        'verification_assess',
      ],
      ownedDecisions: ['release_acceptance'],
      escalationTargets: ['planner', 'contract_authority'],
      completionCriteria: [artifact('change_passport', { statuses: ['accepted'] })],
      permissionProfile: profile('none', 'none'),
    },
  } satisfies Record<RoleId, RoleAuthorityContract>,
);

function requirementViolations(
  requirement: ArtifactRequirement,
  presented: readonly PresentedArtifact[],
  phase: 'input' | 'output',
): RoleProtocolViolation | undefined {
  const candidates = presented.filter((candidate) => candidate.kind === requirement.kind);
  if (candidates.length < requirement.minimum) {
    return new RoleProtocolViolation(
      phase === 'input' ? 'REQUIRED_INPUT_MISSING' : 'REQUIRED_OUTPUT_MISSING',
      `Required ${phase} is missing: ${requirement.kind}`,
      { kind: requirement.kind, minimum: requirement.minimum, actual: candidates.length },
    );
  }
  const usable = candidates.filter(
    (candidate) =>
      candidate.valid &&
      candidate.current &&
      (!requirement.hashRequired || candidate.hash !== undefined) &&
      (requirement.statuses === undefined ||
        (candidate.status !== undefined && requirement.statuses.includes(candidate.status))),
  );
  if (usable.length < requirement.minimum) {
    return new RoleProtocolViolation(
      phase === 'input' ? 'REQUIRED_INPUT_INVALID' : 'REQUIRED_OUTPUT_INVALID',
      `Required ${phase} is stale, invalid, unhashed, or in the wrong state: ${requirement.kind}`,
      {
        kind: requirement.kind,
        acceptedStatuses: requirement.statuses,
        minimum: requirement.minimum,
        usable: usable.length,
      },
    );
  }
  return undefined;
}

export function getRoleAuthorityContract(role: RoleId): RoleAuthorityContract {
  const contract = ROLE_AUTHORITY_MATRIX[role];
  if (contract === undefined) {
    throw new RoleProtocolViolation('ROLE_UNKNOWN', `Unknown role: ${String(role)}`);
  }
  return contract;
}

export function assertRoleAction(role: RoleId, action: StructuredActionClass): void {
  const contract = getRoleAuthorityContract(role);
  if (contract.forbiddenActions.includes(action)) {
    throw new RoleProtocolViolation(
      'ACTION_FORBIDDEN',
      `${role} is forbidden from performing ${action}`,
      { role, action },
    );
  }
  if (!contract.allowedActions.includes(action)) {
    throw new RoleProtocolViolation(
      'ACTION_NOT_ALLOWED',
      `${role} has no authority to perform ${action}`,
      { role, action },
    );
  }
}

export function assertRoleStart(role: RoleId, inputs: readonly PresentedArtifact[]): void {
  for (const requirement of getRoleAuthorityContract(role).requiredInputs) {
    const violation = requirementViolations(requirement, inputs, 'input');
    if (violation !== undefined) throw violation;
  }
  if (role === 'executor' && inputs.some((input) => input.kind === 'feedback_item')) {
    throw new RoleProtocolViolation(
      'ACTION_FORBIDDEN',
      'Executor cannot consume raw stakeholder feedback',
      { role, artifactKind: 'feedback_item' },
    );
  }
}

export function assertRoleCompletion(role: RoleId, outputs: readonly PresentedArtifact[]): void {
  for (const requirement of getRoleAuthorityContract(role).requiredOutputs) {
    const violation = requirementViolations(requirement, outputs, 'output');
    if (violation !== undefined) throw violation;
  }
}

export function validateAuthorityMatrix(): void {
  for (const role of ROLE_IDS) {
    const contract = ROLE_AUTHORITY_MATRIX[role];
    const allowed = new Set(contract.allowedActions);
    const overlap = contract.forbiddenActions.find((action) => allowed.has(action));
    if (overlap !== undefined) {
      throw new Error(`${role} both allows and forbids ${overlap}`);
    }
    if (
      contract.permissionProfile.repository !== 'planned_write' &&
      allowed.has('repository_write')
    ) {
      throw new Error(`${role} allows repository writes without a planned-write profile`);
    }
    if (
      role !== 'executor' &&
      (allowed.has('plan_revise') || allowed.has('plan_publish')) &&
      role !== 'planner'
    ) {
      throw new Error(`${role} illegally owns plan mutation`);
    }
  }
}

validateAuthorityMatrix();
