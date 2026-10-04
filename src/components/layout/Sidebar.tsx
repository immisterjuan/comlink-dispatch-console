import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Box,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import MapIcon from '@mui/icons-material/Map';
import PeopleIcon from '@mui/icons-material/People';
import SettingsIcon from '@mui/icons-material/Settings';
import appIcon from '../../assets/app.svg';

export const SIDEBAR_WIDTH = 232;

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: <DashboardIcon />, end: true },
  { to: '/map', label: 'Map', icon: <MapIcon />, end: false },
  { to: '/users', label: 'Users', icon: <PeopleIcon />, end: false },
  { to: '/settings', label: 'Settings', icon: <SettingsIcon />, end: false },
] as const;

const Sidebar: React.FC = () => {
  const location = useLocation();

  return (
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
          component="img"
          src={appIcon}
          alt="ComLink"
          sx={{ width: 34, height: 34, objectFit: 'contain' }}
        />
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
            <ListItemText sx={{fontSize: 5}} primary={item.label} />
          </ListItemButton>
        ))}
      </List>
    </Drawer>
  );
};

export default Sidebar;
