import React, { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DeleteIcon from '@mui/icons-material/Delete';
import LogoutIcon from '@mui/icons-material/Logout';
import NetworkCheckIcon from '@mui/icons-material/NetworkCheck';
import { useConsoleData } from '../context/consoleContext';
import { MAP_CHANNEL, isSupabaseInitialized } from '../supabaseClient';
import { logout } from '../lib/auth';
import { usePageTitle } from '../hooks/usePageTitle';

const Settings: React.FC = () => {
  usePageTitle('Settings · ComLink Console');
  const { markers, geojsons, broadcastUpdate, kiosk } = useConsoleData();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target?.result as string);
        broadcastUpdate(markers, [...geojsons, { id: Math.random().toString(36).substr(2, 9), data }]);
        setNotice('GeoJSON overlay pushed to the map.');
      } catch {
        alert('Invalid GeoJSON file');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const clearMap = () => {
    if (!window.confirm('Remove all pins and overlays from the map?')) return;
    broadcastUpdate([], []);
    setNotice('Map cleared.');
  };

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 860 }}>
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Connection
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell component="th" sx={{ color: 'text.secondary', width: 180 }}>
                  Supabase
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    color={isSupabaseInitialized ? 'success' : 'error'}
                    label={isSupabaseInitialized ? 'Connected' : 'Offline / not configured'}
                  />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell component="th" sx={{ color: 'text.secondary' }}>
                  Project URL
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 13 }}>
                  {import.meta.env.VITE_SUPABASE_URL || '—'}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell component="th" sx={{ color: 'text.secondary' }}>
                  Realtime channel
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 13 }}>{MAP_CHANNEL}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Kiosk Link
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Chip
            size="small"
            color={kiosk.kioskOnline ? 'success' : 'default'}
            variant={kiosk.kioskOnline ? 'filled' : 'outlined'}
            label={
              !kiosk.linkAvailable
                ? 'Not available'
                : kiosk.kioskOnline
                  ? `Online${kiosk.lastRttMs !== null ? ` \u00b7 ${kiosk.lastRttMs}ms` : ''}`
                  : kiosk.connected
                    ? 'Offline'
                    : 'Link down'
            }
          />
          <Button
            size="small"
            variant="outlined"
            startIcon={<NetworkCheckIcon />}
            onClick={() => void kiosk.sendCommand('ping')}
          >
            Ping Kiosk
          </Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Map &amp; Overlays
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Changes are broadcast to every kiosk and console.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <input
            type="file"
            accept=".geojson,.json"
            style={{ display: 'none' }}
            ref={fileInputRef}
            onChange={handleFileUpload}
          />
          <Button variant="contained" startIcon={<UploadFileIcon />} onClick={() => fileInputRef.current?.click()}>
            Upload GeoJSON
          </Button>
          <Button variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={clearMap}>
            Clear Map
          </Button>
        </Box>
        <Divider sx={{ my: 2 }} />
        <Typography variant="caption" color="text.secondary">
          {markers.filter(m => m.markerType === 'default' || m.markerType === 'flag').length} pin(s) ·{' '}
          {geojsons.length} overlay(s)
        </Typography>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Session
        </Typography>
        <Button
          variant="outlined"
          color="error"
          startIcon={<LogoutIcon />}
          onClick={() => {
            logout();
            window.location.reload();
          }}
        >
          Sign Out
        </Button>
      </Paper>
    </Box>
  );
};

export default Settings;
