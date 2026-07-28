import type { Task } from '@roleflock/contracts';
import type { ChangeContractRepository } from '@roleflock/database';

export type ContractStartGate =
  | {
      allowed: true;
      mode: 'legacy_uncontracted';
      warning: string;
    }
  | {
      allowed: true;
      mode: 'authorised';
      pin: {
        contractId: string;
        contractVersion: number;
        contractHash: string;
      };
    }
  | {
      allowed: false;
      code: 'CHANGE_CONTRACT_REQUIRED' | 'CHANGE_CONTRACT_NOT_AUTHORISED';
      message: string;
      contractId?: string;
      contractStatus?: string;
      revision?: number;
    };

export function evaluateContractStartGate(
  task: Task,
  contracts: ChangeContractRepository,
): ContractStartGate {
  if (task.contractRequirement === 'legacy_uncontracted') {
    return {
      allowed: true,
      mode: 'legacy_uncontracted',
      warning:
        'Legacy task: execution is allowed without an invented contract. Its brief is not represented as human-authorised.',
    };
  }

  const aggregate = contracts.getByTask(task.id);
  if (aggregate === undefined) {
    return {
      allowed: false,
      code: 'CHANGE_CONTRACT_REQUIRED',
      message: 'Create and authorise a Change Contract before starting this task.',
    };
  }
  const current = contracts.getCurrent(aggregate.id);
  if (current === undefined || current.contract.status !== 'authorised') {
    return {
      allowed: false,
      code: 'CHANGE_CONTRACT_NOT_AUTHORISED',
      message: 'The current Change Contract version must be authorised before execution.',
      contractId: aggregate.id,
      contractStatus: current?.contract.status ?? aggregate.status,
      revision: aggregate.revision,
    };
  }
  if (aggregate.currentHash !== current.contract.hash) {
    return {
      allowed: false,
      code: 'CHANGE_CONTRACT_NOT_AUTHORISED',
      message: 'The current Change Contract projection does not match its verified artifact hash.',
      contractId: aggregate.id,
      contractStatus: current.contract.status,
      revision: aggregate.revision,
    };
  }

  return {
    allowed: true,
    mode: 'authorised',
    pin: {
      contractId: current.contract.id,
      contractVersion: current.contract.version,
      contractHash: current.contract.hash,
    },
  };
}
