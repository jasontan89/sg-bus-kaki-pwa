import React, { useState, useEffect } from 'react';
import { BusStop, BusArrivalData, FavoriteStop } from '../types/transit';
import { fetchNearbyStops, fetchBusArrivals } from '../services/api';
import { isFavorite, saveFavorite, removeFavorite } from '../services/offlineStorage';
import { LeafletMap } from '../components/LeafletMap';
import { BusArrivalCard } from '../components/BusArrivalCard';
import { BusFilterModal } from '../components/BusFilterModal';
import { SetArrivalAlarmModal } from '../components/SetArrivalAlarmModal';
import { Star, RefreshCw, MapPin, Filter, Bell } from 'lucide-react';

interface NearbyViewProps {
  userLat: number | null;
  userLon: number | null;
  onRefreshLocation: () => void;
  onArmAlightAlarm: (stop: BusStop) => void;
  onViewRoute?: (serviceNo: string) => void;
  onShowToast: (text: string, type?: 'success' | 'error' | 'info') => void;
  onFavoritesChanged?: () => void;
}

export const NearbyView: React.FC<NearbyViewProps> = ({
  userLat,
  userLon,
  onRefreshLocation,
  onArmAlightAlarm,
  onViewRoute,
  onShowToast,
  onFavoritesChanged,
}) => {
  const [stops, setStops] = useState<BusStop[]>([]);
  const [selectedStop, setSelectedStop] = useState<BusStop | null>(null);
  const [arrivals, setArrivals] = useState<BusArrivalData | null>(null);
  const [loadingStops, setLoadingStops] = useState(false);
  const [loadingArrivals, setLoadingArrivals] = useState(false);
  const [isFav, setIsFav] = useState(false);

  // Modals state
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [hiddenServices, setHiddenServices] = useState<string[]>([]);
  const [alarmModalData, setAlarmModalData] = useState<{
    isOpen: boolean;
    serviceNo: string;
  }>({ isOpen: false, serviceNo: '' });

  // Load nearby stops when coordinates change
  useEffect(() => {
    const loadStops = async () => {
      setLoadingStops(true);
      const lat = userLat || 1.2968;
      const lon = userLon || 103.8525;
      try {
        const nearby = await fetchNearbyStops(lat, lon, 15);
        setStops(nearby);
        if (nearby.length > 0 && !selectedStop) {
          handleSelectStop(nearby[0]);
        }
      } catch (err) {
        console.error('Error loading nearby stops:', err);
      } finally {
        setLoadingStops(false);
      }
    };
    loadStops();
  }, [userLat, userLon]);

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

  const handleRefreshArrivals = async () => {
    if (!selectedStop) return;
    setLoadingArrivals(true);
    try {
      const data = await fetchBusArrivals(selectedStop.bus_stop_code);
      setArrivals(data);
      onShowToast('Arrivals refreshed', 'success');
    } catch {
      onShowToast('Failed to refresh arrivals', 'error');
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
        const newFav: FavoriteStop = {
          bus_stop_code: selectedStop.bus_stop_code,
          description: selectedStop.description,
          road_name: selectedStop.road_name,
          latitude: selectedStop.latitude,
          longitude: selectedStop.longitude,
          hidden_services: [],
          added_at: Date.now(),
        };
        await saveFavorite(newFav);
        setIsFav(true);
        onShowToast(`Saved ${selectedStop.description} to Favorites! ⭐`, 'success');
      }
      if (onFavoritesChanged) onFavoritesChanged();
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  };

  const availableServices = (arrivals?.services || []).map((s) => s.serviceNo);
  const visibleServices = (arrivals?.services || []).filter(
    (s) => !hiddenServices.includes(s.serviceNo)
  );

  return (
    <div className="flex flex-col space-y-3 pb-24">
      {/* Interactive Leaflet Radar Map */}
      <div className="h-56 sm:h-64 w-full">
        <LeafletMap
          userLat={userLat}
          userLon={userLon}
          stops={stops}
          selectedStopCode={selectedStop?.bus_stop_code}
          onSelectStop={handleSelectStop}
          onRecenter={onRefreshLocation}
        />
      </div>

      {/* Nearby Bus Stops Horizontal Scroller */}
      <div className="space-y-1.5 px-1">
        <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1">
          <span className="flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-brand-sky" />
            Nearby Stops ({stops.length})
          </span>
          {loadingStops && <span className="text-[10px] text-brand-sky animate-pulse">Updating...</span>}
        </div>

        <div className="flex space-x-2 overflow-x-auto pb-1 scrollbar-none">
          {stops.map((stop) => {
            const isSelected = stop.bus_stop_code === selectedStop?.bus_stop_code;
            return (
              <button
                key={stop.bus_stop_code}
                onClick={() => handleSelectStop(stop)}
                className={`flex-shrink-0 w-44 text-left p-2.5 rounded-xl border transition-all ${
                  isSelected
                    ? 'bg-brand-blue/20 border-brand-sky text-white shadow-lg'
                    : 'bg-brand-dark/90 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-[11px] font-bold text-brand-sky">
                    {stop.bus_stop_code}
                  </span>
                  {stop.distance !== undefined && (
                    <span className="text-[10px] text-slate-400 font-medium">
                      {Math.round(stop.distance)}m
                    </span>
                  )}
                </div>
                <p className="text-xs font-bold truncate">{stop.description}</p>
                <p className="text-[10px] text-slate-400 truncate">{stop.road_name}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Bus Stop Detail & Live Arrivals */}
      {selectedStop ? (
        <div className="bg-brand-dark/95 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
          {/* Stop Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center space-x-2">
                <span className="bg-brand-sky/20 border border-brand-sky/40 text-brand-sky font-mono font-black text-xs px-2 py-0.5 rounded-md">
                  {selectedStop.bus_stop_code}
                </span>
                <h3 className="text-base font-black text-white">{selectedStop.description}</h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{selectedStop.road_name}</p>
            </div>

            {/* Quick Actions Header */}
            <div className="flex items-center space-x-1.5">
              {/* Alighting Alarm Trigger */}
              <button
                onClick={() => onArmAlightAlarm(selectedStop)}
                className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-brand-sky/15 border border-brand-sky/40 text-brand-sky hover:bg-brand-sky/25 active:scale-95 transition-all text-xs font-bold"
                title="Arm Alighting Wake-up Alarm for this stop"
              >
                <Bell className="w-3.5 h-3.5" />
                <span>Alight Alert</span>
              </button>

              {/* Service Filter */}
              <button
                onClick={() => setFilterModalOpen(true)}
                className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-brand-sky text-slate-300 active:scale-95 transition-all"
                title="Filter bus services"
              >
                <Filter className="w-4 h-4" />
              </button>

              {/* Toggle Favorite */}
              <button
                onClick={handleToggleFavorite}
                className={`p-2 rounded-xl border active:scale-95 transition-all ${
                  isFav
                    ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
                title="Save stop to Favorites"
              >
                <Star className={`w-4 h-4 ${isFav ? 'fill-amber-400' : ''}`} />
              </button>

              {/* Refresh Arrivals */}
              <button
                onClick={handleRefreshArrivals}
                disabled={loadingArrivals}
                className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-brand-sky text-brand-sky active:scale-95 transition-all"
                title="Refresh arrivals"
              >
                <RefreshCw className={`w-4 h-4 ${loadingArrivals ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Bus Arrivals List */}
          <div className="space-y-2.5 pt-1">
            {loadingArrivals ? (
              <div className="py-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center space-y-2">
                <RefreshCw className="w-5 h-5 animate-spin text-brand-sky" />
                <span>Fetching live bus arrivals...</span>
              </div>
            ) : visibleServices.length > 0 ? (
              visibleServices.map((svc) => (
                <BusArrivalCard
                  key={svc.serviceNo}
                  service={svc}
                  busStopCode={selectedStop.bus_stop_code}
                  busStopName={selectedStop.description}
                  onSetAlarm={(serviceNo) =>
                    setAlarmModalData({ isOpen: true, serviceNo })
                  }
                  onViewRoute={onViewRoute}
                />
              ))
            ) : (
              <div className="py-6 text-center text-slate-500 text-xs">
                No active bus services operating right now or all services filtered.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="py-12 text-center text-slate-500 text-xs">
          Select a nearby bus stop to view live countdowns.
        </div>
      )}

      {/* Filter Modal */}
      {selectedStop && (
        <BusFilterModal
          isOpen={filterModalOpen}
          busStopCode={selectedStop.bus_stop_code}
          busStopName={selectedStop.description}
          availableServices={availableServices}
          hiddenServices={hiddenServices}
          onToggleService={(svc) => {
            setHiddenServices((prev) =>
              prev.includes(svc) ? prev.filter((s) => s !== svc) : [...prev, svc]
            );
          }}
          onSelectAll={() => setHiddenServices([])}
          onClearAll={() => setHiddenServices(availableServices)}
          onClose={() => setFilterModalOpen(false)}
        />
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
