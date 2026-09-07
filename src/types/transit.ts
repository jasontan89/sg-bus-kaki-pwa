export type BusLoad = 'SEA' | 'SDA' | 'LSD' | '';
export type BusType = 'SD' | 'DD' | 'BD' | '';
export type BusFeature = 'WAB' | '';

export interface NextBusInfo {
  estimatedArrival: string; // ISO string or ""
  etaMinutes: number | null; // e.g. 0 for Arr, 2, 5, etc.
  load: BusLoad; // SEA = Seats Available, SDA = Standing Available, LSD = Limited Standing
  feature: BusFeature; // WAB = Wheelchair Accessible
  type: BusType; // SD = Single Deck, DD = Double Deck, BD = Bendy
  latitude?: number;
  longitude?: number;
  visitNumber?: number;
}

export interface BusServiceArrival {
  serviceNo: string;
  operator: string;
  nextBus: NextBusInfo;
  nextBus2?: NextBusInfo;
  nextBus3?: NextBusInfo;
}

export interface BusArrivalData {
  busStopCode: string;
  services: BusServiceArrival[];
  lastUpdated: string;
}

export interface BusStop {
  bus_stop_code: string;
  road_name: string;
  description: string;
  latitude: number;
  longitude: number;
  distance?: number; // In meters or km
}

export interface BusRouteStop {
  service_no: string;
  direction: number;
  stop_sequence: number;
  bus_stop_code: string;
  distance: number;
  wd_first_bus: string;
  wd_last_bus: string;
  sat_first_bus: string;
  sat_last_bus: string;
  sun_first_bus: string;
  sun_last_bus: string;
  description?: string;
  road_name?: string;
  latitude?: number;
  longitude?: number;
}

export type MRTLineCode = 'NSL' | 'EWL' | 'CCL' | 'DTL' | 'NEL' | 'TEL';

export interface MRTLineInfo {
  code: MRTLineCode;
  name: string;
  color: string;
  bgClass: string;
  textClass: string;
  status: 'Normal' | 'Disrupted' | 'Delays';
  details?: string;
  crowdLevel?: 'Low' | 'Moderate' | 'High';
}

export interface MRTAlert {
  status: number; // 1 = Normal, 2 = Disrupted
  affected?: string[];
  message?: string;
  updated_at?: string;
}

export interface BusArrivalAlarm {
  id?: number | string;
  endpoint: string;
  bus_stop_code: string;
  bus_stop_name?: string;
  service_no: string;
  lead_mins: number;
  fired?: boolean;
  created_at?: string;
}

export interface AlightingAlarmState {
  armed: boolean;
  stopCode: string;
  stopName: string;
  roadName: string;
  targetLat: number;
  targetLon: number;
  thresholdMeters: number; // default 500m
  currentDistanceMeters: number | null;
  isTriggered: boolean;
  keepScreenAwake: boolean;
}

export interface FavoriteStop {
  bus_stop_code: string;
  road_name: string;
  description: string;
  custom_name?: string;
  latitude: number;
  longitude: number;
  hidden_services: string[];
  added_at: number;
}
