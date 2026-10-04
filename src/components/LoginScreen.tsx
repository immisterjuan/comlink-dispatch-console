import React, { useState } from 'react';
import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { setAuthenticated } from '../lib/auth';
import { usePageTitle } from '../hooks/usePageTitle';

// Shared gate for the dispatch console (/ and /users) and the kiosk (/kiosk).
// Password comes from VITE_CONSOLE_PASSWORD (bundled at build time).
const CONFIGURED_PASSWORD = import.meta.env.VITE_CONSOLE_PASSWORD || '';

interface LoginScreenProps {
  onAuthenticated: () => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onAuthenticated }) => {
  usePageTitle('Sign In · ComLink Console');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!CONFIGURED_PASSWORD) {
      setError('Password is not configured. Set VITE_CONSOLE_PASSWORD in the environment.');
      return;
    }
    if (password === CONFIGURED_PASSWORD) {
      setAuthenticated();
      setError(null);
      onAuthenticated();
      return;
    }
    setError('Incorrect password.');
    setPassword('');
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
      <Paper sx={{ p: 4, width: '100%', maxWidth: 380, textAlign: 'center' }}>
        <LockOutlinedIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
        <Typography variant="h5" gutterBottom>
          ComLink Console
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Enter the console password to continue.
        </Typography>
        <Box component="form" onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoFocus
            fullWidth
            error={!!error}
            helperText={error}
          />
          <Button type="submit" variant="contained" size="large" disabled={!password}>
            Sign In
          </Button>
        </Box>
        {!CONFIGURED_PASSWORD && (
          <Alert severity="error" sx={{ mt: 2 }}>
            VITE_CONSOLE_PASSWORD is not set.
          </Alert>
        )}
      </Paper>
    </Box>
  );
};

export default LoginScreen;
