import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { isExecutable, normalizeIR } from '@roleflock/graph-ir';
import { compile } from '@roleflock/language';
import * as z from 'zod';
import { DaemonClient, type DaemonClientOptions } from './daemon-client.js';
import { cliVersion } from './main.js';
import type { RunEvent, RunProjection } from './runtime-inspection-command.js';

export const ROFLOCK_MCP_TOOLS = [
  'roflock_check',
  'roflock_compile',
  'roflock_run',
  'roflock_status',
  'roflock_events',
] as const;

interface StartedRun {
  accepted: true;
  taskId: string;
  graphRunId: string;
  workflowId: string;
  semanticHash: string;
  contract?: { mode: string; warning: string };
}

export class RoflockMcpOperations {
  private readonly client: DaemonClient;

  constructor(clientOptions: DaemonClientOptions = {}) {
    this.client = new DaemonClient(clientOptions);
  }

  check(source: string, uri = 'mcp://workflow.roflock') {
    const result = compile(source, { uri });
    return {
      executable: Boolean(result.ir) && isExecutable(result.diagnostics),
      diagnostics: result.diagnostics,
      ...(result.ir === undefined
        ? {}
        : {
            workflow: result.ir.workflow,
            counts: {
              nodes: result.ir.nodes.length,
              edges: result.ir.edges.length,
              loops: result.ir.loops.length,
            },
          }),
    };
  }

  compile(source: string, uri = 'mcp://workflow.roflock') {
    const result = compile(source, { uri });
    return {
      executable: Boolean(result.ir) && isExecutable(result.diagnostics),
      diagnostics: result.diagnostics,
      ...(result.ir === undefined ? {} : { graphIr: normalizeIR(result.ir) }),
    };
  }

  async run(input: {
    source: string;
    repository: string;
    brief: string;
    title?: string;
  }): Promise<StartedRun> {
    const checked = this.check(input.source);
    if (!checked.executable) {
      throw new Error(`Workflow is not executable: ${JSON.stringify(checked.diagnostics)}`);
    }
    const project = await this.client.request<{ id: string }>('POST', '/api/projects', {
      path: resolve(input.repository),
    });
    return this.client.request<StartedRun>('POST', '/api/runtime/runs', {
      projectId: project.id,
      source: input.source,
      title: input.title,
      brief: input.brief,
      allowUncontracted: true,
    });
  }

  status(runId: string): Promise<RunProjection> {
    return this.client.request('GET', `/api/runs/${encodeURIComponent(runId)}`);
  }

  events(runId: string, after = 0): Promise<RunEvent[]> {
    return this.client.request(
      'GET',
      `/api/runs/${encodeURIComponent(runId)}/events?after=${after}`,
    );
  }
}

function toolResult(value: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
  };
}

async function guarded(body: () => unknown | Promise<unknown>) {
  try {
    const value = await body();
    const structured = Array.isArray(value)
      ? { items: value }
      : value !== null && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : { value };
    return toolResult(structured);
  } catch (error) {
    return toolResult(
      { error: error instanceof Error ? error.message : 'Roflock MCP operation failed' },
      true,
    );
  }
}

export function createRoflockMcpServer(
  dependencies: { operations?: RoflockMcpOperations; version?: string } = {},
): McpServer {
  const operations = dependencies.operations ?? new RoflockMcpOperations();
  const server = new McpServer(
    { name: 'roflock', version: dependencies.version ?? cliVersion() },
    {
      capabilities: { tools: {} },
      instructions:
        'Compile and run Roflock workflows through the local governed runtime. This server intentionally exposes no approval or rejection tool; protected decisions remain external and human-owned.',
    },
  );

  const sourceSchema = z.object({
    source: z.string().min(1).describe('Complete .roflock source text'),
    uri: z.string().optional().describe('Diagnostic source identifier'),
  });
  server.registerTool(
    'roflock_check',
    {
      title: 'Check a Roflock workflow',
      description: 'Compile and validate source without filesystem, daemon, or execution access.',
      inputSchema: sourceSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    ({ source, uri }) => guarded(() => operations.check(source, uri)),
  );
  server.registerTool(
    'roflock_compile',
    {
      title: 'Compile a Roflock workflow',
      description: 'Return canonical Graph IR and diagnostics without starting a run.',
      inputSchema: sourceSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    ({ source, uri }) => guarded(() => operations.compile(source, uri)),
  );
  server.registerTool(
    'roflock_run',
    {
      title: 'Start a governed local Roflock run',
      description:
        'Compile exact source, register the repository, and start the existing local runtime. Human approval gates remain external.',
      inputSchema: z.object({
        source: z.string().min(1),
        repository: z.string().min(1),
        brief: z.string().min(1),
        title: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (input) => guarded(() => operations.run(input)),
  );
  server.registerTool(
    'roflock_status',
    {
      title: 'Read durable run status',
      description: 'Read one durable run projection from the authenticated local daemon.',
      inputSchema: z.object({ runId: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    ({ runId }) => guarded(() => operations.status(runId)),
  );
  server.registerTool(
    'roflock_events',
    {
      title: 'Read durable run events',
      description: 'Read ordered events after a durable sequence cursor.',
      inputSchema: z.object({
        runId: z.string().min(1),
        after: z.number().int().nonnegative().default(0),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    ({ runId, after }) => guarded(() => operations.events(runId, after)),
  );

  return server;
}
