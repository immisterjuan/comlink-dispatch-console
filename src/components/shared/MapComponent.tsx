import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, LayersControl, useMap, GeoJSON } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import type { MarkerData, GeoJsonData, UserStatus } from '../../types';
import { getTrackerBadge, statusColor, contrastForeground } from '../../config/trackerBadges';
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

const MapFlyTo = ({ location, onFlyStateChange }: {
  location?: { lat: number, lng: number } | null;
  onFlyStateChange?: (flying: boolean) => void;
}) => {
  const map = useMap();
  useEffect(() => {
    if (!location) return;

    // Markers stay hidden for the whole flight and only re-appear once the
    // view has settled (plus a safety timer in case the fly is interrupted).
    onFlyStateChange?.(true);
    map.flyTo([location.lat, location.lng], 18, { animate: true, duration: 1.5 });

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      onFlyStateChange?.(false);
    };
    const safetyTimer = setTimeout(settle, 3000);
    map.once('moveend', settle);

    return () => {
      settled = true;
      clearTimeout(safetyTimer);
      map.off('moveend', settle);
    };
  }, [location, map, onFlyStateChange]);
  return null;
};

// Toggles the marker pane; on reveal it briefly disables the transform
// transition so markers snap to their geographic position instead of gliding.
const MarkerVisibility = ({ hidden }: { hidden: boolean }) => {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    el.classList.toggle('markers-hidden', hidden);
    if (hidden) return;
    el.classList.add('markers-no-transition');
    const timer = setTimeout(() => el.classList.remove('markers-no-transition'), 150);
    return () => clearTimeout(timer);
  }, [map, hidden]);
  return null;
};

// Reports the current zoom level so the parent can hide markers below the
// visibility threshold (the pane-wide hide also covers GeoJSON point markers).
const ZoomReporter = ({ onZoomChange }: { onZoomChange: (zoom: number) => void }) => {
  const map = useMap();
  useEffect(() => {
    onZoomChange(map.getZoom());
    const report = () => onZoomChange(map.getZoom());
    map.on('zoomend', report);
    map.on('load', report);
    return () => {
      map.off('zoomend', report);
      map.off('load', report);
    };
  }, [map, onZoomChange]);
  return null;
};

// The 1.5s transform glide is only for incoming position broadcasts — every
// transform Leaflet itself writes (zoom resets, pinch frames, viewreset after
// a resize) must land instantly, otherwise the marker drifts away from its
// geographic spot. The glide is suspended for the whole interaction and only
// re-enabled one frame later, because `_resetView` fires `moveend` and then
// `viewreset` (the marker update) inside the same task.
const MarkerTransitionGuard = () => {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    let raf = 0;
    const suspend = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      el.classList.add('markers-panning');
    };
    const resume = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.classList.remove('markers-panning');
        raf = 0;
      });
    };
    // `viewreset` runs after `moveend` in the same task; suspending again here
    // keeps the transition off for the final marker write (also covers resets
    // that skip `viewprereset`, e.g. `map.stop()`).
    const onViewReset = () => {
      suspend();
      resume();
    };
    map.on('movestart', suspend);
    map.on('zoomstart', suspend);
    map.on('dragstart', suspend);
    map.on('viewprereset', suspend);
    map.on('viewreset', onViewReset);
    map.on('moveend', resume);
    map.on('zoomend', resume);
    map.on('dragend', resume);
    return () => {
      map.off('movestart', suspend);
      map.off('zoomstart', suspend);
      map.off('dragstart', suspend);
      map.off('viewprereset', suspend);
      map.off('viewreset', onViewReset);
      map.off('moveend', resume);
      map.off('zoomend', resume);
      map.off('dragend', resume);
      if (raf) cancelAnimationFrame(raf);
      el.classList.remove('markers-panning');
    };
  }, [map]);
  return null;
};

// Puts the built-in zoom control in the bottom-right corner, stacked below
// the layer switcher (bottom corners insert each new control at the top of
// the corner, so the control that sits last in DOM order ends up at the
// bottom).
const BottomRightControls = () => {
  const map = useMap();
  useEffect(() => {
    const zoom = map.zoomControl;
    zoom?.setPosition('bottomright');
    const container = zoom?.getContainer();
    const corner = container?.parentElement;
    if (container && corner) {
      corner.appendChild(container);
    }
    return () => {
      zoom?.remove();
    };
  }, [map]);
  return null;
};

