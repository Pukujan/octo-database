/**
 * Octo MCP adapter.
 *
 * Exposes the workspace surface as MCP tools so an agent can drive Octo with the
 * same token a human or script would use: an account-wide key
 * (`octo_live_acc_`) manages every workspace the principal belongs to, while a
 * workspace-scoped key (`octo_live_ws_`) is confined to its own workspace by the
 * server. The adapter adds no policy of its own — it forwards to the API and
 * reports what the API decided.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OctoApi } from './client';

function asText(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function asError(error: unknown): {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
} {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export function createOctoMcpServer(api: OctoApi): McpServer {
  const server = new McpServer({ name: 'octo', version: '0.1.0' });

  server.tool('whoami', 'Identify the principal and scopes behind the configured Octo token.', {}, async () => {
    try {
      return asText(await api.me());
    } catch (error) {
      return asError(error);
    }
  });

  server.tool(
    'list_workspaces',
    'List the workspaces the configured token can reach. An account-wide token lists every workspace the principal belongs to; a workspace-scoped token lists only its own.',
    {},
    async () => {
      try {
        return asText(await api.listWorkspaces());
      } catch (error) {
        return asError(error);
      }
    }
  );

  server.tool(
    'list_files',
    'List the files in a workspace.',
    { workspaceId: z.string().describe('The workspace to list files from') },
    async ({ workspaceId }) => {
      try {
        return asText(await api.listFiles(workspaceId));
      } catch (error) {
        return asError(error);
      }
    }
  );

  server.tool(
    'upload_file',
    'Upload a file into a workspace. The content is base64-encoded; the server stores the bytes.',
    {
      workspaceId: z.string().describe('The workspace to upload into'),
      name: z.string().describe('Destination path within the workspace'),
      dataBase64: z.string().describe('File content, base64-encoded'),
      mimeType: z.string().optional().describe('MIME type (defaults to application/octet-stream)'),
    },
    async ({ workspaceId, name, dataBase64, mimeType }) => {
      try {
        return asText(await api.uploadFile({ workspaceId, name, data: dataBase64, mimeType }));
      } catch (error) {
        return asError(error);
      }
    }
  );

  server.tool(
    'query_workspace',
    'Answer a natural-language question from a workspace\'s indexed documents.',
    {
      workspaceId: z.string().describe('The workspace to query'),
      query: z.string().describe('The question to answer'),
      limit: z.number().int().positive().optional().describe('Maximum number of passages to retrieve'),
    },
    async ({ workspaceId, query, limit }) => {
      try {
        return asText(await api.query({ workspaceId, query, limit }));
      } catch (error) {
        return asError(error);
      }
    }
  );

  return server;
}
