import React, { useMemo } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { useConsoleData } from '../context/consoleContext';
import { STATUS_COLORS, STATUS_LABELS, type StatusKey } from '../config/trackerBadges';
import { usePageTitle } from '../hooks/usePageTitle';
import UsersCard from '../components/shared/UsersCard';
import DevicesIcon from '@mui/icons-material/Devices';
import WifiIcon from '@mui/icons-material/Wifi';
import SosIcon from '@mui/icons-material/Sos';
import DirectionsRunIcon from '@mui/icons-material/DirectionsRun';
import SyncIcon from '@mui/icons-material/Sync';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import ScheduleIcon from '@mui/icons-material/Schedule';
import DirectionsWalkIcon from '@mui/icons-material/DirectionsWalk';
import HelpIcon from '@mui/icons-material/Help';

const KPI_COLORS: Record<StatusKey, string> = {
  ...STATUS_COLORS,
  unknown: '#BDBDBD',
};

const ICON_SX = { fontSize: 30 };

const KPI_ICONS: Record<StatusKey, React.ReactNode> = {
  sos: <SosIcon sx={ICON_SX} />,
  active: <DirectionsRunIcon sx={ICON_SX} />,
  connecting: <SyncIcon sx={ICON_SX} />,
  stop: <StopCircleIcon sx={ICON_SX} />,
  idle: <ScheduleIcon sx={ICON_SX} />,
  away: <DirectionsWalkIcon sx={ICON_SX} />,
  unknown: <HelpIcon sx={ICON_SX} />,
};

const KpiCard: React.FC<{
  label: string;
  value: number;
  color: string;
  emphasis?: boolean;
  icon?: React.ReactNode;
}> = ({ label, value, color, emphasis, icon }) => (
  <Paper
    elevation={emphasis ? 4 : 1}
    sx={{
      p: 2,
      borderTop: `4px solid ${color}`,
      bgcolor: emphasis ? `${color}14` : undefined,
    }}
  >
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.4 }}>
          {label}
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 700, color }}>
          {value}
        </Typography>
      </Box>
      {icon && (
        <Box sx={{ color, opacity: emphasis ? 1 : 0.7, display: 'flex', flexShrink: 0, mt: 0.5 }}>
          {icon}
        </Box>
      )}
    </Box>
  </Paper>
);

// Main console view: live KPI breakdown of every tracker status, recomputed
// on every broadcast that useMapSync merges into `markers`.
const Dashboard: React.FC = () => {
  usePageTitle('Dashboard · ComLink Console');
  const { markers, onlineUsers } = useConsoleData();

  const trackers = useMemo(
    () => markers.filter(m => m.markerType !== 'default' && m.markerType !== 'flag'),
    [markers]
  );

  const counts = useMemo(() => {
    const result: Record<StatusKey, number> = {
      sos: 0,
      active: 0,
      connecting: 0,
      stop: 0,
      idle: 0,
      away: 0,
      unknown: 0,
    };
    trackers.forEach(t => {
      const key = (t.status ?? 'unknown') as StatusKey;
      result[key] = (result[key] ?? 0) + 1;
    });
    return result;
  }, [trackers]);

  const kpiOrder: StatusKey[] = ['sos', 'active', 'connecting', 'stop', 'idle', 'away', 'unknown'];

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' },
          gap: 2,
        }}
      >
        <KpiCard label="Total Units" value={trackers.length} color="#1976D2" icon={<DevicesIcon sx={ICON_SX} />} />
        <KpiCard label="Online" value={onlineUsers} color="#0288D1" icon={<WifiIcon sx={ICON_SX} />} />
        {kpiOrder.map(key => (
          <KpiCard
            key={key}
            label={STATUS_LABELS[key]}
            value={counts[key]}
            color={KPI_COLORS[key]}
            emphasis={key === 'sos' && counts.sos > 0}
            icon={KPI_ICONS[key]}
          />
        ))}
      </Box>

      <UsersCard users={trackers} />
    </Box>
  );
};

export default Dashboard;
