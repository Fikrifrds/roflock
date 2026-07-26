#!/usr/bin/env bash
set -euo pipefail
pnpm dev &
daemon_pid=$!
trap 'kill "$daemon_pid"' EXIT
pnpm dev:web
