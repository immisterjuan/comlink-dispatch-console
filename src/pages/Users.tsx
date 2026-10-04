import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import EventQRCodeIcon from '@mui/icons-material/QrCode';
import { QRCodeCanvas } from 'qrcode.react';
import {
  createRegistrationToken,
  createUser,
  deleteUser,
  eventQrPayload,
  listUsers,
  updateUser,
  type FleetUser,
  type RegistrationToken,
} from '../lib/db';
import { TRACKER_TYPE_NAMES } from '../config/trackerBadges';
import { usePageTitle } from '../hooks/usePageTitle';

interface QrDialogProps {
  title: string;
  subtitle: string;
  value: string;
  filename: string;
  extraValue?: string;
  copyLabel?: string;
  onClose: () => void;
}

const QrDialog: React.FC<QrDialogProps> = ({ title, subtitle, value, filename, extraValue, copyLabel = 'Copy UUID', onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = filename;
    link.click();
  };

  const copyValue = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions / non-secure context)
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        <DialogContentText sx={{ textAlign: 'center' }}>{subtitle}</DialogContentText>
        <QRCodeCanvas ref={canvasRef} value={value} size={280} marginSize={4} />
        {extraValue && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{extraValue}</Typography>
            <Tooltip title={copied ? 'Copied' : copyLabel}>
              <IconButton size="small" onClick={() => void copyValue()}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" startIcon={<DownloadIcon />} onClick={download}>
          Download PNG
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const Users: React.FC = () => {
  usePageTitle('Users · ComLink Console');
  // On localhost the scanned link must go through VITE_QR_CODE_PATH
  // (ngrok tunnel) or no phone can reach it.
  const inviteUrl = (token: string): string => {
    const host = window.location.hostname;
    const local = host === 'localhost' || host === '127.0.0.1';
    const origin =
      local && import.meta.env.VITE_QR_CODE_PATH
        ? `https://${import.meta.env.VITE_QR_CODE_PATH}`
        : window.location.origin;
    return `${origin}/register/${token}`;
  };

  const [users, setUsers] = useState<FleetUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<FleetUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FleetUser | null>(null);
  const [qrTarget, setQrTarget] = useState<FleetUser | null>(null);
  const [eventQrOpen, setEventQrOpen] = useState(false);

  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState(TRACKER_TYPE_NAMES[0] ?? 'person');
  const [saving, setSaving] = useState(false);

  const [invite, setInvite] = useState<RegistrationToken | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await listUsers());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load (async — no state updates run synchronously in the effect).
  useEffect(() => {
    let active = true;
    listUsers()
      .then(data => {
        if (active) setUsers(data);
      })
      .catch(e => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const openAdd = () => {
    setFormName('');
    setFormType(TRACKER_TYPE_NAMES[0] ?? 'person');
    setAddOpen(true);
  };

  // Creates a one-time, 1-hour self-registration invite with a reserved badge.
  const openInvite = async () => {
    setInviteLoading(true);
    setInvite(null);
    try {
      setInvite(await createRegistrationToken());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInviteLoading(false);
    }
  };

  const openEdit = (user: FleetUser) => {
    setFormName(user.name);
    setFormType(user.type);
    setEditTarget(user);
  };

  const submitAdd = async () => {
    setSaving(true);
    try {
      await createUser({ name: formName, type: formType });
      setAddOpen(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      await updateUser(editTarget.id, { name: formName, type: formType });
      setEditTarget(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await deleteUser(deleteTarget.id);
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 3 }}>
      <Paper sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
        <Chip size="small" variant="outlined" label={`${users.length} registered`} />
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
          <Button variant="outlined" startIcon={<EventQRCodeIcon />} onClick={() => setEventQrOpen(true)}>
            Event QR
          </Button>
          <Button variant="outlined" startIcon={<PersonAddAlt1Icon />} onClick={() => void openInvite()}>
            Self-Register
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>
            Add User
          </Button>
        </Box>
      </Paper>

      <Box>
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Badge #</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 6 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                    No users yet. Add one to generate a registration QR code.
                  </TableCell>
                </TableRow>
              ) : (
                users.map(user => (
                  <TableRow key={user.id} hover>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{user.badge_number}</TableCell>
                    <TableCell>{user.name}</TableCell>
                    <TableCell>
                      <Chip size="small" label={user.type} variant="outlined" />
                    </TableCell>
                    <TableCell>
                      {user.tsCreated ? new Date(user.tsCreated).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Registration QR">
                        <IconButton color="primary" onClick={() => setQrTarget(user)}>
                          <QrCode2Icon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Edit">
                        <IconButton onClick={() => openEdit(user)}>
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Revoke">
                        <IconButton color="error" onClick={() => setDeleteTarget(user)}>
                          <DeleteIcon />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Add User</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
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
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void submitAdd()} disabled={saving || !formName.trim()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!editTarget} onClose={() => setEditTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>Edit {editTarget?.badge_number}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          <TextField
            label="Name"
            value={formName}
            onChange={e => setFormName(e.target.value)}
            autoFocus
            required
            fullWidth
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
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditTarget(null)}>Cancel</Button>
          <Button variant="contained" onClick={() => void submitEdit()} disabled={saving || !formName.trim()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Revoke {deleteTarget?.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This removes badge {deleteTarget?.badge_number} from the allowlist. The registration QR
            stops working and the device is blocked on next activation.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void submitDelete()} disabled={saving}>
            Revoke
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={inviteLoading} maxWidth="xs" fullWidth>
        <DialogContent sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={32} />
        </DialogContent>
      </Dialog>

      {invite && (
        <QrDialog
          key={invite.token}
          title={`Self-Register — ${invite.badge_number}`}
          subtitle={`One-time link, expires ${new Date(invite.expires_at).toLocaleTimeString()}. Scanning opens the registration form on the user's device.`}
          value={inviteUrl(invite.token)}
          extraValue={inviteUrl(invite.token)}
          copyLabel="Copy Link"
          filename={`comlink-self-register-${invite.badge_number}.png`}
          onClose={() => setInvite(null)}
        />
      )}

      {qrTarget && (
        <QrDialog
          key={qrTarget.id}
          title={`Registration QR — ${qrTarget.badge_number}`}
          subtitle="Scan in the mobile app's Registration screen to activate this device."
          value={qrTarget.id}
          extraValue={qrTarget.id}
          filename={`comlink-registration-${qrTarget.badge_number}.png`}
          onClose={() => setQrTarget(null)}
        />
      )}

      {eventQrOpen && (
        <QrDialog
          title="Event QR"
          subtitle="Scan in the mobile app's Device Setup screen to configure the event (database URL, key and channel)."
          value={eventQrPayload()}
          filename="comlink-event-qr.png"
          onClose={() => setEventQrOpen(false)}
        />
      )}

      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" variant="filled" onClose={() => setError(null)}>{error}</Alert>
      </Snackbar>
    </Box>
  );
};

export default Users;
