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
  FormControl,
  FormControlLabel,
  InputLabel,
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
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5, color: 'text.primary' }}>
        Use an API key
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
          p: 2,
          bgcolor: 'background.default',
          color: 'text.primary',
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
          fontSize: '0.78rem',
          overflowX: 'auto',
        }}
      >
        {curlExample}
      </Box>
      <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              <TableCell sx={{ fontWeight: 600, width: '22%', color: 'text.secondary' }}>Action</TableCell>
              <TableCell sx={{ fontWeight: 600, width: '12%', color: 'text.secondary' }}>Method</TableCell>
              <TableCell sx={{ fontWeight: 600, color: 'text.secondary' }}>Path</TableCell>
              <TableCell sx={{ fontWeight: 600, width: '14%', color: 'text.secondary' }}>Scope</TableCell>
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
    setCreatedSecret(null);
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
    <Card sx={{ mb: 4, borderRadius: 3, bgcolor: 'background.paper', borderColor: 'divider' }}>
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 3 }}>
          <Typography variant="overline" color="primary.main" sx={{ fontWeight: 700, letterSpacing: '0.12em' }}>
            Access
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary' }}>
            API keys
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 680 }}>
            Give an app or agent access to a workspace or your account. Each secret is shown once when
            you create it.
          </Typography>
        </Box>

        {createdSecret && (
          <Card sx={{ p: 2, mb: 3, bgcolor: 'action.hover', borderColor: 'success.main', borderRadius: 2 }}>
            <Typography variant="subtitle2" color="success.main" sx={{ fontWeight: 700 }}>
              New API Key Minted. Copy this secret now; it will not be shown again.
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', mt: 1, color: 'text.primary' }}>
              {createdSecret}
            </Typography>
          </Card>
        )}

        {error && (
          <Card sx={{ p: 1.5, mb: 2, bgcolor: 'action.hover', borderColor: 'error.main', borderRadius: 2 }}>
            <Typography variant="body2" color="error.main">
              {error}
            </Typography>
          </Card>
        )}

        {onCreateApiKey && (
          <Box sx={{ p: { xs: 2, sm: 2.5 }, mb: 3, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.default' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2, color: 'text.primary' }}>
              Create a key
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
              <TextField
                size="small"
                label="Key name"
                placeholder="e.g. Ingest Agent"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                fullWidth
              />
              <FormControl size="small" fullWidth>
                <InputLabel id="key-access-label">Access</InputLabel>
                <Select
                  labelId="key-access-label"
                  label="Access"
                  value={newKeyIsAccountWide ? 'account' : 'workspace'}
                  onChange={(e) => setNewKeyIsAccountWide(e.target.value === 'account')}
                >
                  <MenuItem value="workspace">Workspace{workspaceName ? ` (${workspaceName})` : ''}</MenuItem>
                  <MenuItem value="account">Account-wide</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth>
                <InputLabel id="key-permissions-label">Permissions</InputLabel>
                <Select
                  labelId="key-permissions-label"
                  label="Permissions"
                  value={presetId}
                  onChange={(e) => setPresetId(e.target.value)}
                >
                  {SCOPE_PRESETS.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.label}
                    </MenuItem>
                  ))}
                  <MenuItem value="custom">Custom scopes</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth>
                <InputLabel id="key-expiry-label">Expiry</InputLabel>
                <Select
                  labelId="key-expiry-label"
                  label="Expiry"
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                >
                  <MenuItem value={0}>No expiry</MenuItem>
                  <MenuItem value={30}>Expires in 30 days</MenuItem>
                  <MenuItem value={90}>Expires in 90 days</MenuItem>
                  <MenuItem value={365}>Expires in 1 year</MenuItem>
                </Select>
              </FormControl>
            </Box>
            {isCustom && (
              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mt: 2, flexWrap: 'wrap' }}>
                <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
                  Custom scopes
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
            <Button
              variant="contained"
              size="medium"
              onClick={handleCreateKey}
              disabled={!newKeyName.trim() || (isCustom && customScopes.length === 0)}
              sx={{ mt: 2, whiteSpace: 'nowrap' }}
            >
              Generate API Key
            </Button>
          </Box>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>
            Current keys
          </Typography>
          <Chip label={apiKeys.length} size="small" variant="outlined" />
        </Box>
        {apiKeys.length === 0 ? (
          <Box sx={{ p: 2.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
            <Typography variant="body2" color="text.secondary">
              No API keys yet. Create one to connect an app or agent.
            </Typography>
          </Box>
        ) : (
          <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary' }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary' }}>Prefix</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary' }}>Access</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary' }}>Scopes</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary' }}>Expires</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'text.secondary' }}>Last used</TableCell>
                  {onRevokeApiKey && (
                    <TableCell sx={{ fontWeight: 600, color: 'text.secondary' }} align="right">
                      Actions
                    </TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {apiKeys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{k.name}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                      <code>{k.prefix}...</code>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Chip
                        label={k.isAccountWide ? 'Account-wide' : 'Workspace'}
                        size="small"
                        color={k.isAccountWide ? 'primary' : 'default'}
                        variant="outlined"
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

        <Divider sx={{ my: 3, borderColor: 'divider' }} />
        <UsagePanel isPlatformOwner={isPlatformOwner} />
      </Box>
    </Card>
  );
};
