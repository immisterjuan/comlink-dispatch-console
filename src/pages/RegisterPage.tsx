import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { getRegistrationToken, registerSelf, type FleetUser } from '../lib/db';
import { TRACKER_TYPE_NAMES } from '../config/trackerBadges';
import { usePageTitle } from '../hooks/usePageTitle';

// Public self-registration page (/register/:token). Reached by scanning the
// invite QR from the console — deliberately outside the console login gate.
// The token is one-time and expires 1 hour after the console created it.

type Phase = 'loading' | 'blocked' | 'form' | 'done';

const RegisterPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  usePageTitle('ComLink Registration');

  const [phase, setPhase] = useState<Phase>('loading');
  const [blockedMessage, setBlockedMessage] = useState('');
  const [badge, setBadge] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState(TRACKER_TYPE_NAMES[0] ?? 'person');
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<FleetUser | null>(null);

  useEffect(() => {
    let active = true;
    getRegistrationToken(token)
      .then(row => {
        if (!active) return;
        if (!row) {
          setBlockedMessage('This registration link is invalid.');
          setPhase('blocked');
        } else if (row.claimed_at) {
          setBlockedMessage('This registration link has already been used.');
          setPhase('blocked');
        } else if (Date.parse(row.expires_at) <= Date.now()) {
          setBlockedMessage('This registration link has expired. Ask the console to create a new one.');
          setPhase('blocked');
        } else {
          setBadge(row.badge_number);
          setExpiresAt(row.expires_at);
          setPhase('form');
        }
      })
      .catch(e => {
        if (!active) return;
        setBlockedMessage(e instanceof Error ? e.message : String(e));
        setPhase('blocked');
      });
    return () => {
      active = false;
    };
  }, [token]);

  const submit = async () => {
    setSaving(true);
    setSubmitError(null);
    try {
      const user = await registerSelf({ token, name: formName, type: formType });
      setCreated(user);
      setPhase('done');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: '#f5f5f5',
        p: 2,
      }}
    >
      <Paper sx={{ p: 4, width: '100%', maxWidth: 420 }}>
        <Typography variant="h5" gutterBottom>
          ComLink Registration
        </Typography>

        {phase === 'loading' && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={32} />
          </Box>
        )}

        {phase === 'blocked' && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {blockedMessage}
          </Alert>
        )}

        {phase === 'form' && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                You are registering as
              </Typography>
              <Chip size="small" color="primary" label={badge} sx={{ fontFamily: 'monospace' }} />
            </Box>
            <Box
              component="form"
              onSubmit={e => {
                e.preventDefault();
                void submit();
              }}
              sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
            >
              <TextField
                label="Name"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                autoFocus
                required
                fullWidth
                helperText='e.g. "Unit-Alpha"'
              />
              <TextField
                label="Type"
                value={formType}
                onChange={e => setFormType(e.target.value)}
                select
                fullWidth
              >
                {TRACKER_TYPE_NAMES.map(name => (
                  <MenuItem key={name} value={name}>{name}</MenuItem>
                ))}
              </TextField>
              {submitError && <Alert severity="error">{submitError}</Alert>}
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={saving || !formName.trim()}
              >
                Register
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
              This link works once and expires {new Date(expiresAt).toLocaleTimeString()}.
            </Typography>
          </>
        )}

        {phase === 'done' && created && (
          <>
            <Alert severity="success" sx={{ my: 1 }}>
              Registration complete.
            </Alert>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Badge
            </Typography>
            <Chip color="primary" label={created.badge_number} sx={{ fontFamily: 'monospace', mb: 2 }} />
            <Typography variant="body2" color="text.secondary">
              You are registered as <b>{created.name}</b> ({created.type}). To activate this
              device in the ComLink app, ask your console operator for your Registration QR.
            </Typography>
          </>
        )}
      </Paper>
    </Box>
  );
};

export default RegisterPage;
