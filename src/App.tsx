import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline, Snackbar, Alert } from '@mui/material';
import Dispatch from './pages/Dispatch';
import Kiosk from './pages/Kiosk';
import { isSupabaseInitialized } from './supabaseClient';

const theme = createTheme({
  palette: {
    mode: 'light',
  },
});

function App() {
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
          <Route path="/" element={<Dispatch />} />
          <Route path="/kiosk" element={<Kiosk />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
}

export default App;
