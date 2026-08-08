# Local control-surface API v1

Roflock exposes one authenticated loopback API for Studio, the CLI, MCP, and
optional external control surfaces. It is a client boundary around the existing
runtime, not an alternate execution engine.

```text
external UI / harness
        ↓ loopback HTTP
  /api/control/v1
        ↓
compiler → Graph IR → runGraph → drivers/checks/humans
```

## Discover the contract

Start the local daemon, read the mode-`0600` `session.json` in the active data
directory, and call:

```http
GET /api/control/v1
x-roleflock-token: <session token>
```

The response names the v1 operations, auth headers, event ordering, approval
rule, and cancellation-discovery endpoint. It never returns the session token.

Default base URL: `http://127.0.0.1:4178`. Override it with the same
`ROFLOCK_PORT` / `ROFLOCK_DAEMON_URL` configuration used by the CLI. A server
bound to a non-loopback interface is not part of this contract.

## Authentication and CSRF

- Every control endpoint requires `x-roleflock-token` or the daemon's strict
  httpOnly session cookie.
- Every `POST` also requires `x-roleflock-csrf`.
- Tokens must not appear in query strings, logs, source control, MCP responses,
  or integration configuration committed to a repository.
- A `401` means the session is absent/invalid. A `403` means CSRF/origin policy
  rejected a state-changing request.

The initial browser handoff query parameter is only for Studio's one-time local
handoff; control-surface clients must use headers.

## Stable operations

| Purpose            | Method | Path                                        |
| ------------------ | ------ | ------------------------------------------- |
| Runtime info       | GET    | `/api/runtime/info`                         |
| Workflow list      | GET    | `/api/workflows`                            |
| Register project   | POST   | `/api/projects`                             |
| Start exact source | POST   | `/api/runtime/runs`                         |
| Run status         | GET    | `/api/runs/{runId}`                         |
| Ordered events     | GET    | `/api/runs/{runId}/events?after={sequence}` |
| Pause              | POST   | `/api/runs/{runId}/pause`                   |
| Resume             | POST   | `/api/runs/{runId}/resume`                  |
| Cancel             | POST   | `/api/runs/{runId}/cancel`                  |
| Pending approvals  | GET    | `/api/approvals?runId={runId}`              |
| Inspect approval   | GET    | `/api/approvals/{approvalId}`               |
| Approve request    | POST   | `/api/approvals/{approvalId}/approve`       |
| Reject request     | POST   | `/api/approvals/{approvalId}/reject`        |
| Live event stream  | GET    | `/api/events/stream`                        |

Paths and field meanings above are the public-alpha v1 contract. New optional
fields and endpoints may be added. Existing fields are not repurposed silently.

## Start a workflow

Register the repository first:

```json
POST /api/projects
{"path":"/absolute/path/to/repository"}
```

Then submit complete `.roflock` source:

```json
POST /api/runtime/runs
{
  "projectId": "project-id",
  "source": "workflow ...",
  "brief": "Fix the failing behavior",
  "title": "Optional display title",
  "allowUncontracted": true
}
```

The response carries stable `taskId`, `graphRunId`, `workflowId`, and
`semanticHash`. The daemon stores the immutable source/IR/executable snapshot
before scheduling.

## Events and reconnection

`sequence` is monotonic within one run aggregate. Persist the greatest sequence
processed and reconnect with `?after=<sequence>`. Clients must tolerate new
event types and fields while preserving order. SSE is useful for UI refresh;
the durable cursor endpoint is the recovery authority after disconnects.

## Controls and cancellation

Pause stops new scheduling. Resume continues the exact current durable run.
Cancel requests interruption from selected drivers, but the wording shown to a
user must match `/api/tasks/{taskId}/cancellation`. Only `remote-confirmed` may
be described as certainly stopped; local-process cancellation may leave remote
work or billing active.

## Approval rule

There is no approve-all endpoint. A client must list or inspect requests, show
the exact action to a human, and decide one still-pending approval ID. MCP v1
does not expose approval tools at all. A control surface must not infer human
authority from the agent or process that started a run.

## Compatibility and errors

- `400`/`422`: invalid input or workflow; do not retry unchanged.
- `404`: unknown stable identity.
- `409`: state conflict, stale decision, or control not valid now.
- `401`/`403`: session/CSRF/origin failure.
- `5xx`: daemon fault; query durable status before retrying a billable action.

Historical graph versions and persisted task snapshots remain executable.
Clients should display unknown additive fields and event types conservatively,
not discard the run.
