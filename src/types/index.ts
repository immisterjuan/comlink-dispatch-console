export type MarkerType =
  | 'default'
  | 'flag'
  | 'user-stopped'
  | 'user-moving'
  | 'user-sos'
  | 'connected-user'
  | 'last-known';

export interface MarkerData {
  id: string;
  lat: number;
  lng: number;
  title: string;
  markerType?: MarkerType;
  type?: string;
  battery?: number;
  isSOS?: boolean;
  isMoving?: boolean;
  isOffline?: boolean;
  updatedAt?: number;
}

export interface GeoJsonData {
  id: string;
  data: any;
}
