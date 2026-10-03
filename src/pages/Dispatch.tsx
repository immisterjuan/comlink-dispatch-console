import React, { useRef, useEffect } from 'react';
import MapComponent from '../components/shared/MapComponent';
import { useMapSync } from '../hooks/useMapSync';
import type { MarkerData } from '../types';
import { Box, Button, Typography, Paper } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';

const Dispatch: React.FC = () => {
  const { markers, geojsons, presenceUsers, broadcastUpdate, onlineUsers, focusLocation } = useMapSync('dispatch');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'Dispatch Console';
  }, []);

  const handleMapClick = (lat: number, lng: number) => {
    const newMarker: MarkerData = {
      id: Math.random().toString(36).substr(2, 9),
      lat,
      lng,
      title: `Pin at ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      markerType: 'default'
    };
    broadcastUpdate([...markers, newMarker], geojsons);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        const newGeoJson = {
          id: Math.random().toString(36).substr(2, 9),
          data
        };
        broadcastUpdate(markers, [...geojsons, newGeoJson]);
      } catch (error) {
        console.error('Error parsing GeoJSON', error);
        alert('Invalid GeoJSON file');
      }
    };
    reader.readAsText(file);
  };

  const clearMap = () => {
    broadcastUpdate([], []);
  };

  return (
    <Box sx={{ display: 'flex', height: '100vh', flexDirection: 'column' }}>
      <Paper sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center', zIndex: 1000, position: 'relative' }}>
        <Typography variant="h6">Dispatch Console</Typography>
        <Typography variant="body2" sx={{ ml: 'auto' }}>Online Users: {onlineUsers}</Typography>
        
        <input 
          type="file" 
          accept=".geojson,.json" 
          style={{ display: 'none' }} 
          ref={fileInputRef}
          onChange={handleFileUpload}
        />
        <Button 
          variant="contained" 
          startIcon={<UploadFileIcon />}
          onClick={() => fileInputRef.current?.click()}
        >
          Upload GeoJSON
        </Button>
        <Button variant="outlined" color="error" onClick={clearMap}>
          Clear Map
        </Button>
      </Paper>
      
      <Box sx={{ flexGrow: 1, position: 'relative' }}>
        <MapComponent 
          markers={[...presenceUsers.filter(p => !markers.some(m => m.id === p.id)), ...markers]} 
          geojsons={geojsons} 
          onClick={handleMapClick} 
          interactive={true} 
          focusLocation={focusLocation} 
        />
      </Box>
    </Box>
  );
};

export default Dispatch;