// True-north indicator — Leaflet maps are always north-up (map grid north
// = true north), so the needle always points to the top of the screen.
const NorthArrowControl = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const div = L.DomUtil.create('div', 'north-arrow');
    div.innerHTML = `
      <span class="north-arrow-n">N</span>
      <svg width="34" height="46" viewBox="0 0 34 46" aria-hidden="true">
        <path d="M17 3 L29 43 L17 34 Z" fill="#ffffff"/>
        <path d="M17 3 L5 43 L17 34 Z" fill="rgba(255,255,255,0.85)"/>
        <path d="M17 3 L29 43 L17 34 L5 43 Z" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>`;
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    return div;
  }
});

const NorthArrow = () => {
  const map = useMap();
  useEffect(() => {
    const control = new NorthArrowControl();
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map]);
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

interface TrackerVisual {
  type?: string;
  status?: UserStatus | null;
  isSOS?: boolean;
  isMoving?: boolean;
  isOffline?: boolean;
}

const createTrackerIcon = (visual: TrackerVisual) => {
  const badge = getTrackerBadge(visual.type);
  const offline = !visual.isSOS && !!visual.isOffline;
  const background = statusColor(visual.status) ?? badge.color;
  const foreground = contrastForeground(background, badge.fg);
  const classes = ['tracker-marker'];
  if (visual.isSOS) classes.push('sos-flashing');
  else if (visual.isMoving && !offline) classes.push('is-moving');
  if (offline) classes.push('is-offline');

  const html = renderToString(
    <div className={classes.join(' ')}>
      <div className="glow-wrapper">
        <div className="glow-ring"></div>
      </div>
      <div className="tracker-dot" style={{ background: offline ? '#888888' : background }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: offline ? '#FFFFFF' : foreground }}>
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
  const statusText = marker.status ? `${marker.status.toUpperCase()} • ` : '';

  return (
    <div style={{ textAlign: 'center' }}>
      <b style={{ fontSize: 14, color: sos ? '#F44336' : offline ? '#888888' : '#000000' }}>
        {marker.title}{sos ? ' [SOS]' : ''}{offline ? ' (Offline)' : ''}
      </b>
      <br />
      {(marker.type || batteryText || marker.status || marker.badgeNumber) && (
        <span style={{ fontSize: 11, color: '#666666', textTransform: 'uppercase' }}>
          {marker.badgeNumber ? `${marker.badgeNumber} • ` : ''}{statusText}{marker.type}{batteryText}
        </span>
      )}
    </div>
  );
};

const markerStyles = `
  .map-shell { position: relative; display: flex; flex-direction: column; height: 100%; width: 100%; }

  .sos-banner { position: absolute; left: 0; right: 0; height: 130px; box-sizing: border-box; z-index: 1100; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px 24px; background: #E53935; animation: sos-banner-flash 0.7s linear infinite; }
  .sos-banner-text { font: 900 46px/1 Arial, sans-serif; color: #FFFFFF; letter-spacing: 12px; text-shadow: 0 2px 6px rgba(0,0,0,0.65); }
  .sos-banner-names { font: 700 15px/1.3 Arial, sans-serif; color: #FFEBEE; margin-top: 4px; max-width: 92%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @keyframes sos-banner-flash {
    0%, 49% { background-color: #E53935; }
    50%, 100% { background-color: #7F0000; }
  }

  .leaflet-marker-icon { transition: transform 1.5s linear; }
  .leaflet-marker-pane { transition: opacity 0.25s ease; }
  .leaflet-container.markers-hidden .leaflet-marker-pane { opacity: 0; pointer-events: none; }
  .leaflet-container.markers-no-transition .leaflet-marker-icon { transition: none; }
  .leaflet-container.markers-panning .leaflet-marker-icon { transition: none; }
  /* While Leaflet eases the map to a new zoom it eases tiles and markers with
     this exact curve (the leaflet.css .leaflet-zoom-anim .leaflet-zoom-animated
     rule); markers must keep it so they travel the same path as the tiles
     instead of snapping ahead of them. Higher specificity than the
     markers-panning rule above so it also wins while the transition is
     suspended. */
  .leaflet-zoom-anim .leaflet-marker-pane .leaflet-marker-icon { transition: transform 0.25s cubic-bezier(0,0,0.25,1); }
  .map-user-marker { width: 36px; height: 36px; display: flex; justify-content: center; align-items: center; }
  .glow-wrapper { position: absolute; width: 100%; height: 100%; opacity: 0; transition: opacity 2s ease-out; }
  .map-user-marker.is-moving .glow-wrapper { opacity: 1; transition: opacity 0.2s ease-in; }
  .map-user-marker.sos-active .glow-wrapper { opacity: 1; transition: opacity 0.2s ease-in; }
  .map-user-marker.sos-active .dot { background: #F44336 !important; }
  .map-user-marker.sos-active .glow-ring { background: rgba(244, 67, 54, 0.5) !important; animation: pulse 1s infinite ease-in-out; }
  
  .glow-ring { width: 100%; height: 100%; border-radius: 50%; background: rgba(0, 122, 255, 0.4); animation: pulse 1.5s infinite ease-in-out; }
  .dot { position: relative; width: 16px; height: 16px; background: #007AFF; border: 2px solid #FFFFFF; border-radius: 50%; box-sizing: border-box; z-index: 2; transition: background 0.3s ease; }
  .map-user-marker.is-stopped .dot { background: #FFEB3B !important; }

  .tracker-marker { width: 30px; height: 30px; display: flex; justify-content: center; align-items: center; }
  .tracker-marker.is-offline { opacity: 0.6; }
  .tracker-marker.is-moving .glow-wrapper { opacity: 1; transition: opacity 0.2s ease-in; }
  .tracker-dot { position: relative; width: 24px; height: 24px; background: #4CAF50; border: 2px solid #FFFFFF; border-radius: 50%; box-sizing: border-box; box-shadow: 0 2px 4px rgba(0,0,0,0.3); display: flex; justify-content: center; align-items: center; z-index: 2; transition: background 0.3s; }
  .tracker-dot svg { display: block; }
  .tracker-marker.sos-flashing .tracker-dot { background: #F44336 !important; animation: sos-flash 0.5s infinite alternate; box-shadow: 0 0 12px #F44336; transform: scale(1.5); border-color: #FFCDD2; }
  @keyframes sos-flash { from { opacity: 1; } to { opacity: 0.5; } }

  .north-arrow { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 84px; height: 84px; border-radius: 50%; background: rgba(17, 17, 17, 0.55); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45); line-height: 1; user-select: none; }
  .north-arrow-n { font: 700 17px/1 Arial, sans-serif; color: #FFFFFF; margin-bottom: 3px; text-shadow: 0 1px 3px rgba(0,0,0,0.7); }
  .north-arrow svg { display: block; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.7)); }

  /* Bottom-right controls (layer switcher stacked above the zoom buttons): dark translucent */
  .leaflet-bottom.leaflet-right .leaflet-control-zoom.leaflet-bar { background: transparent; border: none; }
  .leaflet-bottom.leaflet-right .leaflet-bar a { background-color: rgba(17, 17, 17, 0.65); color: #FFFFFF; border: none; border-top: 1px solid rgba(255, 255, 255, 0.18); }
  .leaflet-bottom.leaflet-right .leaflet-bar a:first-child { border-top: none; }
  .leaflet-bottom.leaflet-right .leaflet-bar a:hover,
  .leaflet-bottom.leaflet-right .leaflet-bar a:focus { background-color: rgba(17, 17, 17, 0.85); }
  .leaflet-bottom.leaflet-right .leaflet-control-layers { background: rgba(17, 17, 17, 0.65); border: none; }
  .leaflet-bottom.leaflet-right .leaflet-control-layers-toggle { background-color: transparent; filter: invert(1); }
  .leaflet-bottom.leaflet-right .leaflet-control-layers-expanded { background: rgba(17, 17, 17, 0.9); color: #FFFFFF; }
  .leaflet-bottom.leaflet-right .leaflet-control-layers-expanded label { color: #FFFFFF; }
  .leaflet-bottom.leaflet-right .leaflet-control-layers-separator { border-top-color: rgba(255, 255, 255, 0.3); }

  @keyframes pulse { 
    0% { transform: scale(0.8); opacity: 0.5; } 
    50% { transform: scale(1.3); opacity: 1; } 
    100% { transform: scale(0.8); opacity: 0.5; } 
  }
`;

// One marker per tracker. The icon is memoized on its visual fields so
// Leaflet never re-sets it on a plain position update — the marker then
// glides between fixes via the CSS transform transition instead of snapping.
const MapMarkerLayer = React.memo(({ marker }: { marker: MarkerData }) => {
  const { markerType, title, type, status, isSOS, isMoving, isOffline } = marker;
  const pin = markerType === 'default' || markerType === 'flag';
  const icon = React.useMemo(
    () => (pin ? createTeardropMarker(markerType, title) : createTrackerIcon({ type, status, isSOS, isMoving, isOffline })),
    [pin, markerType, title, type, status, isSOS, isMoving, isOffline]
  );

  return (
    <Marker position={[marker.lat, marker.lng]} icon={icon}>
      <Popup>{pin ? title : <TrackerPopup marker={marker} />}</Popup>
    </Marker>
  );
});

// Keeps tiles aligned when the map container resizes.
const MapResizeWatcher = () => {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [map]);
  return null;
};

