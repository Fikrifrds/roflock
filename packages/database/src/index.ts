export { openDatabase, openMigratedDatabase, migrate } from './client.js';
export type { SqliteDb, OpenDatabaseOptions } from './client.js';
export { EventStore } from './repositories/event-store.js';
export { SnapshotRepository } from './repositories/snapshot-repository.js';
export type { StateSnapshot } from './repositories/snapshot-repository.js';
export { TaskProjector, reduceTask, assertTaskTransition } from './reducers/task-reducer.js';
export {
  RuntimeHistoryError,
  loadGraphRun,
  projectGraphRun,
  reduceGraphRun,
} from './reducers/graph-run-reducer.js';
export type { TaskProjection } from './reducers/task-reducer.js';
export { ProjectRepository } from './repositories/project-repository.js';
export { TaskRepository } from './repositories/task-repository.js';
export { WorkflowSnapshotRepository } from './repositories/workflow-snapshot-repository.js';
export type { WorkflowSnapshotRecord } from './repositories/workflow-snapshot-repository.js';
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
export type { InvocationRecord } from './repositories/invocation-repository.js';
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
export { ConcurrencyPolicyRepository } from './repositories/concurrency-policy-repository.js';
export type {
  ConcurrencyAdmission,
  ConcurrencyPolicy,
  ConcurrencyScope,
} from './repositories/concurrency-policy-repository.js';
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
export { FeedbackRepository } from './repositories/feedback-repository.js';
export type { StoredFeedbackItem } from './repositories/feedback-repository.js';
export {
  ExecutionPlanRepository,
  planSnapshotId,
} from './repositories/execution-plan-repository.js';
export type { ExecutionPlanAggregate } from './repositories/execution-plan-repository.js';
export { VerificationSpecificationRepository } from './repositories/verification-specification-repository.js';
export { VerificationResultRepository } from './repositories/verification-result-repository.js';
export type { StoredVerificationResult } from './repositories/verification-result-repository.js';
export { RunnerIdentityRepository } from './repositories/runner-identity-repository.js';
export { ChangePassportRepository } from './repositories/change-passport-repository.js';
export {
  RecommendationIdempotencyConflictError,
  RecommendationVersionConflictError,
  RoleRecommendationRepository,
} from './repositories/role-recommendation-repository.js';
export {
  AgentEventOrderingError,
  AgentSourceEventConflictError,
  ExternalAgentEventRepository,
  sourceStreamId,
} from './repositories/external-agent-event-repository.js';
export type {
  AgentEventIngestResult,
  ExternalAgentSession,
} from './repositories/external-agent-event-repository.js';
export { GitHubIntegrationRepository } from './repositories/github-integration-repository.js';
export type {
  GitHubActorMapping,
  GitHubInstallation,
  GitHubRepositoryMapping,
} from './repositories/github-integration-repository.js';
export { GitHubAuthorityLinkRepository } from './repositories/github-authority-link-repository.js';
export type { GitHubAuthorityLink } from './repositories/github-authority-link-repository.js';
export { GitHubStatusCheckRepository } from './repositories/github-status-check-repository.js';
export type {
  CommitStatusDecision,
  GitHubStatusCheck,
} from './repositories/github-status-check-repository.js';
export { GitHubReviewPublicationRepository } from './repositories/github-review-publication-repository.js';
export type { GitHubReviewPublication } from './repositories/github-review-publication-repository.js';
export { GitHubCommentFeedbackRepository } from './repositories/github-comment-feedback-repository.js';
export type { GitHubCommentFeedbackReceipt } from './repositories/github-comment-feedback-repository.js';
export { OrganisationRepository } from './repositories/organisation-repository.js';
export type {
  Actor,
  Organisation,
  OrganisationAction,
  OrganisationMembership,
  OrganisationRole,
} from './repositories/organisation-repository.js';
export { TrustedRunnerRepository } from './repositories/trusted-runner-repository.js';
export type { TrustedRunner } from './repositories/trusted-runner-repository.js';
export { SharedPolicyRepository } from './repositories/shared-policy-repository.js';
export type {
  ScopedCredentialGrant,
  StoredSharedPolicyBundle,
} from './repositories/shared-policy-repository.js';
export { TransparencyLogRepository } from './repositories/transparency-log-repository.js';
export type {
  StoredMultiPartyApprovalPolicy,
  StoredPartyApprovalDecision,
  StoredTransparencyEntry,
} from './repositories/transparency-log-repository.js';
export { MetadataSyncRepository } from './repositories/metadata-sync-repository.js';
export type { MetadataSyncBatch } from './repositories/metadata-sync-repository.js';
export { OutcomeObservationRepository } from './repositories/outcome-observation-repository.js';
export { AdaptiveRoutingControlRepository } from './repositories/adaptive-routing-control-repository.js';
export type { AdaptiveRoutingControl } from './repositories/adaptive-routing-control-repository.js';
export type {
  RecommendationRosterEntry,
  RoleRecommendationAction,
  StoredRoleRecommendation,
} from './repositories/role-recommendation-repository.js';
export type {
  ChangeContractAggregate,
  StoredChangeContractVersion,
} from './repositories/change-contract-repository.js';
