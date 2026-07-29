import { sha256Canonical } from '@roleflock/contracts';
import type { Effort } from '@roleflock/provider-core';
import type { RoleId } from '@roleflock/role-protocol';
import { z } from 'zod';
import {
  evaluateHardConstraints,
  type CandidateRuntimeState,
  type HardConstraintDecision,
  type HardConstraintPolicy,
  type RoleRequirementProfile,
} from './hard-constraints.js';
import {
  defaultIndependenceRequirements,
  evaluateRosterIndependence,
  type IndependenceDecision,
  type ProposedRoleAssignment,
} from './independence.js';
import { ROLE_SCORING_VERSION, scoreRoleCandidates, type RoleCandidateScore } from './scorer.js';

export const RECOMMENDATION_VERSION = 'role-recommendation-1.0.0';
export const RECOMMENDED_ROLES = ['planner', 'plan_critic', 'executor', 'verifier'] as const;
export type RecommendedRole = (typeof RECOMMENDED_ROLES)[number];

const RecommendationCandidateSchema = z
  .object({
    role: z.enum(RECOMMENDED_ROLES),
    providerId: z.string().trim().min(1),
    modelId: z.string().trim().min(1),
    modelFamily: z.string().trim().min(1).optional(),
    runnerId: z.string().trim().min(1).optional(),
    effort: z.string().trim().min(1),
    rank: z.number().int().positive().optional(),
    selected: z.boolean(),
    fallback: z.boolean(),
    eligible: z.boolean(),
    score: z.number().min(0).max(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
    profileVersion: z.string().trim().min(1),
    rationale: z.array(z.string()),
    knownGaps: z.array(z.string()),
    violations: z.array(
      z
        .object({
          code: z.string(),
          field: z.string(),
          reason: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export type RecommendationCandidate = z.infer<typeof RecommendationCandidateSchema>;

export const RoleRecommendationSchema = z
  .object({
    id: z.string().trim().min(1),
    taskId: z.string().trim().min(1),
    recommendationVersion: z.literal(RECOMMENDATION_VERSION),
    risk: z.enum(['low', 'medium', 'high', 'critical']),
    profileBundleVersion: z.string().trim().min(1),
    profileBundleDigest: z.string().regex(/^[a-f0-9]{64}$/),
    scoringVersion: z.literal(ROLE_SCORING_VERSION),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/),
    complete: z.boolean(),
    requiredRoles: z.array(z.enum(RECOMMENDED_ROLES)),
    candidates: z.array(RecommendationCandidateSchema),
    independence: z.array(
      z
        .object({
          leftRole: z.string(),
          rightRole: z.string(),
          property: z.string(),
          level: z.enum(['required', 'preferred']),
          satisfied: z.boolean(),
          known: z.boolean(),
          reason: z.string(),
        })
        .strict(),
    ),
    gaps: z.array(z.string()),
    generatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type RoleRecommendation = z.infer<typeof RoleRecommendationSchema>;

export interface RecommendationRuntimeCandidate extends CandidateRuntimeState {
  availabilityConfidence: number;
  runnerId?: string;
  runnerIds?: Partial<Record<RecommendedRole, string>>;
}

interface EvaluatedCandidate {
  runtime: RecommendationRuntimeCandidate;
  hard: HardConstraintDecision;
  score?: RoleCandidateScore;
}

export function roleRequirementsForRisk(
  risk: RoleRecommendation['risk'],
): Record<RecommendedRole, RoleRequirementProfile> {
  const executorMinimum = risk === 'low' ? 0.36 : risk === 'medium' ? 0.4 : 0.44;
  const verifierMinimum = risk === 'critical' ? 0.45 : risk === 'high' ? 0.42 : 0.36;
  return {
    planner: requirement('planner', {
      traits: { planning_depth: 0.36, instruction_adherence: 0.34 },
      weights: {
        planning_depth: 5,
        instruction_adherence: 4,
        repository_navigation: 3,
        long_context: 3,
        test_reasoning: 1,
        cost_efficiency: 1,
      },
      permission: 'read',
      effort: risk === 'low' ? 'medium' : 'high',
    }),
    plan_critic: requirement('plan_critic', {
      traits: { critical_review: risk === 'critical' ? 0.45 : 0.35 },
      weights: {
        critical_review: 5,
        test_reasoning: 3,
        security_reasoning: risk === 'critical' ? 4 : 2,
        instruction_adherence: 2,
        cost_efficiency: 1,
      },
      permission: 'read',
      effort: risk === 'low' ? 'medium' : 'high',
    }),
    executor: requirement('executor', {
      traits: {
        instruction_adherence: executorMinimum,
        patch_precision: executorMinimum,
      },
      weights: {
        implementation_strength: 5,
        instruction_adherence: 5,
        patch_precision: 4,
        repository_navigation: 3,
        tool_reliability: 3,
        test_reasoning: 2,
        cost_efficiency: 1,
      },
      permission: 'planned_write',
      effort: risk === 'low' ? 'medium' : 'high',
      writes: true,
    }),
    verifier: requirement('verifier', {
      traits: {
        test_reasoning: verifierMinimum,
        critical_review: verifierMinimum,
      },
      weights: {
        test_reasoning: 5,
        critical_review: 5,
        instruction_adherence: 3,
        security_reasoning: risk === 'critical' ? 4 : 2,
        long_context: 1,
        cost_efficiency: 1,
      },
      permission: 'read',
      effort: risk === 'low' ? 'medium' : 'high',
    }),
  };
}

export function generateRoleRecommendation(input: {
  id: string;
  taskId: string;
  risk: RoleRecommendation['risk'];
  profileBundleVersion: string;
  profileBundleDigest: string;
  candidates: readonly RecommendationRuntimeCandidate[];
  policy: HardConstraintPolicy;
  generatedAt: string;
}): RoleRecommendation {
  const requirements = roleRequirementsForRisk(input.risk);
  const requiredRoles: RecommendedRole[] =
    input.risk === 'low'
      ? ['planner', 'executor', 'verifier']
      : ['planner', 'plan_critic', 'executor', 'verifier'];
  const independenceRequirements = defaultIndependenceRequirements(
    input.risk,
    requiredRoles as RoleId[],
  );
  const evaluated = new Map<RecommendedRole, EvaluatedCandidate[]>();

  for (const role of RECOMMENDED_ROLES) {
    const requirement = requirements[role];
    const constrained = input.candidates.map((runtime) => {
      const hard = evaluateHardConstraints({
        candidate: runtime,
        requirement,
        policy: input.policy,
      });
      return { runtime, hard };
    });
    const scores = scoreRoleCandidates({
      requirement,
      candidates: constrained.map(({ runtime, hard }) => ({
        profile: runtime.profile,
        hardConstraintDecision: hard,
        availabilityConfidence: runtime.availabilityConfidence,
      })),
    });
    const scoreByCandidate = new Map(
      scores.map((score) => [`${score.providerId}/${score.modelId}`, score]),
    );
    const candidates = constrained.map(({ runtime, hard }) => ({
      runtime,
      hard,
      score: scoreByCandidate.get(`${runtime.profile.providerId}/${runtime.profile.modelId}`),
    }));
    candidates.sort(compareEvaluated);
    evaluated.set(role, candidates);
  }

  const selected = selectRoster(requiredRoles, evaluated, independenceRequirements);
  const selectedAssignments = selected.map(({ role, candidate }) =>
    assignmentFor(role, candidate.runtime),
  );
  const independenceDecision =
    selected.length === requiredRoles.length
      ? evaluateRosterIndependence(selectedAssignments, independenceRequirements)
      : undefined;
  const selectedKeys = new Set(
    selected.map(({ role, candidate }) => candidateKey(role, candidate.runtime)),
  );
  const fallbackKeys = selectSafeFallbacks(
    requiredRoles,
    selected,
    evaluated,
    independenceRequirements,
  );
  const candidates: RecommendationCandidate[] = [];

  for (const role of RECOMMENDED_ROLES) {
    const chosenForRole = selected.find((entry) => entry.role === role)?.candidate;
    for (const evaluatedCandidate of evaluated.get(role) ?? []) {
      const key = candidateKey(role, evaluatedCandidate.runtime);
      const isSelected = selectedKeys.has(key);
      const fallback = fallbackKeys.has(key);
      let independence: IndependenceDecision | undefined;
      if (
        !isSelected &&
        chosenForRole &&
        evaluatedCandidate.hard.eligible &&
        requiredRoles.includes(role)
      ) {
        independence = evaluateRosterIndependence(
          [
            ...selectedAssignments.filter((assignment) => assignment.role !== role),
            assignmentFor(role, evaluatedCandidate.runtime),
          ],
          independenceRequirements,
        );
      }
      const runnerId =
        evaluatedCandidate.runtime.runnerIds?.[role] ?? evaluatedCandidate.runtime.runnerId;
      const score = evaluatedCandidate.score;
      candidates.push({
        role,
        providerId: evaluatedCandidate.runtime.profile.providerId,
        modelId: evaluatedCandidate.runtime.profile.modelId,
        ...(evaluatedCandidate.runtime.profile.modelFamily
          ? { modelFamily: evaluatedCandidate.runtime.profile.modelFamily }
          : {}),
        ...(runnerId ? { runnerId } : {}),
        effort: requirements[role].requiredEffort ?? 'medium',
        ...(score ? { rank: score.rank, score: score.score, confidence: score.confidence } : {}),
        selected: isSelected,
        fallback,
        eligible: evaluatedCandidate.hard.eligible && (independence?.eligible ?? true),
        profileVersion: evaluatedCandidate.runtime.profile.profileVersion,
        rationale: score?.rationale ?? [],
        knownGaps: [
          ...(score?.knownGaps ?? []),
          ...(independence?.preferredViolations.map((finding) => finding.reason) ?? []),
        ],
        violations: [
          ...evaluatedCandidate.hard.violations,
          ...(independence?.requiredViolations.map((finding) => ({
            code: 'INDEPENDENCE_REQUIRED',
            field: finding.requirement.property,
            reason: finding.reason,
          })) ?? []),
        ],
      });
    }
  }

  const missingRoles = requiredRoles.filter(
    (role) => !selected.some((entry) => entry.role === role),
  );
  const gaps = [
    ...missingRoles.map((role) => `No eligible independent candidate for ${role}.`),
    ...RECOMMENDED_ROLES.filter((role) =>
      (evaluated.get(role) ?? []).every((candidate) => !candidate.hard.eligible),
    ).map((role) => `All known candidates violate hard constraints for ${role}.`),
  ];
  const inputHash = sha256Canonical({
    taskId: input.taskId,
    risk: input.risk,
    profileBundleVersion: input.profileBundleVersion,
    profileBundleDigest: input.profileBundleDigest,
    scoringVersion: ROLE_SCORING_VERSION,
    policy: input.policy,
    candidates: input.candidates.map((candidate) => ({
      providerId: candidate.profile.providerId,
      modelId: candidate.profile.modelId,
      profileVersion: candidate.profile.profileVersion,
      health: candidate.health,
      authenticated: candidate.authenticated,
      disabled: candidate.disabled,
      cooldownUntil: candidate.cooldownUntil,
      enforceablePermissionModes: candidate.enforceablePermissionModes,
      availabilityConfidence: candidate.availabilityConfidence,
      runnerId: candidate.runnerId,
      runnerIds: candidate.runnerIds,
    })),
  });

  return RoleRecommendationSchema.parse({
    id: input.id,
    taskId: input.taskId,
    recommendationVersion: RECOMMENDATION_VERSION,
    risk: input.risk,
    profileBundleVersion: input.profileBundleVersion,
    profileBundleDigest: input.profileBundleDigest,
    scoringVersion: ROLE_SCORING_VERSION,
    inputHash,
    complete: missingRoles.length === 0 && (independenceDecision?.eligible ?? false),
    requiredRoles,
    candidates,
    independence:
      independenceDecision?.findings.map((finding) => ({
        leftRole: finding.requirement.leftRole,
        rightRole: finding.requirement.rightRole,
        property: finding.requirement.property,
        level: finding.requirement.level,
        satisfied: finding.satisfied,
        known: finding.known,
        reason: finding.reason,
      })) ?? [],
    gaps: [...new Set(gaps)].sort(),
    generatedAt: input.generatedAt,
  });
}

export interface RecommendationRosterChoice {
  role: RecommendedRole;
  providerId: string;
  modelId: string;
}

export interface RecommendationRosterValidation {
  eligible: boolean;
  missingRoles: RecommendedRole[];
  duplicateRoles: RecommendedRole[];
  unknownOrIneligible: RecommendationRosterChoice[];
  independence: IndependenceDecision;
}

export function validateRecommendationRoster(
  recommendation: RoleRecommendation,
  roster: readonly RecommendationRosterChoice[],
): RecommendationRosterValidation {
  const parsed = RoleRecommendationSchema.parse(recommendation);
  const missingRoles = parsed.requiredRoles.filter(
    (role) => !roster.some((choice) => choice.role === role),
  );
  const duplicateRoles = parsed.requiredRoles.filter(
    (role) => roster.filter((choice) => choice.role === role).length > 1,
  );
  const assignments: ProposedRoleAssignment[] = [];
  const unknownOrIneligible: RecommendationRosterChoice[] = [];
  for (const choice of roster) {
    const candidate = parsed.candidates.find(
      (item) =>
        item.role === choice.role &&
        item.providerId === choice.providerId &&
        item.modelId === choice.modelId &&
        item.eligible,
    );
    if (!candidate) {
      unknownOrIneligible.push(choice);
      continue;
    }
    assignments.push({
      role: choice.role,
      providerId: choice.providerId,
      modelId: choice.modelId,
      ...(candidate.modelFamily ? { modelFamily: candidate.modelFamily } : {}),
      ...(candidate.runnerId ? { runnerId: candidate.runnerId } : {}),
      invocationScope: 'dedicated',
    });
  }
  const independence = evaluateRosterIndependence(
    assignments,
    defaultIndependenceRequirements(parsed.risk, parsed.requiredRoles as RoleId[]),
  );
  return {
    eligible:
      missingRoles.length === 0 &&
      duplicateRoles.length === 0 &&
      unknownOrIneligible.length === 0 &&
      independence.eligible,
    missingRoles,
    duplicateRoles,
    unknownOrIneligible,
    independence,
  };
}

export function validateRecommendationFallbackMatrix(
  recommendation: RoleRecommendation,
  primaryRoster?: readonly RecommendationRosterChoice[],
): RecommendationRosterValidation[] {
  const parsed = RoleRecommendationSchema.parse(recommendation);
  const choices = parsed.requiredRoles.map((role) =>
    [
      ...(primaryRoster
        ? primaryRoster.filter((choice) => choice.role === role)
        : parsed.candidates
            .filter((candidate) => candidate.role === role && candidate.selected)
            .map((candidate) => ({
              role,
              providerId: candidate.providerId,
              modelId: candidate.modelId,
            }))),
      ...parsed.candidates
        .filter((candidate) => candidate.role === role && candidate.fallback)
        .map((candidate) => ({
          role,
          providerId: candidate.providerId,
          modelId: candidate.modelId,
        })),
    ].filter(
      (choice, index, all) =>
        all.findIndex(
          (item) =>
            item.role === choice.role &&
            item.providerId === choice.providerId &&
            item.modelId === choice.modelId,
        ) === index,
    ),
  );
  return cartesian(choices).map((roster) => validateRecommendationRoster(parsed, roster));
}

function requirement(
  role: RecommendedRole,
  options: {
    traits: RoleRequirementProfile['minimumTraits'];
    weights: RoleRequirementProfile['weights'];
    permission: RoleRequirementProfile['permissionProfile']['repository'];
    effort: Effort;
    writes?: boolean;
  },
): RoleRequirementProfile {
  return {
    role,
    requiredCapabilities: [
      { kind: 'boolean', capability: 'headless', value: true },
      { kind: 'boolean', capability: 'structuredOutput', value: true },
      ...(options.writes
        ? ([{ kind: 'boolean', capability: 'writes', value: true }] as const)
        : []),
    ],
    minimumTraits: options.traits,
    weights: options.weights,
    maximumUnknownRequiredTraits: 0,
    permissionProfile: {
      repository: options.permission,
      commands: options.permission === 'planned_write' ? 'approved' : 'readonly',
      network: 'none',
      credentials: 'none',
    },
    requiredEffort: options.effort,
  };
}

function selectRoster(
  roles: readonly RecommendedRole[],
  candidates: ReadonlyMap<RecommendedRole, readonly EvaluatedCandidate[]>,
  requirements: ReturnType<typeof defaultIndependenceRequirements>,
): Array<{ role: RecommendedRole; candidate: EvaluatedCandidate }> {
  let best:
    | {
        selection: Array<{ role: RecommendedRole; candidate: EvaluatedCandidate }>;
        score: number;
        key: string;
      }
    | undefined;

  const visit = (
    index: number,
    selection: Array<{ role: RecommendedRole; candidate: EvaluatedCandidate }>,
  ) => {
    if (index === roles.length) {
      const independence = evaluateRosterIndependence(
        selection.map(({ role, candidate }) => assignmentFor(role, candidate.runtime)),
        requirements,
      );
      if (!independence.eligible) return;
      const score =
        selection.reduce((sum, entry) => sum + (entry.candidate.score?.score ?? 0), 0) -
        independence.preferredViolations.length * 0.04;
      const key = selection
        .map(({ role, candidate }) => candidateKey(role, candidate.runtime))
        .join('|');
      if (!best || score > best.score || (score === best.score && key < best.key)) {
        best = { selection: [...selection], score, key };
      }
      return;
    }
    const role = roles[index]!;
    for (const candidate of candidates.get(role) ?? []) {
      if (!candidate.hard.eligible || !candidate.score) continue;
      selection.push({ role, candidate });
      visit(index + 1, selection);
      selection.pop();
    }
  };
  visit(0, []);
  return best?.selection ?? [];
}

function selectSafeFallbacks(
  roles: readonly RecommendedRole[],
  selected: ReadonlyArray<{ role: RecommendedRole; candidate: EvaluatedCandidate }>,
  candidates: ReadonlyMap<RecommendedRole, readonly EvaluatedCandidate[]>,
  requirements: ReturnType<typeof defaultIndependenceRequirements>,
): Set<string> {
  const selectedByRole = new Map(selected.map((entry) => [entry.role, entry.candidate]));
  const fallbackByRole = new Map<RecommendedRole, EvaluatedCandidate>();
  for (const role of roles) {
    for (const candidate of candidates.get(role) ?? []) {
      if (!candidate.hard.eligible || !candidate.score || candidate === selectedByRole.get(role)) {
        continue;
      }
      fallbackByRole.set(role, candidate);
      const choices = roles.map((choiceRole) => {
        const primary = selectedByRole.get(choiceRole);
        const fallback = fallbackByRole.get(choiceRole);
        return [primary, fallback].filter(
          (value): value is EvaluatedCandidate => value !== undefined,
        );
      });
      const safe = cartesian(choices).every(
        (combination) =>
          evaluateRosterIndependence(
            combination.map((choice, index) => assignmentFor(roles[index]!, choice.runtime)),
            requirements,
          ).eligible,
      );
      if (safe) break;
      fallbackByRole.delete(role);
    }
  }
  return new Set(
    [...fallbackByRole].map(([role, candidate]) => candidateKey(role, candidate.runtime)),
  );
}

function cartesian<T>(groups: readonly (readonly T[])[]): T[][] {
  if (groups.some((group) => group.length === 0)) return [];
  return groups.reduce<T[][]>(
    (combinations, group) =>
      combinations.flatMap((combination) => group.map((item) => [...combination, item])),
    [[]],
  );
}

function assignmentFor(
  role: RecommendedRole,
  runtime: RecommendationRuntimeCandidate,
): ProposedRoleAssignment {
  return {
    role,
    providerId: runtime.profile.providerId,
    modelId: runtime.profile.modelId,
    ...(runtime.profile.modelFamily ? { modelFamily: runtime.profile.modelFamily } : {}),
    ...(runtime.runnerIds?.[role] || runtime.runnerId
      ? { runnerId: runtime.runnerIds?.[role] ?? runtime.runnerId }
      : {}),
    invocationScope: 'dedicated',
  };
}

function candidateKey(role: RecommendedRole, runtime: RecommendationRuntimeCandidate): string {
  return `${role}:${runtime.profile.providerId}/${runtime.profile.modelId}`;
}

function compareEvaluated(left: EvaluatedCandidate, right: EvaluatedCandidate): number {
  return (
    Number(right.hard.eligible) - Number(left.hard.eligible) ||
    (right.score?.score ?? -1) - (left.score?.score ?? -1) ||
    `${left.runtime.profile.providerId}/${left.runtime.profile.modelId}`.localeCompare(
      `${right.runtime.profile.providerId}/${right.runtime.profile.modelId}`,
    )
  );
}
