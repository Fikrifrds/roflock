export { openDatabase, openMigratedDatabase, migrate } from './client.js';
export type { SqliteDb, OpenDatabaseOptions } from './client.js';
export { EventStore } from './repositories/event-store.js';
export { SnapshotRepository } from './repositories/snapshot-repository.js';
export type { StateSnapshot } from './repositories/snapshot-repository.js';
export { TaskProjector, reduceTask, assertTaskTransition } from './reducers/task-reducer.js';
export type { TaskProjection } from './reducers/task-reducer.js';
export { ProjectRepository } from './repositories/project-repository.js';
export { TaskRepository } from './repositories/task-repository.js';
export { ConfirmationRepository } from './repositories/confirmation-repository.js';
export { ApprovalGrantRepository } from './repositories/approval-grant-repository.js';
export type { CreateApprovalGrantInput } from './repositories/approval-grant-repository.js';
export { DisclosureGrantRepository } from './repositories/disclosure-grant-repository.js';
export type {
  DisclosureGrant,
  CreateDisclosureGrantInput,
} from './repositories/disclosure-grant-repository.js';
export { WorktreeRepository } from './repositories/worktree-repository.js';
export { ActiveExecutionRepository } from './repositories/active-execution-repository.js';
export { InvocationRepository } from './repositories/invocation-repository.js';
export { UsageRepository } from './repositories/usage-repository.js';
export type { UsageEntry, ProviderModelUsage } from './repositories/usage-repository.js';
export { PriceCardRepository, QuotaSnapshotRepository } from './repositories/pricing-repository.js';
export type { PriceCardRow, QuotaSnapshotRow } from './repositories/pricing-repository.js';
export { TaskDocumentRepository } from './repositories/task-document-repository.js';
export type {
  TaskDocument,
  DocumentAuthority,
  DocumentKind,
} from './repositories/task-document-repository.js';
export { LocalKnowledgeRepository } from './repositories/local-knowledge-repository.js';
export type {
  LocalKnowledgeItem,
  KnowledgeType,
  KnowledgeState,
} from './repositories/local-knowledge-repository.js';
export { EvidenceRepository } from './repositories/evidence-repository.js';
export { AuditRepository } from './repositories/audit-repository.js';
export type { AuditEvent } from './repositories/audit-repository.js';
export { ControlCommandRepository } from './repositories/control-command-repository.js';
export { ProcessHandleRepository } from './repositories/process-handle-repository.js';
export { LeaseRepository } from './repositories/lease-repository.js';
export { ProviderConnectionRepository } from './repositories/provider-connection-repository.js';
export type { CustomProviderConnection } from './repositories/provider-connection-repository.js';
export {
  RoleAssignmentRepository,
  ProviderCooldownRepository,
} from './repositories/role-assignment-repository.js';
export type {
  RoleCandidate,
  RoleCandidateInput,
  ProviderCooldown,
} from './repositories/role-assignment-repository.js';
export {
  ChangeContractRepository,
  ContractVersionConflictError,
  ImmutableContractVersionError,
  changeContractVersionId,
} from './repositories/change-contract-repository.js';
export type {
  ChangeContractAggregate,
  StoredChangeContractVersion,
} from './repositories/change-contract-repository.js';
