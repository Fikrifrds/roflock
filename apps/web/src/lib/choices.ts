import type { SelectOption } from '../components/Select.js';

/**
 * Option lists with descriptions.
 *
 * These labels are terms of art — "Approved plan", "Critical", "Inspiration
 * only" — and the label alone does not tell someone what picking it will do.
 * The description is the difference between a guess and a decision.
 */

export const DOCUMENT_KINDS: SelectOption[] = [
  { value: 'prd', label: 'PRD', description: 'Product requirements' },
  {
    value: 'implementation_plan',
    label: 'Implementation plan',
    description: 'How the work will be built',
  },
  { value: 'architecture', label: 'Architecture', description: 'System design notes' },
  { value: 'api_spec', label: 'API spec', description: 'Endpoint and payload contracts' },
  { value: 'ticket', label: 'Ticket', description: 'Issue or bug report' },
  { value: 'research', label: 'Research', description: 'Background findings' },
  { value: 'other', label: 'Other', description: 'Anything else worth attaching' },
];

export const DOCUMENT_AUTHORITIES: SelectOption[] = [
  {
    value: 'authoritative_requirement',
    label: 'Authoritative requirement',
    description: 'Must be satisfied. Conflicting requirements block the writer.',
  },
  {
    value: 'approved_plan',
    label: 'Approved plan',
    description: 'An agreed approach the writer should follow.',
  },
  { value: 'reference', label: 'Reference', description: 'Useful context, not binding.' },
  {
    value: 'inspiration_only',
    label: 'Inspiration only',
    description: 'Ideas to draw on. Safe to ignore.',
  },
];

export const RISK_LEVELS: SelectOption[] = [
  { value: 'low', label: 'Low', description: 'Localised and easy to revert.' },
  { value: 'medium', label: 'Medium', description: 'Ordinary feature or fix work.' },
  { value: 'high', label: 'High', description: 'Touches shared or load-bearing code.' },
  {
    value: 'critical',
    label: 'Critical',
    description: 'Security, data, or migration risk. Forces the heaviest path.',
  },
];

export const KNOWLEDGE_TYPES: SelectOption[] = [
  {
    value: 'architecture_decision',
    label: 'Architecture decision',
    description: 'A choice and the reasoning behind it',
  },
  {
    value: 'coding_convention',
    label: 'Coding convention',
    description: 'How this codebase prefers to be written',
  },
  { value: 'past_failure', label: 'Past failure', description: 'Something that went wrong before' },
  { value: 'review_rule', label: 'Review rule', description: 'What reviewers should insist on' },
  { value: 'test_pattern', label: 'Test pattern', description: 'How this project tests things' },
  { value: 'security_rule', label: 'Security rule', description: 'A constraint that must hold' },
  {
    value: 'rejected_approach',
    label: 'Rejected approach',
    description: 'Something already tried and ruled out',
  },
];

export const KNOWLEDGE_STATES: SelectOption[] = [
  {
    value: 'candidate',
    label: 'Candidate',
    description: 'Draft. Never sent to a provider as context.',
  },
  {
    value: 'published',
    label: 'Published',
    description: 'Eligible for inclusion in agent context.',
  },
];

/** Prepends an "all"/"any" entry to a filter list. */
export function withAnyOption(options: SelectOption[], label: string): SelectOption[] {
  return [{ value: '', label }, ...options];
}
