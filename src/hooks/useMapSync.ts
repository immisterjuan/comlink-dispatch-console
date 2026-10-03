import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import type { MarkerData, GeoJsonData } from '../types';
import { get, set } from 'idb-keyval';

const DISCONNECT_STATUSES = new Set(['disconnected', 'disconnect', 'offline', 'logout', 'logged_out']);

// Same thresholds as the mobile app (SupabaseContext.tsx): offline after
// 6.5 min silent, evicted entirely after 30 min silent.
const STALENESS_THRESHOLD_MS = 6.5 * 60_000;
const GHOST_EVICTION_MS = 30 * 60_000;

const isPin = (m: MarkerData) => m.markerType === 'default' || m.markerType === 'flag';

// Copy only the fields an update actually carries, so partial payloads
// (mobile-status has no battery/type/SOS) never wipe existing data.
const mergeMarker = (base: MarkerData, update: MarkerData): MarkerData => {
  const next: MarkerData = { ...base };
  if (update.lat !== undefined && update.lng !== undefined) {
    next.lat = update.lat;
    next.lng = update.lng;
  }
  if (update.title) next.title = update.title;
  if (update.markerType) next.markerType = update.markerType;
  if (update.type !== undefined) next.type = update.type;
  if (update.battery !== undefined) next.battery = update.battery;
  if (update.isSOS !== undefined) next.isSOS = update.isSOS;
  if (update.isMoving !== undefined) next.isMoving = update.isMoving;
  if (update.updatedAt !== undefined) next.updatedAt = update.updatedAt;
  return next;
};

