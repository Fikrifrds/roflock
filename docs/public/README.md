# RoleFlock

**Governed multi-agent software engineering — local-first.**

RoleFlock runs on your machine. You register Git repositories, define tasks, and let a role graph (planner, reviewer, writer, test, verifier, accept) execute with explicit approvals, evidence, and usage metering.

## Why local-first

- Daemon binds to **127.0.0.1** by default — not exposed to your LAN.
- Repository contents stay on disk unless **you** attach them to a task or a provider CLI reads them under your OS user.
- Update checks send **product name, version, and platform only** — never repository paths or file contents.
- Local SQLite data can be **backed up, exported, and deleted** from the Privacy controls.

## What you can do today (Phase 0 MVP)

- Register local Git projects and run **Verified Fix** bug workflows.
- Connect **Claude, Codex, Cursor**, or custom OpenAI-compatible providers via CLI discovery.
- Approve reviewer gates; inspect disclosure manifests and evidence bundles.
- Export audit and diagnostics with secret redaction.

## Get started

See the repository README for build and run instructions. First-run guide: [`docs/product/verified-fix-onboarding.md`](../product/verified-fix-onboarding.md).

## Privacy

Summary: [`privacy.md`](privacy.md)  
Live claims from a running daemon: `GET /api/privacy`

## Safety

Threat model (local boundary): [`docs/security/threat-model.md`](../security/threat-model.md)

## Status

Phase 0 — ready for local testing. No installer DMG yet; run from source with Node 24+ and pnpm.

**RoleFlock by Mlola** — https://roleflock.com
