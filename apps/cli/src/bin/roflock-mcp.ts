#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createRoflockMcpServer } from '../mcp-server.js';

serveStdio(() => createRoflockMcpServer());
