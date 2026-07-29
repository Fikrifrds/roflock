import { ROLE_IDS, type RoleId } from '@roleflock/role-protocol';
import { z } from 'zod';

export const INDEPENDENCE_PROPERTIES = [
  'separate_invocation',
  'different_model',
  'different_model_family',
  'different_provider',
  'different_runner',
] as const;
export const IndependencePropertySchema = z.enum(INDEPENDENCE_PROPERTIES);
export type IndependenceProperty = z.infer<typeof IndependencePropertySchema>;

export const IndependenceRequirementSchema = z
  .object({
    leftRole: z.enum(ROLE_IDS),
    rightRole: z.enum(ROLE_IDS),
    property: IndependencePropertySchema,
    level: z.enum(['required', 'preferred']),
    source: z.enum(['risk_default', 'organisation_policy', 'task_policy']),
  })
  .strict()
  .refine((requirement) => requirement.leftRole !== requirement.rightRole, {
    message: 'Independence requires two distinct roles',
  });
export type IndependenceRequirement = z.infer<typeof IndependenceRequirementSchema>;

export interface ProposedRoleAssignment {
  role: RoleId;
  providerId: string;
  modelId: string;
  modelFamily?: string;
  runnerId?: string;
  invocationScope: 'dedicated' | 'shared';
}

export interface IndependenceFinding {
  requirement: IndependenceRequirement;
  satisfied: boolean;
  known: boolean;
  reason: string;
}

export interface IndependenceDecision {
  eligible: boolean;
  findings: IndependenceFinding[];
  requiredViolations: IndependenceFinding[];
  preferredViolations: IndependenceFinding[];
}

export function defaultIndependenceRequirements(
  risk: 'low' | 'medium' | 'high' | 'critical',
  roles: readonly RoleId[],
): IndependenceRequirement[] {
  const requirements: IndependenceRequirement[] = [];
  const add = (
    leftRole: RoleId,
    rightRole: RoleId,
    property: IndependenceProperty,
    level: IndependenceRequirement['level'],
  ) => {
    if (!roles.includes(leftRole) || !roles.includes(rightRole)) return;
    requirements.push({
      leftRole,
      rightRole,
      property,
      level,
      source: 'risk_default',
    });
  };

  add('planner', 'executor', 'separate_invocation', 'required');
  add('executor', 'verifier', 'separate_invocation', 'required');
  if (risk === 'medium') {
    add('planner', 'plan_critic', 'different_model', 'preferred');
    add('executor', 'verifier', 'different_model', 'preferred');
  }
  if (risk === 'high') {
    add('planner', 'executor', 'different_model', 'preferred');
    add('planner', 'plan_critic', 'different_model_family', 'required');
    add('executor', 'verifier', 'different_model_family', 'required');
  }
  if (risk === 'critical') {
    add('planner', 'executor', 'different_model_family', 'required');
    add('planner', 'plan_critic', 'different_provider', 'preferred');
    add('executor', 'verifier', 'different_provider', 'required');
    add('executor', 'verifier', 'different_runner', 'required');
  }
  return requirements;
}

export function combineIndependenceRequirements(
  defaults: readonly IndependenceRequirement[],
  policy: readonly IndependenceRequirement[],
): IndependenceRequirement[] {
  const combined = new Map<string, IndependenceRequirement>();
  for (const raw of [...defaults, ...policy]) {
    const requirement = IndependenceRequirementSchema.parse(raw);
    const key = requirementKey(requirement);
    const existing = combined.get(key);
    if (!existing || existing.level === 'preferred' || requirement.level === 'required') {
      combined.set(key, {
        ...requirement,
        level:
          existing?.level === 'required' || requirement.level === 'required'
            ? 'required'
            : 'preferred',
      });
    }
  }
  return [...combined.values()].sort((left, right) =>
    requirementKey(left).localeCompare(requirementKey(right)),
  );
}

export function evaluateRosterIndependence(
  assignments: readonly ProposedRoleAssignment[],
  requirements: readonly IndependenceRequirement[],
): IndependenceDecision {
  const byRole = new Map(assignments.map((assignment) => [assignment.role, assignment]));
  const findings = requirements.map((raw) => {
    const requirement = IndependenceRequirementSchema.parse(raw);
    const left = byRole.get(requirement.leftRole);
    const right = byRole.get(requirement.rightRole);
    if (!left || !right) {
      return {
        requirement,
        satisfied: false,
        known: false,
        reason: `Required role assignment is missing: ${!left ? requirement.leftRole : requirement.rightRole}`,
      };
    }
    return evaluatePair(left, right, requirement);
  });
  const requiredViolations = findings.filter(
    (finding) => finding.requirement.level === 'required' && !finding.satisfied,
  );
  const preferredViolations = findings.filter(
    (finding) => finding.requirement.level === 'preferred' && !finding.satisfied,
  );
  return {
    eligible: requiredViolations.length === 0,
    findings,
    requiredViolations,
    preferredViolations,
  };
}

export function validateFallbackIndependence(input: {
  roster: readonly ProposedRoleAssignment[];
  replacement: ProposedRoleAssignment;
  requirements: readonly IndependenceRequirement[];
}): IndependenceDecision {
  const roster = [
    ...input.roster.filter((assignment) => assignment.role !== input.replacement.role),
    input.replacement,
  ];
  return evaluateRosterIndependence(roster, input.requirements);
}

function evaluatePair(
  left: ProposedRoleAssignment,
  right: ProposedRoleAssignment,
  requirement: IndependenceRequirement,
): IndependenceFinding {
  if (requirement.property === 'separate_invocation') {
    const satisfied = left.invocationScope === 'dedicated' && right.invocationScope === 'dedicated';
    return finding(
      requirement,
      satisfied,
      true,
      satisfied ? 'Roles use dedicated invocations' : 'One or both roles share an invocation',
    );
  }
  if (requirement.property === 'different_model') {
    const satisfied = left.providerId !== right.providerId || left.modelId !== right.modelId;
    return finding(
      requirement,
      satisfied,
      true,
      satisfied ? 'Model identities differ' : 'Model identities are the same',
    );
  }
  if (requirement.property === 'different_model_family') {
    if (!left.modelFamily || !right.modelFamily) {
      return finding(
        requirement,
        false,
        false,
        'Model family is unknown, so required separation cannot be proven',
      );
    }
    const satisfied = left.modelFamily !== right.modelFamily;
    return finding(
      requirement,
      satisfied,
      true,
      satisfied ? 'Model families differ' : 'Model families are the same',
    );
  }
  if (requirement.property === 'different_provider') {
    const satisfied = left.providerId !== right.providerId;
    return finding(
      requirement,
      satisfied,
      true,
      satisfied ? 'Providers differ' : 'Providers are the same',
    );
  }
  if (!left.runnerId || !right.runnerId) {
    return finding(
      requirement,
      false,
      false,
      'Runner identity is unknown, so required separation cannot be proven',
    );
  }
  const satisfied = left.runnerId !== right.runnerId;
  return finding(
    requirement,
    satisfied,
    true,
    satisfied ? 'Runner identities differ' : 'Runner identities are the same',
  );
}

function finding(
  requirement: IndependenceRequirement,
  satisfied: boolean,
  known: boolean,
  reason: string,
): IndependenceFinding {
  return { requirement, satisfied, known, reason };
}

function requirementKey(requirement: IndependenceRequirement): string {
  const roles = [requirement.leftRole, requirement.rightRole].sort().join(':');
  return `${roles}:${requirement.property}`;
}
