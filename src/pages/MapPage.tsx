import React from 'react';
import { Box } from '@mui/material';
import MapComponent from '../components/shared/MapComponent';
import { useConsoleData } from '../context/consoleContext';
import { usePageTitle } from '../hooks/usePageTitle';

// Console map route: same MapComponent as the Kiosk, but fully interactive
// (pan/zoom) and driven by the shared console data provider.
const MapPage: React.FC = () => {
  usePageTitle('Map · ComLink Console');
  const { markers, geojsons, presenceUsers, focusLocation } = useConsoleData();

  return (
    <Box sx={{ height: '100%' }}>
      <MapComponent
        markers={[...presenceUsers.filter(p => !markers.some(m => m.id === p.id)), ...markers]}
        geojsons={geojsons}
        focusLocation={focusLocation}
      />
    </Box>
  );
};

export default MapPage;
