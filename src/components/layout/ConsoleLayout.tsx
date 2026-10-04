import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  AppBar,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import MapIcon from '@mui/icons-material/Map';
import PeopleIcon from '@mui/icons-material/People';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import { ConsoleDataContext, useConsoleData } from '../../context/consoleContext';
import { useMapSync } from '../../hooks/useMapSync';
import { useKioskLink } from '../../hooks/useKioskLink';
import { logout } from '../../lib/auth';

const SIDEBAR_WIDTH = 232;

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: <DashboardIcon />, end: true },
  { to: '/map', label: 'Map', icon: <MapIcon />, end: false },
  { to: '/users', label: 'Users', icon: <PeopleIcon />, end: false },
  { to: '/settings', label: 'Settings', icon: <SettingsIcon />, end: false },
] as const;

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
      <Drawer
        variant="permanent"
        sx={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { width: SIDEBAR_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            sx={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
            }}
          >
            CL
          </Box>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              ComLink
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Dispatch Console
            </Typography>
          </Box>
        </Box>
        <Divider />
        <List>
          {NAV_ITEMS.map(item => (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              end={item.end}
              selected={item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>

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