const SOS_BANNER_H = 130;

// Large flashing SOS alert, overlaid on the map (z-index above every pane and
// control). Pinned to the top; flips to the bottom if the SOS marker's screen
// position would otherwise fall under the banner.
const SosBanner = ({ markers }: { markers: MarkerData[] }) => {
  const map = useMap();
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const [, setTick] = useState(0);
  const sos = useMemo(
    () => markers.filter(m => m.isSOS && m.markerType !== 'default' && m.markerType !== 'flag'),
    [markers]
  );

  // Re-render while the map pans/zooms so placement keeps tracking the marker.
  useEffect(() => {
    const bump = () => setTick(t => t + 1);
    map.on('move', bump);
    map.on('zoom', bump);
    map.on('resize', bump);
    return () => {
      map.off('move', bump);
      map.off('zoom', bump);
      map.off('resize', bump);
    };
  }, [map]);

  useEffect(() => {
    const el = bannerRef.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  });

  if (sos.length === 0) return null;

  const size = map.getSize();
  const overlaps = (y0: number, y1: number) =>
    sos.some(m => {
      const p = map.latLngToContainerPoint([m.lat, m.lng]);
      return p.y + 36 > y0 && p.y - 36 < y1;
    });
  const placeTop = !(overlaps(0, SOS_BANNER_H) && !overlaps(size.y - SOS_BANNER_H, size.y));

  return (
    <div
      ref={bannerRef}
      className="sos-banner"
      role="alert"
      aria-live="assertive"
      style={placeTop ? { top: 0 } : { bottom: 0 }}
    >
      <span className="sos-banner-text">SOS</span>
      <span className="sos-banner-names">{sos.map(m => m.title).join(' \u00b7 ')}</span>
    </div>
  );
};

