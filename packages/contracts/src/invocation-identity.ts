import { sha256Canonical } from './ids.js';

/**
 * Stable identity for one billable provider turn.
 *
 * A run that resumes after a crash has to answer a question the process that
 * started the work cannot answer for it: has this exact turn already happened?
 * A random id per attempt makes that unanswerable, and the safe-looking
 * default — run it again — is the one that pays a provider twice for the same
 * result.
 *
 * The tuple follows RFC-001 §20. `semanticHash` is included because a workflow
 * edit produces a new graph with the same version id: without it, a turn paid
 * for under the old shape could be mistaken for one already done under the new
 * one, which is the one confusion this key exists to prevent.
 */
export interface InvocationIdentity {
  taskId: string;
  /** The pinned graph version, e.g. `bug_fix@3`. */
  graphVersionId: string;
  /** Semantic hash of the compiled graph, when the run has one. */
  semanticHash?: string;
  nodeId: string;
  /** 1-based attempt of this node within the run. */
  attempt: number;
  /**
   * Loop re-entries spent when this turn began. Two attempts of the same node
   * on different passes through a repair loop are different work and must not
   * collide.
   */
  loopIteration: number;
}

export function stableInvocationKey(identity: InvocationIdentity): string {
  // Canonical hashing rather than string concatenation: a node id containing
  // the separator would otherwise let two different turns produce one key.
  return `inv_${sha256Canonical({
    taskId: identity.taskId,
    graphVersionId: identity.graphVersionId,
    semanticHash: identity.semanticHash ?? null,
    nodeId: identity.nodeId,
    attempt: identity.attempt,
    loopIteration: identity.loopIteration,
  })}`;
}
