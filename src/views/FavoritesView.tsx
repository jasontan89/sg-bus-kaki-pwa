import React, { useState, useEffect } from 'react';
import { FavoriteStop, BusArrivalData, BusStop } from '../types/transit';
import { getFavorites, removeFavorite, saveFavorite } from '../services/offlineStorage';
import { fetchBusArrivals } from '../services/api';
import { BusArrivalCard } from '../components/BusArrivalCard';
import { SetArrivalAlarmModal } from '../components/SetArrivalAlarmModal';
import { BusFilterModal } from '../components/BusFilterModal';
import { StreetViewButton } from '../components/StreetViewButton';
import { Star, RefreshCw, Trash2, Edit2, Check, ChevronDown, ChevronUp, Bell, Filter } from 'lucide-react';

interface FavoritesViewProps {
  onArmAlightAlarm: (stop: BusStop) => void;
  onViewRoute?: (serviceNo: string) => void;
  onShowToast: (text: string, type?: 'success' | 'error' | 'info') => void;
  onFavoritesChanged?: () => void;
}

export const FavoritesView: React.FC<FavoritesViewProps> = ({
  onArmAlightAlarm,
  onViewRoute,
  onShowToast,
  onFavoritesChanged,
}) => {
  const [favorites, setFavorites] = useState<FavoriteStop[]>([]);
  const [arrivalsMap, setArrivalsMap] = useState<Record<string, BusArrivalData>>({});
  const [expandedStop, setExpandedStop] = useState<string | null>(null);
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');
  const [alarmModalData, setAlarmModalData] = useState<{
    isOpen: boolean;
    stopCode: string;
    stopName: string;
    serviceNo: string;
  }>({ isOpen: false, stopCode: '', stopName: '', serviceNo: '' });

  const [filterModalData, setFilterModalData] = useState<{
    isOpen: boolean;
    fav: FavoriteStop | null;
    availableServices: string[];
    hiddenServices: string[];
  }>({ isOpen: false, fav: null, availableServices: [], hiddenServices: [] });

  const handleOpenFilter = (fav: FavoriteStop) => {
    const arrivals = arrivalsMap[fav.bus_stop_code];
    const availableServices = (arrivals?.services || []).map((s) => s.serviceNo);
    setFilterModalData({
      isOpen: true,
      fav,
      availableServices,
      hiddenServices: fav.hidden_services || [],
    });
  };

  const handleUpdateHiddenServices = async (newHidden: string[]) => {
    if (!filterModalData.fav) return;
    const updatedFav: FavoriteStop = {
      ...filterModalData.fav,
      hidden_services: newHidden,
    };
    await saveFavorite(updatedFav);
    setFilterModalData((prev) => ({ ...prev, fav: updatedFav, hiddenServices: newHidden }));
    setFavorites((prev) =>
      prev.map((f) => (f.bus_stop_code === updatedFav.bus_stop_code ? updatedFav : f))
    );
    if (onFavoritesChanged) onFavoritesChanged();
    onShowToast(`Saved bus filters for ${updatedFav.description}`, 'info');
  };

  const loadFavs = async () => {
    const list = await getFavorites();
    setFavorites(list);
    if (list.length > 0 && !expandedStop) {
      setExpandedStop(list[0].bus_stop_code);
      fetchStopArrivals(list[0].bus_stop_code);
    }
  };

  useEffect(() => {
    loadFavs();
  }, []);

  const fetchStopArrivals = async (code: string) => {
    setLoadingMap((prev) => ({ ...prev, [code]: true }));
    try {
      const data = await fetchBusArrivals(code);
      setArrivalsMap((prev) => ({ ...prev, [code]: data }));
    } catch {
      // safe fail
    } finally {
      setLoadingMap((prev) => ({ ...prev, [code]: false }));
    }
  };

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    try {
      await Promise.all(favorites.map((f) => fetchStopArrivals(f.bus_stop_code)));
      onShowToast('All favorite stops refreshed! ✨', 'success');
    } catch {
      onShowToast('Failed to refresh some stops', 'error');
    } finally {
      setRefreshingAll(false);
    }
  };

  const handleRemove = async (code: string) => {
    await removeFavorite(code);
    await loadFavs();
    if (onFavoritesChanged) onFavoritesChanged();
    onShowToast(`Removed ${code} from Favorites`, 'info');
  };

  const handleSaveNickname = async (fav: FavoriteStop) => {
    const updated = { ...fav, custom_name: tempName.trim() };
    await saveFavorite(updated);
    setEditingCode(null);
    await loadFavs();
    onShowToast('Custom nickname saved', 'success');
  };

  return (
    <div className="space-y-3 pb-24">
      {/* Header bar */}
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className="text-base font-black text-white flex items-center gap-1.5">
            <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
            Favorite Bus Stops
          </h2>
          <p className="text-xs text-slate-400">Pinned stops with instant updates</p>
        </div>

        {favorites.length > 0 && (
          <button
            onClick={handleRefreshAll}
            disabled={refreshingAll}
            className="flex items-center space-x-1.5 bg-brand-blue/20 hover:bg-brand-blue/30 border border-brand-sky/40 text-brand-sky px-3 py-1.5 rounded-xl text-xs font-bold active:scale-95 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshingAll ? 'animate-spin' : ''}`} />
            <span>Refresh All</span>
          </button>
        )}
      </div>

      {favorites.length === 0 ? (
        <div className="bg-brand-dark/60 border border-slate-800/80 rounded-2xl p-8 text-center space-y-3 my-8">
          <div className="w-14 h-14 rounded-full bg-slate-800 text-amber-400 flex items-center justify-center mx-auto shadow-inner">
            <Star className="w-7 h-7" />
          </div>
          <h3 className="text-sm font-bold text-white">No Pinned Stops Yet</h3>
          <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
            Star your daily bus stops in the Nearby or Search tabs to pin them here for 1-tap live arrival lookups.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {favorites.map((fav) => {
            const isExpanded = expandedStop === fav.bus_stop_code;
            const arrivals = arrivalsMap[fav.bus_stop_code];
            const isLoading = loadingMap[fav.bus_stop_code];
            const visibleServices = (arrivals?.services || []).filter(
              (s) => !(fav.hidden_services || []).includes(s.serviceNo)
            );

            return (
              <div
                key={fav.bus_stop_code}
                className="bg-brand-dark/95 border border-slate-800 rounded-2xl overflow-hidden shadow-xl"
              >
                {/* Stop Card Bar */}
                <div
                  className="p-3.5 flex items-center justify-between cursor-pointer hover:bg-slate-800/40 transition-colors"
                  onClick={() => {
                    const next = isExpanded ? null : fav.bus_stop_code;
                    setExpandedStop(next);
                    if (next && !arrivals) {
                      fetchStopArrivals(fav.bus_stop_code);
                    }
                  }}
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-xs font-bold text-brand-sky bg-brand-sky/10 border border-brand-sky/30 px-1.5 py-0.5 rounded">
                        {fav.bus_stop_code}
                      </span>
                      {editingCode === fav.bus_stop_code ? (
                        <div
                          className="flex items-center space-x-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            value={tempName}
                            onChange={(e) => setTempName(e.target.value)}
                            placeholder="Custom nickname..."
                            className="bg-slate-900 border border-brand-sky text-xs text-white px-2 py-0.5 rounded outline-none"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveNickname(fav)}
                            className="p-1 bg-brand-sky text-brand-navy rounded hover:brightness-110"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <h4 className="text-sm font-bold text-white truncate">
                          {fav.custom_name || fav.description}
                        </h4>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                      {fav.custom_name ? `${fav.description} • ` : ''}
                      {fav.road_name}
                    </p>
                  </div>

                  {/* Actions & Chevron */}
                  <div
                    className="flex items-center space-x-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Street View */}
                    <StreetViewButton
                      latitude={fav.latitude}
                      longitude={fav.longitude}
                      stopName={fav.description}
                      variant="icon"
                      className="p-1.5"
                    />

                    {/* Service Filter */}
                    <button
                      onClick={() => handleOpenFilter(fav)}
                      className={`p-1.5 rounded-lg border transition-all relative ${
                        (fav.hidden_services || []).length > 0
                          ? 'bg-brand-sky/20 border-brand-sky text-brand-sky'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800 border-slate-800'
                      }`}
                      title="Filter bus services at this stop"
                    >
                      <Filter className="w-3.5 h-3.5" />
                      {(fav.hidden_services || []).length > 0 && (
                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-brand-sky rounded-full" />
                      )}
                    </button>

                    {/* Alight Alert */}
                    <button
                      onClick={() => {
                        onArmAlightAlarm({
                          bus_stop_code: fav.bus_stop_code,
                          description: fav.description,
                          road_name: fav.road_name,
                          latitude: fav.latitude,
                          longitude: fav.longitude,
                        });
                      }}
                      className="flex items-center space-x-1 px-2 py-1 rounded-lg bg-brand-sky/15 border border-brand-sky/30 text-brand-sky hover:bg-brand-sky/25 text-[11px] font-bold active:scale-95 transition-all"
                      title="Arm Alight Alert for this stop"
                    >
                      <Bell className="w-3.5 h-3.5" />
                      <span>Alight</span>
                    </button>

                    {/* Edit Nickname */}
                    <button
                      onClick={() => {
                        setEditingCode(fav.bus_stop_code);
                        setTempName(fav.custom_name || fav.description);
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800"
                      title="Edit stop nickname"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    {/* Remove */}
                    <button
                      onClick={() => handleRemove(fav.bus_stop_code)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 border border-slate-800"
                      title="Remove from favorites"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    {/* Expand/Collapse */}
                    <button
                      onClick={() => {
                        const next = isExpanded ? null : fav.bus_stop_code;
                        setExpandedStop(next);
                        if (next && !arrivals) fetchStopArrivals(fav.bus_stop_code);
                      }}
                      className="p-1 text-slate-400"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Expanded Arrivals View */}
                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-slate-800/80 space-y-2">
                    {/* Active Filter indicator */}
                    {(fav.hidden_services || []).length > 0 && (
                      <div className="flex items-center justify-between bg-brand-sky/10 border border-brand-sky/30 px-2.5 py-1 rounded-lg text-[10px] text-brand-sky">
                        <span>Showing {visibleServices.length} of {arrivals?.services?.length || 0} buses</span>
                        <button
                          onClick={() => handleUpdateHiddenServices([])}
                          className="font-bold underline hover:text-white"
                        >
                          Show All
                        </button>
                      </div>
                    )}

                    {/* Seat Availability Legend */}
                    <div className="flex items-center justify-between text-[10px] text-slate-400 px-0.5 pt-0.5">
                      <span className="font-semibold text-slate-500 uppercase tracking-wider text-[9px]">Live Arrivals</span>
                      <div className="flex items-center space-x-2 text-[10px]">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Seats</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />Standing</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />Limited</span>
                      </div>
                    </div>

                    {isLoading ? (
                      <div className="py-4 text-center text-xs text-slate-400 flex items-center justify-center space-x-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-brand-sky" />
                        <span>Loading arrivals...</span>
                      </div>
                    ) : visibleServices.length > 0 ? (
                      visibleServices.map((svc) => (
                        <BusArrivalCard
                          key={svc.serviceNo}
                          service={svc}
                          busStopCode={fav.bus_stop_code}
                          busStopName={fav.description}
                          onSetAlarm={(serviceNo) =>
                            setAlarmModalData({
                              isOpen: true,
                              stopCode: fav.bus_stop_code,
                              stopName: fav.description,
                              serviceNo,
                            })
                          }
                          onViewRoute={onViewRoute}
                        />
                      ))
                    ) : (
                      <div className="py-4 text-center text-xs text-slate-500">
                        No active bus services or failed to reach live feed.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Set Arrival Alarm Modal */}
      <SetArrivalAlarmModal
        isOpen={alarmModalData.isOpen}
        busStopCode={alarmModalData.stopCode}
        busStopName={alarmModalData.stopName}
        serviceNo={alarmModalData.serviceNo}
        onClose={() =>
          setAlarmModalData({ isOpen: false, stopCode: '', stopName: '', serviceNo: '' })
        }
        onSuccess={(msg) => onShowToast(msg, 'success')}
        onError={(err) => onShowToast(err, 'error')}
      />

      {/* Bus Service Filter Modal for Favorites */}
      {filterModalData.isOpen && filterModalData.fav && (
        <BusFilterModal
          isOpen={filterModalData.isOpen}
          busStopCode={filterModalData.fav.bus_stop_code}
          busStopName={filterModalData.fav.custom_name || filterModalData.fav.description}
          availableServices={filterModalData.availableServices}
          hiddenServices={filterModalData.hiddenServices}
          onToggleService={(svc) => {
            const next = filterModalData.hiddenServices.includes(svc)
              ? filterModalData.hiddenServices.filter((s) => s !== svc)
              : [...filterModalData.hiddenServices, svc];
            handleUpdateHiddenServices(next);
          }}
          onSelectAll={() => handleUpdateHiddenServices([])}
          onClearAll={() => handleUpdateHiddenServices(filterModalData.availableServices)}
          onClose={() => setFilterModalData((prev) => ({ ...prev, isOpen: false }))}
        />
      )}
    </div>
  );
};
