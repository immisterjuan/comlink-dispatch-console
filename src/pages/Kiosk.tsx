import React, { useEffect } from 'react';
import MapComponent from '../components/shared/MapComponent';
import { useMapSync } from '../hooks/useMapSync';

const Kiosk: React.FC = () => {
  const { markers, geojsons, presenceUsers, focusLocation } = useMapSync('kiosk');

  useEffect(() => {
    document.title = 'Kiosk Map';
  }, []);

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
