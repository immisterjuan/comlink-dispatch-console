import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppBar, Box, Chip, IconButton, Toolbar, Tooltip, Typography } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import Sidebar from './Sidebar';
import { ConsoleDataContext, useConsoleData } from '../../context/consoleContext';
import { useMapSync } from '../../hooks/useMapSync';
import { useKioskLink } from '../../hooks/useKioskLink';
import { logout } from '../../lib/auth';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/map': 'Map',
  '/users': 'Users',
  '/settings': 'Settings',
};

// Mounts the shared console data (live marker sync + kiosk link) exactly once
// for all nested console routes, so state survives navigation.
const ConsoleDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const mapSync = useMapSync('dispatch');
  const kiosk = useKioskLink('dispatch');
  return (
    <ConsoleDataContext.Provider value={{ ...mapSync, kiosk }}>
      {children}
    </ConsoleDataContext.Provider>
  );
};

const LayoutChrome: React.FC = () => {
  const location = useLocation();
  const { onlineUsers, kiosk } = useConsoleData();
  const title = PAGE_TITLES[location.pathname] ?? 'ComLink';

  const kioskLabel = !kiosk.linkAvailable
    ? 'Kiosk: n/a'
    : kiosk.kioskOnline
      ? `Kiosk: online${kiosk.lastRttMs !== null ? ` \u00b7 ${kiosk.lastRttMs}ms` : ''}`
      : kiosk.connected
        ? 'Kiosk: offline'
        : 'Kiosk: link down';

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />

      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <AppBar position="static" color="default" elevation={1}>
          <Toolbar variant="dense">
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              {title}
            </Typography>
            <Chip size="small" variant="outlined" label={`Online: ${onlineUsers}`} sx={{ mr: 1 }} />
            <Tooltip title="Ping kiosk">
              <Chip
                size="small"
                variant="outlined"
                color={kiosk.kioskOnline ? 'success' : 'default'}
                label={kioskLabel}
                onClick={() => void kiosk.sendCommand('ping')}
                sx={{ mr: 1, cursor: 'pointer' }}
              />
            </Tooltip>
            <Tooltip title="Sign out">
              <IconButton size="small" onClick={() => { logout(); window.location.reload(); }}>
                <LogoutIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Toolbar>
        </AppBar>

        <Box component="main" sx={{ flexGrow: 1, overflow: 'auto', bgcolor: '#fafafa' }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
};

const ConsoleLayout: React.FC = () => (
  <ConsoleDataProvider>
    <LayoutChrome />
  </ConsoleDataProvider>
);

export default ConsoleLayout;
