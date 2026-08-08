import type { SourceSpan } from './types.js';

/**
 * Diagnostic codes are a stable contract: editors, tests and CI match on them,
 * so a code's meaning may not be repurposed once released.
 *
 * Namespaces follow RFC-001 §19:
 *
 *   RF1xx  names / references
 *   RF2xx  graph / reachability / loops
 *   RF3xx  concurrency / writer safety
 *   RF4xx  roles / independence / capability
 *   RF5xx  effects / approvals / permissions
 *   RF6xx  budget / quota / limits
 *   RF7xx  artifacts / evidence / acceptance
 *   RF8xx  package / extension / compatibility
 */
export const DiagnosticCode = {
  UnknownNode: 'RF101',
  UnknownRole: 'RF102',
  DuplicateDeclaration: 'RF103',
  UnknownOutcome: 'RF121',
  UnknownProfileRole: 'RF104',

  UnreachableNode: 'RF201',
  MissingTerminal: 'RF202',
  UnboundedCycle: 'RF210',
  LoopVerifierUnreachable: 'RF211',
  RetryWithoutNewEvidence: 'RF212',
  NoEntryNode: 'RF203',

  ConcurrentWriters: 'RF301',

  ReviewerIndependenceWeakened: 'RF401',
  MissingRequiredCapability: 'RF410',

  ProtectedEffectWithoutApproval: 'RF501',
  UndeclaredNetworkAccess: 'RF502',
  UndeclaredSecretAccess: 'RF503',

  MissingCostBoundary: 'RF601',

  MissingArtifactProducer: 'RF701',
  ArtifactTypeMismatch: 'RF702',
  BlockingCriterionHasNoVerifier: 'RF710',
  RequiredCheckBypassable: 'RF711',

  UnsupportedExtension: 'RF801',
  UnsupportedIrVersion: 'RF802',
} as const;

export type DiagnosticCode = (typeof DiagnosticCode)[keyof typeof DiagnosticCode];

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  code: DiagnosticCode | string;
  severity: DiagnosticSeverity;
  message: string;
  span?: SourceSpan;
  related?: Array<{ message: string; span?: SourceSpan }>;
  fix?: { title: string; replacement?: string };
}

export function error(code: DiagnosticCode, message: string, span?: SourceSpan): Diagnostic {
  return span ? { code, severity: 'error', message, span } : { code, severity: 'error', message };
}

export function warning(code: DiagnosticCode, message: string, span?: SourceSpan): Diagnostic {
  return span
    ? { code, severity: 'warning', message, span }
    : { code, severity: 'warning', message };
}

/** True when nothing blocks execution. Warnings are quality signals, not gates. */
export function isExecutable(diagnostics: readonly Diagnostic[]): boolean {
  return !diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

export function formatDiagnostic(diagnostic: Diagnostic, uri?: string): string {
  const location = diagnostic.span
    ? `${diagnostic.span.uri ?? uri ?? '<source>'}:${diagnostic.span.start.line}:${diagnostic.span.start.column}: `
    : '';
  return `${location}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
}