const isPinMarker = (m: MarkerData) => m.markerType === 'default' || m.markerType === 'flag';

const INITIAL_ZOOM = 6;
// Markers are hidden as soon as the map zooms out below this level.
const MIN_MARKER_ZOOM = 13;

const MapComponent: React.FC<MapComponentProps> = ({ markers, geojsons, onClick, interactive = true, focusLocation }) => {
  const [flying, setFlying] = useState(false);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const markersHidden = flying || zoom < MIN_MARKER_ZOOM;

  // SOS focus (refactor.md §4): while any tracker is in SOS, every other
  // marker is hidden so the operator sees only the SOS broadcast.
  const hasSos = markers.some(m => !isPinMarker(m) && (m.isSOS || m.status === 'sos'));
  const visibleMarkers = hasSos ? markers.filter(m => m.isSOS || m.status === 'sos') : markers;

  return (
    <div className="map-shell">
      <MapContainer 
        center={[12.8797, 121.7740]} 
        zoom={INITIAL_ZOOM} 
        style={{ flex: 1, width: '100%', minHeight: 0 }}
        dragging
        keyboard={false}
        zoomControl={interactive}
        attributionControl={false}
        scrollWheelZoom
        doubleClickZoom={interactive}
      >
      <style>{markerStyles}</style>
      <MapFlyTo location={focusLocation} onFlyStateChange={setFlying} />
      <MarkerVisibility hidden={markersHidden} />
      <ZoomReporter onZoomChange={setZoom} />
      <MarkerTransitionGuard />
      <MapResizeWatcher />
      <NorthArrow />
      <SosBanner markers={markers} />

      {interactive ? (
        <LayersControl position="bottomright">
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

      {interactive && <BottomRightControls />}

      {onClick && <MapClickHandler onClick={onClick} />}

      {visibleMarkers.map((marker) => (
        <MapMarkerLayer key={marker.id} marker={marker} />
      ))}

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
    </div>
  );
};

export default MapComponent;
