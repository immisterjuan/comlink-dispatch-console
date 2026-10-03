import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, LayersControl, useMap, GeoJSON } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import type { MarkerData, GeoJsonData } from '../../types';
import { getTrackerBadge } from '../../config/trackerBadges';
import { renderToString } from 'react-dom/server';
import HospitalBoxIcon from 'mdi-react/HospitalBoxIcon';
import MapMarkerIcon from 'mdi-react/MapMarkerIcon';
import AlertIcon from 'mdi-react/AlertIcon';
import FlagIcon from 'mdi-react/FlagIcon';

// Fix Leaflet's default icon path issues with webpack/vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface MapComponentProps {
  markers: MarkerData[];
  geojsons: GeoJsonData[];
  onClick?: (lat: number, lng: number) => void;
  interactive?: boolean;
  focusLocation?: { lat: number, lng: number } | null;
}

const MapFlyTo = ({ location }: { location?: { lat: number, lng: number } | null }) => {
  const map = useMap();
  useEffect(() => {
    if (location) {
      map.flyTo([location.lat, location.lng], 18, { animate: true, duration: 1.5 });
    }
  }, [location, map]);
  return null;
};

const MapClickHandler = ({ onClick }: { onClick?: (lat: number, lng: number) => void }) => {
  const map = useMap();
  useEffect(() => {
    if (!onClick) return;
    const handleClick = (e: L.LeafletMouseEvent) => {
      onClick(e.latlng.lat, e.latlng.lng);
    };
    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [map, onClick]);
  return null;
};

const createTeardropMarker = (iconKey?: string, label?: string) => {
  let key = (iconKey || '').toLowerCase();
  
  if (!key && label) {
    const l = label.toLowerCase();
    if (l.includes('hospital') || l.includes('medical') || l.includes('clinic')) {
      key = 'hospital';
    }
  }

  let IconComponent = null;
  switch (key) {
    case 'hospital':
    case 'medical':
    case 'clinic':
      IconComponent = HospitalBoxIcon;
      break;
    case 'alert':
    case 'warning':
      IconComponent = AlertIcon;
      break;
    case 'flag':
      IconComponent = FlagIcon; 
      break;
    case 'poi':
      IconComponent = MapMarkerIcon;
      break;
  }

  if (key === 'user-moving' || key === 'connected-user' || key === 'user-sos' || key === 'last-known' || key === 'user-stopped') {
    const isSOS = key === 'user-sos';
    const isMoving = key === 'user-moving' || key === 'connected-user';
    const isStopped = key === 'user-stopped' || key === 'last-known';
    
    let extraClass = '';
    if (isSOS) extraClass = 'sos-active';
    else if (isMoving) extraClass = 'is-moving';
    else if (isStopped) extraClass = 'is-stopped';

    const html = renderToString(
      <div className={`map-user-marker ${extraClass}`}>
        <div className="glow-wrapper">
          <div className="glow-ring"></div>
        </div>
        <div className="dot"></div>
      </div>
    );
    return L.divIcon({
      html,
      className: '',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -18]
    });
  }

  if (IconComponent) {
    const html = renderToString(
      <div style={{
        width: '32px',
        height: '32px',
        backgroundColor: '#ffffff',
        border: '2px solid #e0e0e0',
        borderRadius: '50% 50% 50% 0',
        transform: 'rotate(-45deg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '2px 2px 5px rgba(0,0,0,0.4)',
        boxSizing: 'border-box'
      }}>
        <div style={{ transform: 'rotate(45deg)', display: 'flex', color: '#E53935' }}>
          <IconComponent size={18} />
        </div>
      </div>
    );
    return L.divIcon({
      html,
      className: '',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32]
    });
  } else {
    const html = renderToString(
      <div style={{
        width: '32px',
        height: '32px',
        background: 'linear-gradient(135deg, #ff0844 0%, #ffb199 100%)',
        borderRadius: '50% 50% 50% 0',
        transform: 'rotate(-45deg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '2px 2px 5px rgba(0,0,0,0.4)',
        border: '1px solid rgba(255,255,255,0.8)',
        boxSizing: 'border-box'
      }}>
        <div style={{
          width: '12px',
          height: '12px',
          backgroundColor: '#ffffff',
          borderRadius: '50%',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.3)'
        }} />
      </div>
    );
    return L.divIcon({
      html,
      className: '',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32]
    });
  }
};

const createTrackerIcon = (marker: MarkerData) => {
  const badge = getTrackerBadge(marker.type);
  const offline = !!marker.isOffline;
  const classes = ['tracker-marker'];
  if (marker.isSOS) classes.push('sos-flashing');
  else if (marker.isMoving && !offline) classes.push('is-moving');
  if (offline) classes.push('is-offline');

  const html = renderToString(
    <div className={classes.join(' ')}>
      <div className="glow-wrapper">
        <div className="glow-ring"></div>
      </div>
      <div className="tracker-dot" style={{ background: offline ? '#888888' : badge.color }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: badge.fg }}>
          <path d={badge.svg} />
        </svg>
      </div>
    </div>
  );
  return L.divIcon({
    html,
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14]
  });
};

