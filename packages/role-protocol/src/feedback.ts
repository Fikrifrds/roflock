import type { RoleId } from './index.js';

export const FEEDBACK_CLASSES = [
  'requirement_change',
  'implementation_preference',
  'implementation_defect',
  'plan_gap',
  'verification_gap',
  'policy_exception',
  'interactive_cosmetic_change',
  'unknown',
] as const;
export type FeedbackClass = (typeof FEEDBACK_CLASSES)[number];

export type FeedbackStatus = 'received' | 'classified' | 'routed' | 'resolved' | 'rejected';

export type FeedbackItem = {
  id: string;
  taskId: string;
  sourceActorId: string;
  text: string;
  classification: FeedbackClass;
  targetContractHash?: string;
  targetPlanHash?: string;
  targetCommit?: string;
  status: FeedbackStatus;
  routedRole: RoleId;
  createdAt: string;
  updatedAt: string;
};

const CLASSIFICATION_RULES: ReadonlyArray<{
  classification: Exclude<FeedbackClass, 'unknown'>;
  patterns: readonly RegExp[];
}> = [
  {
    classification: 'policy_exception',
    patterns: [/\b(exception|waive|waiver|bypass policy|policy override)\b/i],
  },
  {
    classification: 'verification_gap',
    patterns: [/\b(add|missing|need|update).{0,30}\b(test|check|assertion|verification)\b/i],
  },
  {
    classification: 'plan_gap',
    patterns: [/\b(plan|step|scope).{0,30}\b(missing|incomplete|forgot|omitted)\b/i],
  },
  {
    classification: 'implementation_defect',
    patterns: [
      /\b(bug|broken|error|crash(?:es|ed|ing)?|regression|does not work|doesn't work|gagal|rusak)\b/i,
    ],
  },
  {
    classification: 'interactive_cosmetic_change',
    patterns: [
      /\b(colou?r|warna|font|spacing|padding|margin|radius|shadow|alignment|align|cosmetic|pixel|px)\b/i,
    ],
  },
  {
    classification: 'requirement_change',
    patterns: [
      /\b(requirement|acceptance criteria|must now|instead of|change the behaviour|ubah requirement|tambahkan fitur)\b/i,
    ],
  },
  {
    classification: 'implementation_preference',
    patterns: [
      /\b(prefer|would rather|use .+ instead|implementation|refactor|rename|lebih baik)\b/i,
    ],
  },
];

export function classifyFeedbackText(text: string): FeedbackClass {
  const normalized = text.trim();
  if (!normalized) throw new Error('Feedback text cannot be empty');
  return (
    CLASSIFICATION_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(normalized)))
      ?.classification ?? 'unknown'
  );
}

export function feedbackDecisionOwner(classification: FeedbackClass): RoleId {
  switch (classification) {
    case 'requirement_change':
    case 'policy_exception':
      return 'contract_authority';
    case 'implementation_preference':
    case 'implementation_defect':
    case 'plan_gap':
    case 'verification_gap':
    case 'interactive_cosmetic_change':
    case 'unknown':
      return 'planner';
  }
}

export function assertFeedbackRoute(classification: FeedbackClass, targetRole: RoleId): void {
  const owner = feedbackDecisionOwner(classification);
  if (targetRole !== owner) {
    throw new Error(`Feedback ${classification} must route to ${owner}, not ${targetRole}`);
  }
  if (targetRole === 'executor') {
    throw new Error('Raw feedback can never target executor');
  }
}
