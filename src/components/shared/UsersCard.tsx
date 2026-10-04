import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Chip,
  Collapse,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { STATUS_LABELS, type StatusKey } from '../../config/trackerBadges';
import type { MarkerData } from '../../types';

const STATUS_ORDER: Record<StatusKey, number> = {
  sos: 0,
  active: 1,
  connecting: 2,
  stop: 3,
  idle: 4,
  away: 5,
  unknown: 6,
};

const CHIP_COLOR: Record<StatusKey, 'error' | 'success' | 'info' | 'warning' | 'default'> = {
  sos: 'error',
  active: 'success',
  connecting: 'info',
  stop: 'warning',
  idle: 'warning',
  away: 'default',
  unknown: 'default',
};

const formatRelative = (timestamp: number | undefined, now: number): string => {
  if (!timestamp) return '—';
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return `${Math.round(elapsed / 1000)}s ago`;
  if (elapsed < 3_600_000) return `${Math.round(elapsed / 60_000)}m ago`;
  return `${Math.round(elapsed / 3_600_000)}h ago`;
};

const ROWS_PER_PAGE_OPTIONS = [5, 10, 25];

// Live tracker table card: collapsible white title bar + paginated rows.
// Owns its own relative-time ticker so the parent only feeds it data.
const UsersCard: React.FC<{ users: MarkerData[] }> = ({ users }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const sorted = useMemo(
    () =>
      [...users].sort((a, b) => {
        const byStatus =
          STATUS_ORDER[(a.status ?? 'unknown') as StatusKey] -
          STATUS_ORDER[(b.status ?? 'unknown') as StatusKey];
        if (byStatus !== 0) return byStatus;
        return a.title.localeCompare(b.title);
      }),
    [users]
  );

  // The list is live and can shrink below the current page — clamp so
  // TablePagination never goes out of range.
  const pageCount = Math.ceil(sorted.length / rowsPerPage);
  const safePage = pageCount === 0 ? 0 : Math.min(page, pageCount - 1);
  const visible = sorted.slice(safePage * rowsPerPage, safePage * rowsPerPage + rowsPerPage);

  return (
    <Paper sx={{ overflow: 'hidden' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: 1,
          py: 0.5,
          bgcolor: 'background.paper',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography
          variant="h6"
          sx={{
            fontWeight: 400,
            lineHeight: 1,
            m: 0,
            flex: 1,
            alignSelf: 'stretch',
            display: 'flex',
            alignItems: 'center',
            pt: '8px',
            pl: '5px'
          }}
        >
          Users
        </Typography>
        <IconButton
          size="small"
          onClick={() => setCollapsed(v => !v)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand users table' : 'Collapse users table'}
        >
          <KeyboardArrowDownIcon
            sx={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s' }}
          />
        </IconButton>
      </Box>

      <Collapse in={!collapsed} unmountOnExit>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Badge #</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Position</TableCell>
                <TableCell align="right">Last Update</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                    No users yet — waiting for broadcasts from trackers.
                  </TableCell>
                </TableRow>
              ) : (
                visible.map(marker => {
                  const key = (marker.status ?? 'unknown') as StatusKey;
                  return (
                    <TableRow key={marker.id} hover>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{marker.badgeNumber ?? '—'}</TableCell>
                      <TableCell>
                        {marker.title}
                        {marker.isOffline && (
                          <Chip size="small" label="offline" color="default" variant="outlined" sx={{ ml: 1 }} />
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={STATUS_LABELS[key]}
                          color={CHIP_COLOR[key]}
                          variant={key === 'unknown' ? 'outlined' : 'filled'}
                          sx={{
                            color: key === 'stop' || key === 'idle' ? '#111111' : undefined,
                          }}
                        />
                      </TableCell>
                      <TableCell>{marker.type ?? '—'}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {marker.lat.toFixed(4)}, {marker.lng.toFixed(4)}
                      </TableCell>
                      <TableCell align="right">{formatRelative(marker.updatedAt, now)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
        {sorted.length > 0 && (
          <TablePagination
            component="div"
            count={sorted.length}
            page={safePage}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={e => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
          />
        )}
      </Collapse>
    </Paper>
  );
};

export default UsersCard;
