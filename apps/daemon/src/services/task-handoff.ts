import { exportedEnvNames, sha256Canonical } from '@roleflock/contracts';
import {
  ChangeContractRepository,
  ExecutionPlanRepository,
  TaskRepository,
  WorktreeRepository,
  type SqliteDb,
} from '@roleflock/database';

export type TaskHandoffManifest = {
  schemaVersion: 1;
  task: {
    id: string;
    title: string;
    projectId: string;
  };
  authority: {
    contractId: string;
    contractHash: string;
    planId: string;
    planHash: string;
    planVersion: number;
  };
  workspace: {
    path: string;
    branchName: string;
    baseCommit: string;
  };
  issuedAt: string;
  hashAlgorithm: 'sha256';
  hash: string;
};

export type TaskHandoff = {
  manifest: TaskHandoffManifest;
  commands: Array<{
    id: 'codex' | 'claude' | 'cursor' | 'folder';
    label: string;
    command: string;
  }>;
};

export function buildTaskHandoff(
  db: SqliteDb,
  taskId: string,
  issuedAt = new Date().toISOString(),
): TaskHandoff {
  const task = new TaskRepository(db).get(taskId);
  if (task === undefined) throw new Error(`Task not found: ${taskId}`);
  const contractAggregate = new ChangeContractRepository(db).getByTask(taskId);
  const contract =
    contractAggregate === undefined
      ? undefined
      : new ChangeContractRepository(db).getCurrent(contractAggregate.id)?.contract;
  if (
    contract === undefined ||
    contract.status !== 'authorised' ||
    contract.hash !== contractAggregate?.currentHash
  ) {
    throw new Error('An exact current authorised Change Contract is required for handoff');
  }
  const plan = new ExecutionPlanRepository(db).getByTask(taskId)?.plan;
  if (plan === undefined || plan.status !== 'approved' || plan.contractHash !== contract.hash) {
    throw new Error(
      'An approved Execution Plan bound to the current contract is required for handoff',
    );
  }
  const worktree = new WorktreeRepository(db).getByTask(taskId);
  if (
    worktree === undefined ||
    (worktree.status !== 'active' && worktree.status !== 'dirty_preserved')
  ) {
    throw new Error('An active task worktree is required for handoff');
  }

  const unsigned = {
    schemaVersion: 1 as const,
    task: {
      id: task.id,
      title: task.title,
      projectId: task.projectId,
    },
    authority: {
      contractId: contract.id,
      contractHash: contract.hash,
      planId: plan.id,
      planHash: plan.hash,
      planVersion: plan.version,
    },
    workspace: {
      path: worktree.path,
      branchName: worktree.branchName,
      baseCommit: worktree.baseCommit,
    },
    issuedAt,
  };
  const manifest: TaskHandoffManifest = {
    ...unsigned,
    hashAlgorithm: 'sha256',
    hash: sha256Canonical(unsigned),
  };
  // Emitted under both spellings: a handoff command a user already wrote reads
  // the legacy names, and this string is pasted into their shell verbatim.
  const environment = [
    ['TASK_ID', task.id],
    ['CONTRACT_HASH', contract.hash],
    ['PLAN_HASH', plan.hash],
    ['HANDOFF_HASH', manifest.hash],
  ]
    .flatMap(([name, value]) =>
      exportedEnvNames(name!).map((variable) => `${variable}=${shellQuote(value!)}`),
    )
    .join(' ');
  const prompt = shellQuote(
    [
      `Roflock handoff ${manifest.hash}.`,
      `Task ${task.id}; contract ${contract.hash}; approved plan ${plan.hash}.`,
      `Work only on branch ${worktree.branchName} in this workspace.`,
      'Execute the approved plan exactly. Return scope or decision changes to the Roflock planner.',
    ].join(' '),
  );
  const inWorkspace = `cd ${shellQuote(worktree.path)} && ${environment}`;
  return {
    manifest,
    commands: [
      { id: 'codex', label: 'Open in Codex', command: `${inWorkspace} codex ${prompt}` },
      {
        id: 'claude',
        label: 'Open in Claude Code',
        command: `${inWorkspace} claude ${prompt}`,
      },
      {
        id: 'cursor',
        label: 'Open in Cursor',
        command: `${inWorkspace} cursor-agent ${prompt}`,
      },
      {
        id: 'folder',
        label: 'Open folder',
        command: `cd ${shellQuote(worktree.path)}`,
      },
    ],
  };
}

export function verifyTaskHandoffManifest(manifest: TaskHandoffManifest): boolean {
  const { hash, hashAlgorithm: _hashAlgorithm, ...unsigned } = manifest;
  return hash === sha256Canonical(unsigned);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
