import React, { useEffect, useState, useCallback } from 'react';
import { supabase, MAP_CHANNEL } from '../supabaseClient';
import type { MarkerData, GeoJsonData, UserStatus } from '../types';
import { fetchLiveMarkers, normalizeStatus } from '../lib/db';
import { get, set } from 'idb-keyval';

const DISCONNECT_STATUSES = new Set(['disconnected', 'disconnect', 'offline', 'logout', 'logged_out']);

// Same thresholds as the mobile app (SupabaseContext.tsx): offline after
// 6.5 min silent, evicted entirely after 30 min silent.
const STALENESS_THRESHOLD_MS = 6.5 * 60_000;
const GHOST_EVICTION_MS = 30 * 60_000;

// A device that drops out of presence is removed after a short grace period,
// unless it keeps broadcasting from the background (mobile-status /
// background-location) — in which case it stays until the staleness thresholds.
const LEAVE_REMOVAL_GRACE_MS = 10_000;

const isPin = (m: MarkerData) => m.markerType === 'default' || m.markerType === 'flag';

// Ignore sub-threshold GPS drift so a stationary tracker doesn't shake.
const POSITION_DEADBAND_M = 10;

const approxDistanceM = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const x = toRad(lng2 - lng1) * Math.cos(toRad((lat1 + lat2) / 2));
  const y = toRad(lat2 - lat1);
  return Math.sqrt(x * x + y * y) * 6_371_000;
};

