import React, { useState, useEffect } from 'react';
import { BusStop, BusRouteStop, BusArrivalData } from '../types/transit';
import { searchBusStops, fetchBusRoute, fetchBusArrivals } from '../services/api';
import { isFavorite, saveFavorite, removeFavorite } from '../services/offlineStorage';
import { SEED_BUS_STOPS } from '../services/busStopsData';
import { BusArrivalCard } from '../components/BusArrivalCard';
import { SetArrivalAlarmModal } from '../components/SetArrivalAlarmModal';
import { Search, MapPin, Route as RouteIcon, Star, RefreshCw, X, ArrowUpDown, Bell } from 'lucide-react';

interface SearchViewProps {
  initialServiceNo?: string;
  onArmAlightAlarm: (stop: BusStop) => void;
  onShowToast: (text: string, type?: 'success' | 'error' | 'info') => void;
  onFavoritesChanged?: () => void;
}

export const SearchView: React.FC<SearchViewProps> = ({
  initialServiceNo,
  onArmAlightAlarm,
  onShowToast,
  onFavoritesChanged,
}) => {
  const [query, setQuery] = useState(initialServiceNo || '');
  const [matchingStops, setMatchingStops] = useState<BusStop[]>([]);
  const [routeStops, setRouteStops] = useState<BusRouteStop[]>([]);
  const [routeDirection, setRouteDirection] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<'stops' | 'route'>('stops');
  const [loading, setLoading] = useState(false);

  // Selected stop modal / arrivals
  const [selectedStop, setSelectedStop] = useState<BusStop | null>(null);
  const [arrivals, setArrivals] = useState<BusArrivalData | null>(null);
  const [loadingArrivals, setLoadingArrivals] = useState(false);
  const [isFav, setIsFav] = useState(false);

  const [alarmModalData, setAlarmModalData] = useState<{
    isOpen: boolean;
    serviceNo: string;
  }>({ isOpen: false, serviceNo: '' });

  // If initialServiceNo passed, automatically search route
  useEffect(() => {
    if (initialServiceNo) {
      setQuery(initialServiceNo);
      handleSearchRoute(initialServiceNo, 1);
    }
  }, [initialServiceNo]);

  // Debounced search for stops
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setMatchingStops([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const stops = await searchBusStops(q);
        setMatchingStops(stops);

        // If query looks like a bus service number (e.g. 1-4 digits/letters like 65, 190, 857, 960e)
        if (/^[0-9]{1,3}[a-zA-Z]?$/.test(q)) {
          await handleSearchRoute(q, routeDirection);
        }
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSearchRoute = async (service: string, dir: number) => {
    try {
      const stops = await fetchBusRoute(service, dir);
      setRouteStops(stops);
      if (stops.length > 0) {
        setActiveTab('route');
      }
    } catch {
      // safe fail
    }
  };

  const handleSelectStop = async (stop: BusStop) => {
    setSelectedStop(stop);
    setLoadingArrivals(true);
    try {
      const [favStatus, arrivalData] = await Promise.all([
        isFavorite(stop.bus_stop_code),
        fetchBusArrivals(stop.bus_stop_code),
      ]);
      setIsFav(favStatus);
      setArrivals(arrivalData);
    } catch (err) {
      console.error('Error fetching arrivals:', err);
    } finally {
      setLoadingArrivals(false);
    }
  };

  const handleToggleFavorite = async () => {
    if (!selectedStop) return;
    try {
      if (isFav) {
        await removeFavorite(selectedStop.bus_stop_code);
        setIsFav(false);
        onShowToast(`Removed ${selectedStop.bus_stop_code} from Favorites`, 'info');
      } else {
        await saveFavorite({
          bus_stop_code: selectedStop.bus_stop_code,
          description: selectedStop.description,
          road_name: selectedStop.road_name,
          latitude: selectedStop.latitude,
          longitude: selectedStop.longitude,
          hidden_services: [],
          added_at: Date.now(),
        });
        setIsFav(true);
        onShowToast(`Saved ${selectedStop.description} to Favorites! ⭐`, 'success');
      }
      if (onFavoritesChanged) onFavoritesChanged();
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  };

  return (
    <div className="space-y-3 pb-24">
      {/* Search Input Bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 transform -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search bus stop, road name, or bus number (e.g. 65)..."
          className="w-full pl-10 pr-10 py-3 rounded-2xl bg-brand-dark border border-slate-700 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-brand-sky shadow-lg"
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setMatchingStops([]);
              setRouteStops([]);
            }}
            className="absolute right-3.5 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Tabs (Stops vs Route Sequence) */}
      {routeStops.length > 0 && (
        <div className="flex bg-slate-900/80 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('stops')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'stops'
                ? 'bg-brand-blue text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>Bus Stops ({matchingStops.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('route')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'route'
                ? 'bg-brand-blue text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <RouteIcon className="w-3.5 h-3.5" />
            <span>Bus {query} Route ({routeStops.length} stops)</span>
          </button>
        </div>
      )}

      {/* Route Direction Switcher (When Route is active) */}
      {activeTab === 'route' && routeStops.length > 0 && (
        <div className="bg-brand-dark/95 border border-slate-800 rounded-2xl p-3 shadow-lg flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="bg-brand-blue text-white font-extrabold text-xs px-2.5 py-0.5 rounded-lg">
              Bus {query}
            </span>
            <span className="text-xs text-slate-300 font-semibold">
              Direction {routeDirection}
            </span>
          </div>
          <button
            onClick={() => {
              const nextDir = routeDirection === 1 ? 2 : 1;
              setRouteDirection(nextDir);
              handleSearchRoute(query, nextDir);
            }}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-brand-sky text-xs font-bold hover:bg-slate-800 active:scale-95 transition-all"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            <span>Switch Direction</span>
          </button>
        </div>
      )}

      {/* Content Area */}
      {loading ? (
        <div className="py-12 text-center text-xs text-slate-400 flex flex-col items-center justify-center space-y-2">
          <RefreshCw className="w-5 h-5 animate-spin text-brand-sky" />
          <span>Searching 5,000+ bus stops & routes...</span>
        </div>
      ) : activeTab === 'route' && routeStops.length > 0 ? (
        /* Sequential Route Stops List */
        <div className="space-y-2">
          {routeStops.map((rStop, idx) => (
            <div
              key={rStop.stop_sequence || idx}
              onClick={() => {
                const seed = SEED_BUS_STOPS.find((s) => s.bus_stop_code === rStop.bus_stop_code);
                const lat = rStop.latitude || seed?.latitude || 1.2968;
                const lon = rStop.longitude || seed?.longitude || 103.8525;
                handleSelectStop({
                  bus_stop_code: rStop.bus_stop_code,
                  description: rStop.description || seed?.description || `Stop ${rStop.bus_stop_code}`,
                  road_name: rStop.road_name || seed?.road_name || '',
                  latitude: lat,
                  longitude: lon,
                });
              }}
              className="bg-brand-dark/80 hover:bg-brand-dark border border-slate-800 hover:border-slate-700 rounded-xl p-3 shadow-md flex items-center justify-between cursor-pointer transition-all"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <span className="w-6 h-6 rounded-full bg-slate-800 text-slate-400 font-mono text-[10px] font-bold flex items-center justify-center shrink-0">
                  {rStop.stop_sequence}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center space-x-1.5">
                    <span className="font-mono text-xs font-bold text-brand-sky">
                      {rStop.bus_stop_code}
                    </span>
                    <h4 className="text-xs font-bold text-white truncate">
                      {rStop.description || 'Bus Stop'}
                    </h4>
                  </div>
                  <p className="text-[10px] text-slate-400 truncate">
                    {rStop.road_name || `${rStop.distance} km`}
                  </p>
                </div>
              </div>

              {/* Operating Hours Pill */}
              <div className="text-right shrink-0 text-[10px] font-mono text-slate-400">
                <span>{rStop.wd_first_bus || '05:30'}</span>
                <span className="mx-1 text-slate-600">-</span>
                <span>{rStop.wd_last_bus || '23:30'}</span>
              </div>
            </div>
          ))}
        </div>
      ) : matchingStops.length > 0 ? (
        /* Bus Stop Search Results */
        <div className="space-y-2">
          {matchingStops.map((stop) => (
            <div
              key={stop.bus_stop_code}
              onClick={() => handleSelectStop(stop)}
              className="bg-brand-dark/80 hover:bg-brand-dark border border-slate-800 hover:border-slate-700 rounded-xl p-3 shadow-md flex items-center justify-between cursor-pointer transition-all"
            >
              <div className="min-w-0 pr-2">
                <div className="flex items-center space-x-2">
                  <span className="font-mono text-xs font-bold text-brand-sky bg-brand-sky/10 border border-brand-sky/30 px-1.5 py-0.5 rounded">
                    {stop.bus_stop_code}
                  </span>
                  <h4 className="text-xs font-bold text-white truncate">
                    {stop.description}
                  </h4>
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                  {stop.road_name}
                </p>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onArmAlightAlarm(stop);
                }}
                className="flex items-center space-x-1 px-2 py-1 rounded-lg bg-brand-sky/15 border border-brand-sky/30 text-brand-sky hover:bg-brand-sky/25 text-[11px] font-bold shrink-0 active:scale-95 transition-all"
                title="Arm Alight Alert for this stop"
              >
                <Bell className="w-3.5 h-3.5" />
                <span>Alight</span>
              </button>
            </div>
          ))}
        </div>
      ) : query.trim() ? (
        <div className="py-12 text-center text-slate-500 text-xs">
          No bus stops or routes found matching "{query}".
        </div>
      ) : (
        <div className="py-12 text-center text-slate-500 text-xs space-y-1">
          <p className="font-semibold text-slate-400">Search Singapore Transit</p>
          <p>Type any 5-digit bus stop code, street name, or bus service number.</p>
        </div>
      )}

      {/* Selected Stop Live Arrivals Drawer / Modal */}
      {selectedStop && (
        <div className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-brand-card border border-slate-700 w-full max-w-md max-h-[80vh] overflow-y-auto rounded-2xl p-5 shadow-2xl space-y-3 animate-in slide-in-from-bottom-6 duration-200">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="bg-brand-sky/20 border border-brand-sky/40 text-brand-sky font-mono font-black text-xs px-2 py-0.5 rounded-md">
                    {selectedStop.bus_stop_code}
                  </span>
                  <h3 className="text-sm font-black text-white">{selectedStop.description}</h3>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{selectedStop.road_name}</p>
              </div>

              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => {
                    onArmAlightAlarm(selectedStop);
                    setSelectedStop(null);
                  }}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-xl bg-brand-sky/15 border border-brand-sky/40 text-brand-sky hover:bg-brand-sky/25 text-xs font-bold active:scale-95 transition-all"
                  title="Arm Alighting Wake-up Alarm"
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span>Alight Alert</span>
                </button>
                <button
                  onClick={handleToggleFavorite}
                  className={`p-1.5 rounded-lg border ${
                    isFav
                      ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                  title="Favorite"
                >
                  <Star className={`w-4 h-4 ${isFav ? 'fill-amber-400' : ''}`} />
                </button>
                <button
                  onClick={() => setSelectedStop(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Arrivals */}
            <div className="space-y-2.5 pt-1">
              {loadingArrivals ? (
                <div className="py-6 text-center text-xs text-slate-400 flex items-center justify-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-brand-sky" />
                  <span>Loading arrivals...</span>
                </div>
              ) : arrivals?.services && arrivals.services.length > 0 ? (
                arrivals.services.map((svc) => (
                  <BusArrivalCard
                    key={svc.serviceNo}
                    service={svc}
                    busStopCode={selectedStop.bus_stop_code}
                    busStopName={selectedStop.description}
                    onSetAlarm={(serviceNo) =>
                      setAlarmModalData({ isOpen: true, serviceNo })
                    }
                    onViewRoute={(serviceNo) => {
                      setSelectedStop(null);
                      setQuery(serviceNo);
                      handleSearchRoute(serviceNo, 1);
                    }}
                  />
                ))
              ) : (
                <div className="py-6 text-center text-xs text-slate-500">
                  No active bus services or offline tunnel mode.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Set Arrival Alarm Modal */}
      {selectedStop && (
        <SetArrivalAlarmModal
          isOpen={alarmModalData.isOpen}
          busStopCode={selectedStop.bus_stop_code}
          busStopName={selectedStop.description}
          serviceNo={alarmModalData.serviceNo}
          onClose={() => setAlarmModalData({ isOpen: false, serviceNo: '' })}
          onSuccess={(msg) => onShowToast(msg, 'success')}
          onError={(err) => onShowToast(err, 'error')}
        />
      )}
    </div>
  );
};