export const useMapSync = (role: 'dispatch' | 'kiosk') => {
  const [markers, setMarkers] = useState<MarkerData[]>([]);
  const [geojsons, setGeojsons] = useState<GeoJsonData[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<number>(0);
  const [focusLocation, setFocusLocation] = useState<{lat: number, lng: number} | null>(null);

  // Local receipt time of each tracker's last update (mirrors the mobile
  // app's lastSeenRef): drives the offline / eviction thresholds.
  const lastSeenRef = React.useRef<Map<string, number>>(new Map());

  // Fetch remote GeoJSON overlay on mount
  useEffect(() => {
    const fetchRemoteGeoJson = async () => {
      try {
        const indexResponse = await fetch('https://raw.githubusercontent.com/immisterjuan/geojson-overlay/refs/heads/main/overlay.json');
        if (!indexResponse.ok) throw new Error('Failed to fetch overlay index');
        
        const indexData = await indexResponse.json();
        if (!Array.isArray(indexData) || indexData.length === 0) return;
        
        const targetLabel = import.meta.env.VITE_DEFAULT_OVERLAY;
        let selectedEntry = indexData.find((entry: any) => entry.label === targetLabel);
        
        // Fallback to the first one if not found or no env var provided
        if (!selectedEntry) selectedEntry = indexData[0];
        
        if (!selectedEntry.file) return;

        const geoJsonResponse = await fetch(`https://raw.githubusercontent.com/immisterjuan/geojson-overlay/refs/heads/main/${selectedEntry.file}`);
        if (!geoJsonResponse.ok) throw new Error('Failed to fetch GeoJSON file');

        const presetLocationData = await geoJsonResponse.json();

        const presetGeoJson: GeoJsonData = {
          id: `preset-geojson-${selectedEntry.file}`,
          data: presetLocationData
        };

        setGeojsons(prev => {
          if (prev.some(g => g.id === presetGeoJson.id)) return prev;
          const updated = [...prev, presetGeoJson];
          if (role === 'dispatch') {
            import('idb-keyval').then(({ set }) => set('geojsons', updated).catch(console.error));
          }
          return updated;
        });

        // Extract point to focus (look for the first Point feature)
        if (presetLocationData.features && presetLocationData.features.length > 0) {
          const pointFeature = presetLocationData.features.find((f: any) => f.geometry && f.geometry.type === 'Point');
          if (pointFeature) {
            const [lng, lat] = pointFeature.geometry.coordinates;
            if (!isNaN(lat) && !isNaN(lng)) {
              setFocusLocation({ lat, lng });
            }
          } else {
            // Fallback: Just grab the first coordinate of the first feature if no Point is found
            const firstFeature = presetLocationData.features[0];
            if (firstFeature.geometry && firstFeature.geometry.coordinates) {
               // highly dependent on geometry type, skip for now if not a point
            }
          }
        }
      } catch (e) {
        console.error("Failed to load remote GeoJSON overlay", e);
      }
    };

    fetchRemoteGeoJson();
  }, [role]);

  // Load from IndexedDB for dispatch on mount
  useEffect(() => {
    if (role === 'dispatch') {
      const loadData = async () => {
        try {
          const storedMarkers = await get('markers');
          const storedGeojsons = await get('geojsons');
          if (storedMarkers) {
            // merge with any env preset
            setMarkers(prev => {
              const prevIds = new Set(prev.map(p => p.id));
              const merged = [...prev];
              storedMarkers.forEach((m: MarkerData) => {
                if (!prevIds.has(m.id)) {
                  merged.push(m);
                  if (!isPin(m) && !lastSeenRef.current.has(m.id)) {
                    lastSeenRef.current.set(m.id, m.updatedAt ?? Date.now());
                  }
                }
              });
              return merged;
            });
          }
          if (storedGeojsons) setGeojsons(storedGeojsons);
        } catch (e) {
          console.error('Failed to load from IndexedDB', e);
        }
      };
      loadData();
    }
  }, [role]);



  const broadcastUpdate = useCallback(async (newMarkers: MarkerData[], newGeojsons: GeoJsonData[]) => {
    setMarkers(newMarkers);
    setGeojsons(newGeojsons);
    
    if (role === 'dispatch') {
      await set('markers', newMarkers);
      await set('geojsons', newGeojsons);
    }

    if (!supabase) return;
    await supabase.channel('map-sync').send({
      type: 'broadcast',
      event: 'update-map',
      payload: { markers: newMarkers, geojsons: newGeojsons }
    });
  }, [role]);

  const [presenceUsers, setPresenceUsers] = useState<MarkerData[]>([]);

  // Ref to hold latest state for subscribe callback without triggering re-runs
  const latestState = React.useRef({ markers, geojsons });
  useEffect(() => {
    latestState.current = { markers, geojsons };
  }, [markers, geojsons]);

  const removeMarker = useCallback((id?: string) => {
    if (!id) return;
    lastSeenRef.current.delete(id);
    setMarkers(prev => {
      const updated = prev.filter(m => m.id !== id);
      if (role === 'dispatch') set('markers', updated).catch(console.error);
      return updated;
    });
  }, [role]);

  // Apply a tracker update from any source (presence / mobile-status /
  // background-location): refresh liveness, create or merge the marker.
  const upsertMarker = useCallback((update: MarkerData) => {
    if (!update.id) return;
    if (update.lat === undefined || update.lng === undefined) return;
    lastSeenRef.current.set(update.id, Date.now());

    setMarkers(prev => {
      const idx = prev.findIndex(m => m.id === update.id);
      if (idx === -1) return [...prev, { ...update, isOffline: false }];
      const existing = prev[idx];
      const merged = { ...mergeMarker(existing, update), isOffline: false };
      if (
        merged.lat === existing.lat && merged.lng === existing.lng &&
        merged.title === existing.title && merged.type === existing.type &&
        merged.battery === existing.battery && merged.isSOS === existing.isSOS &&
        merged.isMoving === existing.isMoving && merged.markerType === existing.markerType &&
        merged.updatedAt === existing.updatedAt
      ) return prev;
      const next = prev.slice();
      next[idx] = merged;
      return next;
    });
  }, []);

  const handleDisconnectEvent = useCallback((payload: any) => {
    const data = payload?.payload ?? payload;
    removeMarker(data?.id ?? data?.userId ?? data?.user_id);
  }, [removeMarker]);

  useEffect(() => {
    if (!supabase) return;

    const channel = supabase.channel('map-sync');

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        let count = 0;
        const activeUsers: MarkerData[] = [];
        const fresh: MarkerData[] = [];

        Object.keys(state).forEach(key => {
          const clients: any[] = state[key];
          count += clients.length;

          // Latest payload for this presence key (same rule as the mobile app)
          let latest: any = null;
          clients.forEach((client: any) => {
            if (!latest || (client.updatedAt || 0) > (latest.updatedAt || 0)) latest = client;
          });
          if (!latest) return;

          const client = latest;
          const activeId = client.id || key;
          const lat = client.lat;
          const lng = client.lng ?? client.lon;
          if (lat === undefined || lng === undefined) return;

          const live: MarkerData = {
            id: activeId,
            lat,
            lng,
            title: client.title || client.name || 'Connected User',
            type: client.type,
            battery: client.battery,
            isSOS: client.isSOS === true || client.status === 'sos',
            isMoving: client.isMoving === true || client.status === 'moving',
            isOffline: false,
            updatedAt: client.updatedAt,
            markerType: client.markerType
          };
          activeUsers.push(live);
          fresh.push(live);
        });

        setOnlineUsers(count);
        setPresenceUsers(activeUsers);

        // A presence leave alone does NOT delete the marker: the device may
        // still be broadcasting from the background (mobile-status /
        // background-location). Liveness thresholds handle true disconnects.
        setMarkers(prev => {
          let next = prev;
          let touched = false;
          fresh.forEach(live => {
            const idx = next.findIndex(m => m.id === live.id);
            if (idx === -1) {
              next = [...next, { ...live, isOffline: false }];
              lastSeenRef.current.set(live.id, Date.now());
              touched = true;
              return;
            }
            const existing = next[idx];
            // Only refresh when the payload actually advanced (device re-tracked)
            if (live.updatedAt !== undefined && existing.updatedAt !== undefined && live.updatedAt <= existing.updatedAt) return;
            const merged = { ...mergeMarker(existing, live), isOffline: false };
            next = next.slice();
            next[idx] = merged;
            lastSeenRef.current.set(live.id, Date.now());
            touched = true;
          });
          return touched ? next : prev;
        });
      })
      .on('broadcast', { event: 'update-map' }, (payload) => {
        const incoming: MarkerData[] | undefined = payload.payload.markers;
        if (incoming) {
          // Seed liveness for trackers we haven't seen yet (kiosk cold start)
          incoming.forEach(m => {
            if (!isPin(m) && !lastSeenRef.current.has(m.id)) {
              lastSeenRef.current.set(m.id, m.updatedAt ?? Date.now());
            }
          });
          setMarkers(incoming);
        }
        if (payload.payload.geojsons) setGeojsons(payload.payload.geojsons);
      })
      .on('broadcast', { event: 'new-mobile-marker' }, async (payload) => {
        const newMarker = payload.payload as MarkerData;
        setFocusLocation({ lat: newMarker.lat, lng: newMarker.lng });
        upsertMarker(newMarker);

        if (role === 'dispatch') {
          setTimeout(() => {
            broadcastUpdate(latestState.current.markers, latestState.current.geojsons);
          }, 500);
        }
      })
      .on('broadcast', { event: 'mobile-status' }, async (payload) => {
        const data = payload.payload;

        const status = typeof data.status === 'string' ? data.status.toLowerCase() : '';

        // Explicit disconnect from the tracker: drop the marker entirely
        if (DISCONNECT_STATUSES.has(status)) {
          removeMarker(data.id);
          return;
        }

        if (data.lat === undefined || data.lng === undefined) return;

        upsertMarker({
          id: data.id,
          lat: data.lat,
          lng: data.lng,
          title: data.title || 'Mobile User',
          type: data.type,
          battery: data.battery,
          isSOS: data.isSOS === undefined ? undefined : !!data.isSOS,
          isMoving: typeof data.isMoving === 'boolean' ? data.isMoving : undefined
        });

        setFocusLocation({ lat: data.lat, lng: data.lng });
      })
      .on('broadcast', { event: 'background-location' }, (payload) => {
        // Background HTTP broadcasts from mobile trackers (5 min when
        // stationary, every tick when moving) — same liveness source the
        // mobile app uses.
        const data = payload.payload ?? payload;
        if (!data?.id) return;
        if (data.type === 'kiosk' || data.type === 'dispatch') return;
        const lat = data.lat;
        const lng = data.lng ?? data.lon;
        if (lat === undefined || lng === undefined) return;

        upsertMarker({
          id: data.id,
          lat,
          lng,
          title: data.name || data.title || 'Mobile User',
          type: data.type,
          battery: data.battery,
          isSOS: data.isSOS === undefined ? undefined : !!data.isSOS,
          isMoving: typeof data.isMoving === 'boolean' ? data.isMoving : undefined,
          updatedAt: data.updatedAt
        });
      })
      .on('broadcast', { event: 'user-disconnect' }, handleDisconnectEvent)
      .on('broadcast', { event: 'disconnect' }, handleDisconnectEvent)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Do not call channel.track() so web clients act strictly as observers
          if (role === 'dispatch') {
            setTimeout(() => {
              broadcastUpdate(latestState.current.markers, latestState.current.geojsons);
            }, 1000);
          }
        }
      });

    return () => {
      supabase?.removeChannel(channel);
    };
  }, [role, broadcastUpdate, removeMarker, handleDisconnectEvent, upsertMarker]);

  // Offline / eviction loop — same cadence and thresholds as the mobile app
  // (SupabaseContext.tsx): gray out after 6.5 min silent, drop after 30 min.
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setMarkers(prev => {
        let changed = false;
        const next: MarkerData[] = [];
        for (const m of prev) {
          if (isPin(m)) {
            next.push(m);
            continue;
          }
          const lastSeen = lastSeenRef.current.get(m.id) ?? m.updatedAt;
          if (lastSeen === undefined) {
            next.push(m);
            continue;
          }
          if (now - lastSeen > GHOST_EVICTION_MS) {
            lastSeenRef.current.delete(m.id);
            changed = true;
            continue;
          }
          const isOffline = now - lastSeen > STALENESS_THRESHOLD_MS;
          if (!!m.isOffline !== isOffline) {
            next.push({ ...m, isOffline });
            changed = true;
          } else {
            next.push(m);
          }
        }
        return changed ? next : prev;
      });
    }, 60_000);

    return () => clearInterval(interval);
  }, []);

  return { markers, geojsons, presenceUsers, broadcastUpdate, onlineUsers, focusLocation };
};