// Copy only the fields an update actually carries, so partial payloads
// (mobile-status has no battery/type/SOS) never wipe existing data.
const mergeMarker = (base: MarkerData, update: MarkerData): MarkerData => {
  const next: MarkerData = { ...base };
  if (update.lat !== undefined && update.lng !== undefined) {
    // Dead-band: only accept a move that exceeds the drift threshold.
    if (approxDistanceM(base.lat, base.lng, update.lat, update.lng) >= POSITION_DEADBAND_M) {
      next.lat = update.lat;
      next.lng = update.lng;
    }
  }
  if (update.title) next.title = update.title;
  if (update.markerType) next.markerType = update.markerType;
  if (update.type !== undefined) next.type = update.type;
  if (update.status !== undefined) next.status = update.status;
  if (update.badgeNumber !== undefined) next.badgeNumber = update.badgeNumber;
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

  // Presence bookkeeping for disconnect detection.
  const presentIdsRef = React.useRef<Set<string>>(new Set());
  const pendingLeaveRemovalsRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Devices that left presence but are still broadcasting from the background:
  // they are governed by the staleness thresholds instead of being removed.
  const httpAliveIdsRef = React.useRef<Set<string>>(new Set());

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

  // Hydrate from Postgres on boot (flattened users + connected_users JOIN)
  // so the map has last known positions before any broadcast arrives.
  // Dispatch mirrors the result back into IndexedDB (refactor.md §2).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const live = await fetchLiveMarkers();
        if (cancelled || live.length === 0) return;
        setMarkers(prev => {
          const liveIds = new Set(live.map(m => m.id));
          const next = [
            ...prev.filter(isPin),
            ...live,
            ...prev.filter(m => !isPin(m) && !liveIds.has(m.id)),
          ];
          live.forEach(m => {
            if (!lastSeenRef.current.has(m.id)) {
              lastSeenRef.current.set(m.id, m.updatedAt ?? Date.now());
            }
          });
          if (role === 'dispatch') void set('markers', next);
          return next;
        });
      } catch (e) {
        console.error('Postgres hydration failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);



  const broadcastUpdate = useCallback(async (newMarkers: MarkerData[], newGeojsons: GeoJsonData[]) => {
    setMarkers(newMarkers);
    setGeojsons(newGeojsons);
    
    if (role === 'dispatch') {
      await set('markers', newMarkers);
      await set('geojsons', newGeojsons);
    }

    if (!supabase) return;
    await supabase.channel(MAP_CHANNEL).send({
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

  // Re-center the view when a unit first enters SOS (rising edge only, so
  // ongoing SOS updates don't fight the operator's manual panning).
  const centerOnSos = useCallback((id: string, lat: number, lng: number) => {
    const before = latestState.current.markers.find(m => m.id === id);
    if (before?.isSOS) return;
    setFocusLocation({ lat, lng });
  }, []);

  const cancelLeaveRemoval = useCallback((id: string) => {
    const timer = pendingLeaveRemovalsRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      pendingLeaveRemovalsRef.current.delete(id);
    }
  }, []);

  const removeMarker = useCallback((id?: string) => {
    if (!id) return;
    cancelLeaveRemoval(id);
    httpAliveIdsRef.current.delete(id);
    lastSeenRef.current.delete(id);
    setMarkers(prev => {
      const updated = prev.filter(m => m.id !== id);
      if (role === 'dispatch') set('markers', updated).catch(console.error);
      return updated;
    });
  }, [role, cancelLeaveRemoval]);

  const scheduleLeaveRemoval = useCallback((id: string) => {
    if (pendingLeaveRemovalsRef.current.has(id)) return;
    const timer = setTimeout(() => {
      pendingLeaveRemovalsRef.current.delete(id);
      removeMarker(id);
    }, LEAVE_REMOVAL_GRACE_MS);
    pendingLeaveRemovalsRef.current.set(id, timer);
  }, [removeMarker]);

  // Apply a tracker update from any source (presence / mobile-status /
  // background-location / user-* workflow broadcasts): refresh liveness,
  // create or merge the marker. `persist` writes the result to IndexedDB
  // (dispatch only) — used for significant state transitions, never for
  // high-frequency movement ticks.
  const upsertMarker = useCallback((update: MarkerData, persist = false) => {
    if (!update.id) return;
    if (update.lat === undefined || update.lng === undefined) return;
    lastSeenRef.current.set(update.id, Date.now());
    // A live signal cancels any pending leave-removal; a signal from a device
    // that is absent from presence marks it as background-alive.
    cancelLeaveRemoval(update.id);
    if (!presentIdsRef.current.has(update.id)) httpAliveIdsRef.current.add(update.id);
    if (update.isSOS) centerOnSos(update.id, update.lat, update.lng);

    setMarkers(prev => {
      const idx = prev.findIndex(m => m.id === update.id);
      if (idx === -1) {
        const next = [...prev, { ...update, isOffline: false }];
        if (persist && role === 'dispatch') void set('markers', next);
        return next;
      }
      const existing = prev[idx];
      const merged = { ...mergeMarker(existing, update), isOffline: false };
      if (
        merged.lat === existing.lat && merged.lng === existing.lng &&
        merged.title === existing.title && merged.type === existing.type &&
        merged.status === existing.status && merged.badgeNumber === existing.badgeNumber &&
        merged.battery === existing.battery && merged.isSOS === existing.isSOS &&
        merged.isMoving === existing.isMoving && merged.markerType === existing.markerType &&
        merged.updatedAt === existing.updatedAt
      ) return prev;
      const next = prev.slice();
      next[idx] = merged;
      if (persist && role === 'dispatch') void set('markers', next);
      return next;
    });
  }, [role, cancelLeaveRemoval, centerOnSos]);

  // Mobile workflow broadcasts (refactor.md §4): user-active / user-moving /
  // user-stopped / user-sos all carry the current position. user-moving is
  // high-frequency, so its ticks are merged on the map but never persisted.
  const handleTrackerEvent = useCallback((payload: any, fallbackStatus: UserStatus, persist: boolean) => {
    const data = payload?.payload ?? payload;
    if (!data) return;
    const rawId = data.id ?? data.userUUID ?? data.user_id;
    if (!rawId) return;
    const lat = Number(data.lat);
    const lng = Number(data.lng ?? data.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const status = normalizeStatus(data.status) ?? fallbackStatus;
    const parsedTs = data.tsUpdated ? Date.parse(String(data.tsUpdated)) : NaN;
    upsertMarker({
      id: String(rawId),
      lat,
      lng,
      title: data.name || data.title || 'Connected User',
      badgeNumber: data.badge_number,
      type: data.type,
      status,
      isSOS: status === 'sos',
      isMoving: typeof data.isMoving === 'boolean' ? data.isMoving : status === 'active',
      updatedAt: Number.isNaN(parsedTs) ? (data.updatedAt ?? undefined) : parsedTs
    }, persist);
  }, [upsertMarker]);

  const handleDisconnectEvent = useCallback((payload: any) => {
    const data = payload?.payload ?? payload;
    removeMarker(data?.id ?? data?.userId ?? data?.user_id);
  }, [removeMarker]);

  useEffect(() => {
    if (!supabase) return;

    const pendingRemovals = pendingLeaveRemovalsRef.current;
    const channel = supabase.channel(MAP_CHANNEL);

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        let count = 0;
        const activeUsers: MarkerData[] = [];
        const fresh: MarkerData[] = [];
        const presentIds = new Set<string>();

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
          presentIds.add(activeId);
          const lat = client.lat;
          const lng = client.lng ?? client.lon;
          if (lat === undefined || lng === undefined) return;

          const live: MarkerData = {
            id: activeId,
            lat,
            lng,
            title: client.title || client.name || 'Connected User',
            type: client.type,
            status: normalizeStatus(client.status) ?? undefined,
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

        // Disconnect detection: a device that drops out of presence is
        // removed after a short grace period (explicit "Disconnect Tracker" /
        // app kill / network loss). If it keeps broadcasting from the
        // background it is kept and governed by the staleness thresholds
        // instead — mirroring the mobile app's rationale.
        presentIds.forEach(id => {
          cancelLeaveRemoval(id);
          httpAliveIdsRef.current.delete(id);
        });
        presentIdsRef.current.forEach(id => {
          if (!presentIds.has(id) && !httpAliveIdsRef.current.has(id)) {
            scheduleLeaveRemoval(id);
          }
        });
        presentIdsRef.current = presentIds;

        // A unit that just entered SOS recenters the view.
        fresh.forEach(live => {
          if (live.isSOS) centerOnSos(live.id, live.lat, live.lng);
        });

        // Merge the latest payload into the markers. Position/status updates
        // only apply when the payload actually advanced (device re-tracked).
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

        // Only re-center when the tracker is first seen: following every
        // update makes the map jump around (especially with several trackers).
        const isNewMarker = !latestState.current.markers.some(m => m.id === data.id);

        const legacyStatus = normalizeStatus(data.status);
        upsertMarker({
          id: data.id,
          lat: data.lat,
          lng: data.lng,
          title: data.title || 'Mobile User',
          type: data.type,
          status: legacyStatus ?? undefined,
          battery: data.battery,
          isSOS: data.isSOS === undefined ? legacyStatus === 'sos' : !!data.isSOS,
          isMoving: typeof data.isMoving === 'boolean' ? data.isMoving : undefined
        });

        if (isNewMarker) setFocusLocation({ lat: data.lat, lng: data.lng });
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
          status: normalizeStatus(data.status) ?? undefined,
          battery: data.battery,
          isSOS: data.isSOS === undefined ? undefined : !!data.isSOS,
          isMoving: typeof data.isMoving === 'boolean' ? data.isMoving : undefined,
          updatedAt: data.updatedAt
        });
      })
      .on('broadcast', { event: 'user-active' }, (payload) => {
        handleTrackerEvent(payload, 'active', true);
      })
      .on('broadcast', { event: 'user-moving' }, (payload) => {
        // High-frequency telemetry: map only, no IndexedDB write.
        handleTrackerEvent(payload, 'active', false);
      })
      .on('broadcast', { event: 'user-stopped' }, (payload) => {
        // Final anchor — write the last position to the local database.
        handleTrackerEvent(payload, 'stop', true);
      })
      .on('broadcast', { event: 'user-sos' }, (payload) => {
        handleTrackerEvent(payload, 'sos', true);
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
      pendingRemovals.forEach(timer => clearTimeout(timer));
      pendingRemovals.clear();
      supabase?.removeChannel(channel);
    };
  }, [role, broadcastUpdate, removeMarker, handleDisconnectEvent, handleTrackerEvent, upsertMarker, cancelLeaveRemoval, scheduleLeaveRemoval, centerOnSos]);

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
            httpAliveIdsRef.current.delete(m.id);
            cancelLeaveRemoval(m.id);
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
  }, [cancelLeaveRemoval]);

  return { markers, geojsons, presenceUsers, broadcastUpdate, onlineUsers, focusLocation };
};
