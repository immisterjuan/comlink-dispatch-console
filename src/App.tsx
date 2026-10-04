import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline, Snackbar, Alert } from '@mui/material';
import ConsoleLayout from './components/layout/ConsoleLayout';
import Dashboard from './pages/Dashboard';
import MapPage from './pages/MapPage';
import Kiosk from './pages/Kiosk';
import Settings from './pages/Settings';
import Users from './pages/Users';
import RegisterPage from './pages/RegisterPage';
import LoginScreen from './components/LoginScreen';
import { isAuthenticated } from './lib/auth';
import { isSupabaseInitialized } from './supabaseClient';

const theme = createTheme({
  palette: {
    mode: 'light',
  },
});

function App() {
  const [authed, setAuthed] = useState(isAuthenticated);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {!isSupabaseInitialized && (
        <Snackbar open={true} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
          <Alert severity="error">
            Supabase initialization failed. The app is running in offline/local mode.
          </Alert>
        </Snackbar>
      )}
      <Router>
        <Routes>
          {/* Public: reached by scanning the self-registration QR — must stay
              outside the login gate. */}
          <Route path="/register/:token" element={<RegisterPage />} />
          {authed ? (
            <>
              <Route element={<ConsoleLayout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/map" element={<MapPage />} />
                <Route path="/users" element={<Users />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
              <Route path="/kiosk" element={<Kiosk />} />
            </>
          ) : (
            <Route path="*" element={<LoginScreen onAuthenticated={() => setAuthed(true)} />} />
          )}
        </Routes>
      </Router>
    </ThemeProvider>
  );
}

export default App;