const TrackerPopup = ({ marker }: { marker: MarkerData }) => {
  const offline = !!marker.isOffline;
  const sos = !!marker.isSOS;
  const batteryText = !offline && marker.battery !== undefined && marker.battery >= 0
    ? ` • 🔋 ${Math.round(marker.battery * 100)}%`
    : '';

  return (
    <div style={{ textAlign: 'center' }}>
      <b style={{ fontSize: 14, color: sos ? '#FF3B30' : offline ? '#888888' : '#000000' }}>
        {marker.title}{sos ? ' [SOS]' : ''}{offline ? ' (Offline)' : ''}
      </b>
      <br />
      {(marker.type || batteryText) && (
        <span style={{ fontSize: 11, color: '#666666', textTransform: 'uppercase' }}>
          {marker.type}{batteryText}
        </span>
      )}
    </div>
  );
};

const markerStyles = `
  .map-user-marker { width: 36px; height: 36px; display: flex; justify-content: center; align-items: center; }
  .glow-wrapper { position: absolute; width: 100%; height: 100%; opacity: 0; transition: opacity 2s ease-out; }
  .map-user-marker.is-moving .glow-wrapper { opacity: 1; transition: opacity 0.2s ease-in; }
  .map-user-marker.sos-active .glow-wrapper { opacity: 1; transition: opacity 0.2s ease-in; }
  .map-user-marker.sos-active .dot { background: #FF3B30 !important; }
  .map-user-marker.sos-active .glow-ring { background: rgba(255, 59, 48, 0.5) !important; animation: pulse 1s infinite ease-in-out; }
  
  .glow-ring { width: 100%; height: 100%; border-radius: 50%; background: rgba(0, 122, 255, 0.4); animation: pulse 1.5s infinite ease-in-out; }
  .dot { position: relative; width: 16px; height: 16px; background: #007AFF; border: 2px solid #FFFFFF; border-radius: 50%; box-sizing: border-box; z-index: 2; transition: background 0.3s ease; }
  .map-user-marker.is-stopped .dot { background: #9CA3AF !important; }

  .tracker-marker { width: 30px; height: 30px; display: flex; justify-content: center; align-items: center; }
  .tracker-marker.is-offline { opacity: 0.6; }
  .tracker-marker.is-moving .glow-wrapper { opacity: 1; transition: opacity 0.2s ease-in; }
  .tracker-dot { position: relative; width: 24px; height: 24px; background: #4CAF50; border: 2px solid #FFFFFF; border-radius: 50%; box-sizing: border-box; box-shadow: 0 2px 4px rgba(0,0,0,0.3); display: flex; justify-content: center; align-items: center; z-index: 2; transition: background 0.3s; }
  .tracker-dot svg { display: block; }
  .tracker-marker.sos-flashing .tracker-dot { background: #FF3B30 !important; animation: sos-flash 0.5s infinite alternate; box-shadow: 0 0 12px #FF3B30; transform: scale(1.5); border-color: #FFD6D6; }
  @keyframes sos-flash { from { opacity: 1; } to { opacity: 0.5; } }

  @keyframes pulse { 
    0% { transform: scale(0.8); opacity: 0.5; } 
    50% { transform: scale(1.3); opacity: 1; } 
    100% { transform: scale(0.8); opacity: 0.5; } 
  }
`;

const MapComponent: React.FC<MapComponentProps> = ({ markers, geojsons, onClick, interactive = true, focusLocation }) => {
  return (
    <MapContainer 
      center={[12.8797, 121.7740]} 
      zoom={6} 
      style={{ height: '100%', width: '100%' }}
      dragging={interactive}
      zoomControl={interactive}
      scrollWheelZoom={interactive}
      doubleClickZoom={interactive}
    >
      <style>{markerStyles}</style>
      <MapFlyTo location={focusLocation} />

      {interactive ? (
        <LayersControl position="topright">
          <LayersControl.BaseLayer name="OpenStreetMap">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer checked name="Satellite">
            <TileLayer
              attribution='&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.BaseLayer>
        </LayersControl>
      ) : (
        <TileLayer
          attribution='&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
      )}

      {onClick && <MapClickHandler onClick={onClick} />}

      {markers.map((marker) => {
        const pin = marker.markerType === 'default' || marker.markerType === 'flag';
        return (
          <Marker
            key={marker.id}
            position={[marker.lat, marker.lng]}
            icon={pin ? createTeardropMarker(marker.markerType, marker.title) : createTrackerIcon(marker)}
          >
            <Popup>{pin ? marker.title : <TrackerPopup marker={marker} />}</Popup>
          </Marker>
        );
      })}

      {geojsons.map((geo) => (
        <GeoJSON 
          key={geo.id} 
          data={geo.data} 
          pointToLayer={(feature, latlng) => {
            const iconName = feature.properties?.icon || feature.properties?.markerType;
            const labelName = feature.properties?.name || feature.properties?.title || feature.properties?.label || feature.properties?.Name || feature.properties?.NAME;
            return L.marker(latlng, { icon: createTeardropMarker(iconName, labelName) });
          }}
          onEachFeature={(feature, layer) => {
            if (feature.properties) {
              const popupContent = feature.properties.name || feature.properties.title || feature.properties.label || feature.properties.Name || feature.properties.NAME;
              if (popupContent) {
                layer.bindPopup(String(popupContent));
              }
            }
          }}
        />
      ))}
    </MapContainer>
  );
};

export default MapComponent;
