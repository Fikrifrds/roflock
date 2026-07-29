import { useData } from '../lib/client.js';
import type { Tone } from '../lib/format.js';
import type {
  ChangeContractResponse,
  ChangePassportResponse,
  ExecutionPlanResponse,
  Task,
  VerificationResultResponse,
} from '../types.js';

type Stage = {
  key: string;
  label: string;
  state: string;
  detail: string;
  tone: Tone;
};

/**
 * The four questions a reviewer actually has to answer before shipping, in the
 * order the authority chain answers them.
 *
 * Each stage reports what is *proven*, never what is merely present. An absent
 * artifact reads as "not established" rather than being omitted, because a gap
 * a reviewer cannot see is a gap they will assume away.
 */
export function AssuranceSummary({ task }: { task: Task }) {
  const contract = useData<ChangeContractResponse | null>(
    ['change-contract', task.id],
    `/api/tasks/${task.id}/change-contract`,
  ).data;
  const plan = useData<ExecutionPlanResponse | null>(
    ['execution-plan', task.id],
    `/api/tasks/${task.id}/execution-plan`,
  ).data;
  const verification = useData<VerificationResultResponse | null>(
    ['verification-result', task.id],
    `/api/tasks/${task.id}/verification-result`,
  ).data;
  const passport = useData<ChangePassportResponse | null>(
    ['change-passport', task.id],
    `/api/tasks/${task.id}/change-passport`,
  ).data;

  const openDeviations = (plan?.deviations ?? []).filter(
    (deviation) => deviation.status === 'open',
  ).length;
  const verdicts = verification?.decision?.verdicts ?? [];
  const passing = verdicts.filter((verdict) => verdict.outcome === 'pass').length;

  const stages: Stage[] = [
    {
      key: 'intent',
      label: 'Intent',
      ...(contract?.contract?.status === 'authorised'
        ? {
            state: 'Authorised',
            detail: `${contract.contract.acceptanceCriteria.length} acceptance criteria · v${contract.contract.version}`,
            tone: 'ok' as const,
          }
        : {
            state: contract?.contract ? 'Not authorised' : 'Not established',
            detail: 'No human has authorised what this change is allowed to be.',
            tone: 'warn' as const,
          }),
    },
    {
      key: 'plan',
      label: 'Plan',
      ...(plan?.plan?.status === 'approved'
        ? {
            state: 'Approved',
            detail:
              openDeviations > 0
                ? `v${plan.plan.version} · ${openDeviations} open deviation(s)`
                : `v${plan.plan.version} · ${plan.plan.steps.length} step(s), no open deviations`,
            tone: openDeviations > 0 ? ('warn' as const) : ('ok' as const),
          }
        : {
            state: plan?.plan ? 'Not approved' : 'Not established',
            detail: 'The executor is not pinned to an immutable approved plan.',
            tone: 'warn' as const,
          }),
    },
    {
      key: 'verification',
      label: 'Verification',
      ...(verification?.decision
        ? {
            state:
              verification.decision.overallOutcome === 'pass'
                ? 'Independently verified'
                : verification.decision.overallOutcome === 'fail'
                  ? 'Failed'
                  : 'Insufficient evidence',
            detail: `${passing}/${verdicts.length} criteria passed on clean-runner evidence`,
            tone:
              verification.decision.overallOutcome === 'pass'
                ? ('ok' as const)
                : verification.decision.overallOutcome === 'fail'
                  ? ('danger' as const)
                  : ('warn' as const),
          }
        : {
            state: 'Executor claim only',
            detail: 'No independent attestation exists. Self-reported tests are not evidence.',
            tone: 'warn' as const,
          }),
    },
    {
      key: 'passport',
      label: 'Passport',
      ...(passport?.passport
        ? {
            state: passport.revocation ? 'Revoked' : passport.reviewPacket.verdict,
            detail: passport.revocation
              ? passport.revocation.reason
              : passport.reviewPacket.assurance.issuerTrustLabel,
            tone: passport.revocation
              ? ('danger' as const)
              : passport.reviewPacket.verdict === 'pass'
                ? ('ok' as const)
                : ('warn' as const),
          }
        : {
            state: 'Not issued',
            detail: 'Nothing portable to hand to a reviewer or a merge gate yet.',
            tone: 'muted' as const,
          }),
    },
  ];

  const assured = stages.every((stage) => stage.tone === 'ok');
  const provenStages = stages.filter((stage) => stage.tone === 'ok').length;
  const acceptedWithoutAssurance = task.state === 'accepted' && !assured;

  return (
    <section
      className={`assurance-summary${assured ? ' assurance-summary-complete' : ''}`}
      aria-label="Assurance chain"
    >
      <div className="assurance-summary-head">
        <div>
          <p className="eyebrow">ASSURANCE CHAIN</p>
          <strong>
            {assured
              ? 'Authorised, planned, independently verified, and signed.'
              : acceptedWithoutAssurance
                ? 'Accepted result, but assurance chain is incomplete.'
                : 'This change is not fully assured yet.'}
          </strong>
        </div>
        <span
          className="assurance-progress"
          aria-label={`${provenStages} of ${stages.length} assurance stages proven`}
        >
          <strong>{provenStages}</strong> of {stages.length} proven
        </span>
      </div>
      <ol className="assurance-stage-list">
        {stages.map((stage) => (
          <li key={stage.key} className={`assurance-stage assurance-stage-${stage.tone}`}>
            <span className="assurance-stage-label">{stage.label}</span>
            <strong className="assurance-stage-state">{stage.state}</strong>
            <span className="assurance-stage-detail">{stage.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
