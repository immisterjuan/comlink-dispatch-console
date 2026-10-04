import React from 'react';
import MapComponent from '../components/shared/MapComponent';
import { useMapSync } from '../hooks/useMapSync';
import { useKioskLink } from '../hooks/useKioskLink';
import { usePageTitle } from '../hooks/usePageTitle';

const Kiosk: React.FC = () => {
  const { markers, geojsons, presenceUsers, focusLocation } = useMapSync('kiosk');
  // Persistent listener for console commands (acks handled inside the hook).
  useKioskLink('kiosk');

  usePageTitle('Kiosk Map · ComLink Console');

  return (
    <div style={{ width: '100vw', height: '100vh', margin: 0, padding: 0, position: 'relative' }}>
      <MapComponent 
        markers={[...presenceUsers.filter(p => !markers.some(m => m.id === p.id)), ...markers]} 
        geojsons={geojsons} 
        interactive={false} 
        focusLocation={focusLocation} 
      />
    </div>
  );
};

export default Kiosk;
