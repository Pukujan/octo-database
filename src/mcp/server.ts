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
    'create_workspace',
    'Create a workspace and mint its first API key. Returns the workspace plus the new key; the raw secret is shown exactly once. Requires an account-wide token — a workspace-scoped key cannot create workspaces.',
    {
      name: z.string().describe('Human-readable workspace name'),
      slug: z.string().optional().describe('URL slug (defaults to a slugified name)'),
      description: z.string().optional().describe('Optional workspace description'),
      retentionDays: z.number().int().positive().optional().describe('Optional retention window in days'),
    },
    async ({ name, slug, description, retentionDays }) => {
      try {
        return asText(await api.createWorkspace({ name, slug, description, retentionDays }));
      } catch (error) {
        return asError(error);
      }
    }
  );

  server.tool(
    'mint_key',
    'Mint an API key. Omit workspaceId for an account-wide key (one per principal) or pass one for a workspace-scoped key. A token may only narrow its own authority: it cannot widen its scopes or escape its workspace. Minting is human-stamped, so it requires a session with the confirmation secret. The raw secret is shown exactly once.',
    {
      name: z.string().describe('Label for the new key'),
      workspaceId: z.string().optional().describe('Workspace to scope the key to (omit for account-wide)'),
      scopes: z
        .array(z.enum(['read', 'write', 'files', 'delete']))
        .optional()
        .describe('Requested scopes (defaults to read, write, files)'),
      expiresInDays: z.number().int().positive().optional().describe('Optional expiry in days'),
    },
    async ({ name, workspaceId, scopes, expiresInDays }) => {
      try {
        return asText(await api.mintKey({ name, workspaceId, scopes, expiresInDays }));
      } catch (error) {
        return asError(error);
      }
    }
  );

  server.tool(
    'provision_database',
    'Provision a real PostgreSQL database owned by a workspace and return its connection string. The string is shown exactly once; connect to it with an ordinary Postgres client to create and use your own tables. Requires an account-wide token, and a workspace that does not already have a database.',
    { workspaceId: z.string().describe('The workspace to provision a database for') },
    async ({ workspaceId }) => {
      try {
        return asText(await api.provisionDatabase({ workspaceId }));
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
    'download_file',
    'Download a file\'s bytes from a workspace, returned base64-encoded.',
    {
      workspaceId: z.string().describe('The workspace the file belongs to'),
      fileId: z.string().describe('The file id (from list_files)'),
    },
    async ({ workspaceId, fileId }) => {
      try {
        return asText(await api.downloadFile({ workspaceId, fileId }));
      } catch (error) {
        return asError(error);
      }
    }
  );

  server.tool(
    'delete_file',
    'Delete a file from a workspace. Requires the delete scope and an owner or admin role in the workspace.',
    {
      workspaceId: z.string().describe('The workspace the file belongs to'),
      fileId: z.string().describe('The file id (from list_files)'),
    },
    async ({ workspaceId, fileId }) => {
      try {
        return asText(await api.deleteFile({ workspaceId, fileId }));
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
