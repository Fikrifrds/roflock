import { describe, expect, it } from 'vitest';
import { assertFeedbackRoute, classifyFeedbackText, feedbackDecisionOwner } from './feedback.js';

describe('feedback routing', () => {
  it('classifies small visual feedback without treating it as executor instruction', () => {
    expect(classifyFeedbackText('Tolong perbaiki warna tombol dan spacing-nya.')).toBe(
      'interactive_cosmetic_change',
    );
    expect(feedbackDecisionOwner('interactive_cosmetic_change')).toBe('planner');
  });

  it('routes intent and policy changes to authority', () => {
    expect(classifyFeedbackText('Change the behaviour: users must now confirm twice.')).toBe(
      'requirement_change',
    );
    expect(feedbackDecisionOwner('requirement_change')).toBe('contract_authority');
    expect(feedbackDecisionOwner('policy_exception')).toBe('contract_authority');
  });

  it('fails closed to planner for unknown or defective implementation feedback', () => {
    expect(classifyFeedbackText('This still crashes during checkout.')).toBe(
      'implementation_defect',
    );
    expect(feedbackDecisionOwner('implementation_defect')).toBe('planner');
    expect(feedbackDecisionOwner('unknown')).toBe('planner');
  });

  it('rejects every caller-selected shortcut', () => {
    expect(() => assertFeedbackRoute('implementation_defect', 'executor')).toThrow(
      /must route to planner/,
    );
    expect(() => assertFeedbackRoute('requirement_change', 'planner')).toThrow(
      /must route to contract_authority/,
    );
    expect(() => assertFeedbackRoute('plan_gap', 'planner')).not.toThrow();
  });
});
