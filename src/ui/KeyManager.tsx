/**
 * Octo API Key Manager (Slice 13)
 *
 * The agent/app credential surface: mint account-wide or workspace-scoped keys
 * with a named preset (or an explicit scope list) and an expiry, revoke keys,
 * and read the endpoint contract a key can call.
 */

import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { ApiKey } from '../api/keys';
import { OCTO_CAPABILITIES, SCOPE_PRESETS } from '../api/capabilities';

export interface CreateKeyOptions {
  scopes?: string[];
  expiresInDays?: number | null;
}

export interface KeyManagerProps {
  apiKeys: ApiKey[];
  workspaceName?: string;
  isPlatformOwner?: boolean;
  onCreateApiKey?: (
    name: string,
    isAccountWide: boolean,
    options?: CreateKeyOptions
  ) => Promise<{ rawSecret: string }>;
  onRevokeApiKey?: (keyId: string) => Promise<void>;
}

const ALL_SCOPES = ['read', 'write', 'files', 'delete'];

/** The endpoint list and a curl example: the contract an agent/app programs to. */
function UsagePanel({ isPlatformOwner }: { isPlatformOwner: boolean }) {
  const curlExample =
    'curl -H "Authorization: Bearer octo_live_ws_..." \\\n' +
    '  "https://<your-octo-host>/api/files?workspaceId=<workspace-id>"';

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
        📖 Using your key
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Send the secret as a Bearer token. A workspace key is pinned to its own workspace; an
        account-wide key reaches every workspace its principal belongs to.
      </Typography>
      <Box
        component="pre"
        sx={{
          m: 0,
          mb: 2,
          p: 1.5,
          bgcolor: '#0f172a',
          color: '#e2e8f0',
          borderRadius: 1.5,
          fontSize: '0.78rem',
          overflowX: 'auto',
        }}
      >
        {curlExample}
      </Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, width: '22%' }}>Action</TableCell>
              <TableCell sx={{ fontWeight: 600, width: '12%' }}>Method</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Path</TableCell>
              <TableCell sx={{ fontWeight: 600, width: '14%' }}>Scope</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {OCTO_CAPABILITIES.map((c) => (
              <TableRow key={c.action}>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{c.action}</TableCell>
                <TableCell>
                  <Chip label={c.method} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{c.path}</TableCell>
                <TableCell>
                  <Chip
                    label={c.requiredScope}
                    size="small"
                    color="primary"
                    variant="outlined"
                    sx={{ fontSize: '0.7rem' }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {isPlatformOwner && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Platform-owner keys may additionally carry the <code>admin</code> scope for cross-tenant
          operations.
        </Typography>
      )}
    </Box>
  );
}

export const KeyManager: React.FC<KeyManagerProps> = ({
  apiKeys,
  workspaceName,
  isPlatformOwner = false,
  onCreateApiKey,
  onRevokeApiKey,
}) => {
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyIsAccountWide, setNewKeyIsAccountWide] = useState(false);
  const [presetId, setPresetId] = useState('read-write');
  const [customScopes, setCustomScopes] = useState<string[]>(['read', 'write', 'files']);
  const [expiresInDays, setExpiresInDays] = useState<number>(0);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isCustom = presetId === 'custom';
  const effectiveScopes = isCustom
    ? customScopes
    : SCOPE_PRESETS.find((p) => p.id === presetId)?.scopes ?? ['read', 'write', 'files'];

  const handleCreateKey = async () => {
    if (!newKeyName.trim() || !onCreateApiKey) return;
    setError(null);
    try {
      const res = await onCreateApiKey(newKeyName.trim(), newKeyIsAccountWide, {
        scopes: effectiveScopes,
        expiresInDays: expiresInDays > 0 ? expiresInDays : null,
      });
      setCreatedSecret(res.rawSecret);
      setNewKeyName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create API key');
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!onRevokeApiKey) return;
    setError(null);
    try {
      await onRevokeApiKey(keyId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke API key');
    }
  };

  return (
    <Card sx={{ mb: 4, borderRadius: 2 }}>
      <Box sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          🔑 API Keys (Account-Wide & Workspace-Scoped)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Machine credentials for your app or agent. Hashed with SHA-256; the secret is shown once.
          One account-wide key per account, one workspace key per workspace.
        </Typography>

        {createdSecret && (
          <Card sx={{ p: 2, mb: 3, bgcolor: '#f0fdf4', borderColor: '#86efac', borderRadius: 2 }}>
            <Typography variant="subtitle2" sx={{ color: '#166534', fontWeight: 600 }}>
              New API Key Minted (Copy Now - will not be displayed again):
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', mt: 0.5 }}>
              {createdSecret}
            </Typography>
          </Card>
        )}

        {error && (
          <Card sx={{ p: 1.5, mb: 2, bgcolor: '#fef2f2', borderColor: '#fecaca', borderRadius: 2 }}>
            <Typography variant="body2" sx={{ color: '#991b1b' }}>
              {error}
            </Typography>
          </Card>
        )}

        {onCreateApiKey && (
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              label="Key Name"
              placeholder="e.g. Ingest Agent"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              sx={{ width: 200 }}
            />
            <Select
              size="small"
              value={newKeyIsAccountWide ? 'account' : 'workspace'}
              onChange={(e) => setNewKeyIsAccountWide(e.target.value === 'account')}
              sx={{ width: 190 }}
            >
              <MenuItem value="workspace">Workspace-Scoped{workspaceName ? ` (${workspaceName})` : ''}</MenuItem>
              <MenuItem value="account">Account-Wide</MenuItem>
            </Select>
            <Select
              size="small"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              sx={{ width: 180 }}
            >
              {SCOPE_PRESETS.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.label}
                </MenuItem>
              ))}
              <MenuItem value="custom">Custom…</MenuItem>
            </Select>
            <Select
              size="small"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
              sx={{ width: 170 }}
            >
              <MenuItem value={0}>No expiry</MenuItem>
              <MenuItem value={30}>Expires in 30 days</MenuItem>
              <MenuItem value={90}>Expires in 90 days</MenuItem>
              <MenuItem value={365}>Expires in 1 year</MenuItem>
            </Select>
            <Button
              variant="contained"
              size="medium"
              onClick={handleCreateKey}
              disabled={!newKeyName.trim() || (isCustom && customScopes.length === 0)}
              sx={{ whiteSpace: 'nowrap' }}
            >
              Generate API Key
            </Button>
          </Box>
        )}

        {isCustom && (
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
              Custom scopes:
            </Typography>
            {ALL_SCOPES.map((scope) => (
              <FormControlLabel
                key={scope}
                control={
                  <Checkbox
                    size="small"
                    checked={customScopes.includes(scope)}
                    onChange={() =>
                      setCustomScopes((prev) =>
                        prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
                      )
                    }
                  />
                }
                label={<Typography variant="body2">{scope}</Typography>}
              />
            ))}
          </Box>
        )}

        {apiKeys.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            No API keys generated yet.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Prefix</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Scope</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Scopes</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Expires</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Last Used</TableCell>
                  {onRevokeApiKey && (
                    <TableCell sx={{ fontWeight: 600 }} align="right">
                      Actions
                    </TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {apiKeys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell sx={{ fontWeight: 500 }}>{k.name}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <code>{k.prefix}...</code>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Chip
                        label={k.isAccountWide ? 'Account-Wide' : 'Workspace-Scoped'}
                        size="small"
                        color={k.isAccountWide ? 'primary' : 'default'}
                      />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{k.scopes.join(', ')}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : 'Never'}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}
                    </TableCell>
                    {onRevokeApiKey && (
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          onClick={() => handleRevoke(k.id)}
                          sx={{ whiteSpace: 'nowrap' }}
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        <Divider sx={{ my: 3 }} />
        <UsagePanel isPlatformOwner={isPlatformOwner} />
      </Box>
    </Card>
  );
};
