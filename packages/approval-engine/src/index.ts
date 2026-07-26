import { createId, sha256Canonical } from '@roleflock/contracts';
import type { ApprovalGrant, ConfirmationRequest, StructuredAction } from '@roleflock/contracts';

export function actionFingerprint(action: StructuredAction): string {
  return sha256Canonical({
    kind: action.kind, verb: action.verb, target: action.target, paths: [...(action.paths ?? [])].sort(),
    command: action.command, args: action.args ?? [], destination: action.destination,
    sideEffectClass: action.sideEffectClass, metadata: action.metadata,
  });
}

export function createConfirmationRequest(input: Omit<ConfirmationRequest, 'id' | 'fingerprint' | 'status' | 'createdAt'> & { createdAt?: string }): ConfirmationRequest {
  return { ...input, id: createId('confirmation'), fingerprint: actionFingerprint(input.exactAction), status: 'pending', createdAt: input.createdAt ?? new Date().toISOString() };
}

const SENSITIVE = new Set(['network_access', 'database_change', 'external_side_effect', 'dependency_change', 'policy_exception']);
export function mayReuseApproval(request: Pick<ConfirmationRequest, 'requestType' | 'fingerprint'>, grant: ApprovalGrant, now = new Date()): boolean {
  if (SENSITIVE.has(request.requestType)) return false;
  if (grant.revokedAt || new Date(grant.expiresAt) <= now || grant.applicationsUsed >= (grant.maximumApplications ?? Infinity)) return false;
  if (grant.scope === 'exact_fingerprint' && grant.fingerprint !== request.fingerprint) return false;
  if (grant.scope === 'task_request_type' && !grant.requestTypes?.includes(request.requestType)) return false;
  return true;
}

export function matchingGrant(request: Pick<ConfirmationRequest, 'requestType' | 'fingerprint' | 'riskClass'>, grants: ApprovalGrant[], now?: Date): ApprovalGrant | undefined {
  return grants.find((grant) => mayReuseApproval(request, grant, now) && riskRank(request.riskClass) <= riskRank(grant.maximumRisk));
}
function riskRank(risk: string) { return ['low', 'medium', 'high', 'critical'].indexOf(risk); }
