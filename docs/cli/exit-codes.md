# CLI exit-code contract

Roflock uses stable process exit classes so CI and harnesses do not need to
parse human prose. Existing numeric meanings will not be repurposed during the
public-alpha line.

| Code | Name       | Meaning                                                               | Typical response                     |
| ---: | ---------- | --------------------------------------------------------------------- | ------------------------------------ |
|    0 | success    | Command completed, or a queried run is running/completed.             | Continue.                            |
|    1 | internal   | Unexpected Roflock fault or a daemon state unknown to this CLI.       | Preserve diagnostics; report a bug.  |
|    2 | usage      | Bad arguments, invalid source/IR, unknown ID, or bad API input.       | Fix input; do not retry unchanged.   |
|    3 | config     | Environment/auth/session/repository/daemon configuration failed.      | Repair local setup and rerun doctor. |
|    4 | run failed | The governed run or required check failed/rejected.                   | Inspect status/events/evidence.      |
|    5 | blocked    | Human decision, paused state, conflict, or safe gate is pending.      | Resolve the named gate, then resume. |
|    6 | cancelled  | The run was cancelled/stopping or interrupted without a driver fault. | Inspect cancellation certainty.      |
|    7 | driver     | A provider/driver is unavailable or a billable outcome is unknown.    | Fix routing/auth; avoid blind retry. |

Discover the exact contract from the installed artifact:

```bash
roflock help --json
```

## Run-state mapping

`roflock status <run-id>` maps the durable run projection as follows:

- `running`, `completed`, `accepted` → 0;
- `failed`, `rejected` → 4;
- `paused`, `awaiting_confirmation`, `awaiting_acceptance`, `ready`, `draft` → 5;
- `cancelled`, `stopping` → 6;
- `interrupted` with `setup_required`, `provider_unavailable`,
  `outcome_unknown`, or another recorded blocker → 7;
- `interrupted` without a blocker → 6; and
- an unknown future state → 1, never silent success.

The graph-run API currently emits `running`, `completed`, `failed`,
`interrupted`, or `cancelled`. Additional task states above are reserved so the
same mapping remains safe if a projection becomes more detailed.

## HTTP/error mapping

Runtime commands map daemon failures consistently:

- no connection, `401`, or `403` → 3;
- `400` or `404` → 2;
- `409` → 5;
- `422 WORKFLOW_INVALID` and other bad workflow input → 2;
- `422 RUN_START_FAILED` → 7; and
- otherwise the command's documented fallback, usually 1.

## JSON streams

With `--json`, successful automation commands emit exactly one JSON document on
stdout. Failures emit exactly one object on stderr:

```json
{
  "error": {
    "message": "No provider is runnable",
    "code": "RUN_START_FAILED",
    "httpStatus": 422
  },
  "exitCode": 7
}
```

Fields inside `error` other than `message` may be absent when the source cannot
provide them. Consumers should branch on the process code first, then use the
structured object for detail. Warnings/progress never precede a JSON success
document on stdout.

Some commands intentionally use non-zero for a successful query whose answer
requires action: `approvals` returns 5 when pending requests exist, `drivers`
returns 7 when none is runnable, and `doctor` returns 3 when the environment is
not ready. Their JSON result is still emitted and should be inspected.
