import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { BusStop } from '../types/transit';
import { Navigation } from 'lucide-react';

interface LeafletMapProps {
  userLat: number | null;
  userLon: number | null;
  stops: BusStop[];
  selectedStopCode?: string;
  onSelectStop: (stop: BusStop) => void;
  onRecenter: () => void;
}

export const LeafletMap: React.FC<LeafletMapProps> = ({
  userLat,
  userLon,
  stops,
  selectedStopCode,
  onSelectStop,
  onRecenter,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const hasAutoCenteredRef = useRef(false);

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const initialLat = userLat || 1.3521;
      const initialLon = userLon || 103.8198;

      const map = L.map(mapContainerRef.current, {
        center: [initialLat, initialLon],
        zoom: 16,
        zoomControl: false,
        attributionControl: false,
      });

      // Dark style OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        className: 'dark-tiles',
      }).addTo(map);

      // Add compact zoom control in top-right
      L.control.zoom({ position: 'topright' }).addTo(map);

      const markersGroup = L.layerGroup().addTo(map);
      markersLayerRef.current = markersGroup;
      mapInstanceRef.current = map;

      // Ensure proper tile rendering dimensions on mobile PWA mount
      setTimeout(() => {
        try {
          map.invalidateSize();
        } catch {
          // safe fail
        }
      }, 250);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update commuter GPS location marker and auto-jump to current location
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || userLat === null || userLon === null) return;

    // Auto-jump to current location on first GPS fix!
    if (!hasAutoCenteredRef.current && userLat > 1.0 && userLon > 100.0) {
      map.setView([userLat, userLon], 16, { animate: true });
      hasAutoCenteredRef.current = true;
    }

    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng([userLat, userLon]);
    } else {
      userMarkerRef.current = L.circleMarker([userLat, userLon], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: '#38bdf8',
        fillOpacity: 1,
      }).addTo(map);

      // Accuracy halo
      L.circle([userLat, userLon], {
        radius: 40,
        color: '#38bdf8',
        weight: 1,
        fillColor: '#38bdf8',
        fillOpacity: 0.15,
      }).addTo(map);
    }
  }, [userLat, userLon]);

  // Update bus stop pins
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    stops.forEach((stop) => {
      const isSelected = stop.bus_stop_code === selectedStopCode;

      // Custom HTML bus stop icon
      const customIcon = L.divIcon({
        className: 'custom-bus-pin',
        html: `
          <div style="
            width: ${isSelected ? '28px' : '22px'};
            height: ${isSelected ? '28px' : '22px'};
            background: ${isSelected ? '#38bdf8' : '#1e293b'};
            border: 2px solid ${isSelected ? '#ffffff' : '#38bdf8'};
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: ${isSelected ? '#0b132b' : '#38bdf8'};
            font-size: ${isSelected ? '12px' : '10px'};
            font-weight: 900;
            box-shadow: 0 4px 10px rgba(0,0,0,0.5);
            transition: all 0.2s ease;
          ">
            🚏
          </div>
        `,
        iconSize: [isSelected ? 28 : 22, isSelected ? 28 : 22],
        iconAnchor: [isSelected ? 14 : 11, isSelected ? 14 : 11],
      });

      const marker = L.marker([stop.latitude, stop.longitude], { icon: customIcon });

      marker.on('click', () => {
        onSelectStop(stop);
      });

      marker.bindPopup(`
        <div style="font-family: inherit; padding: 2px;">
          <div style="font-weight: 800; font-size: 13px; color: #f8fafc; margin-bottom: 2px;">
            ${stop.description}
          </div>
          <div style="font-size: 11px; color: #94a3b8; margin-bottom: 4px;">
            ${stop.road_name} • <span style="color: #38bdf8; font-weight: 700;">${stop.bus_stop_code}</span>
          </div>
          ${stop.distance ? `<div style="font-size: 10px; color: #38bdf8; font-weight: 600;">${Math.round(stop.distance)}m away</div>` : ''}
        </div>
      `);

      layer.addLayer(marker);
    });
  }, [stops, selectedStopCode, onSelectStop]);

  const handleRecenterClick = () => {
    if (mapInstanceRef.current && userLat !== null && userLon !== null) {
      mapInstanceRef.current.setView([userLat, userLon], 16, { animate: true });
    }
    onRecenter();
  };

  return (
    <div className="relative w-full h-full min-h-[220px] rounded-2xl overflow-hidden shadow-inner border border-slate-800">
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Recenter GPS Floating Button */}
      <button
        onClick={handleRecenterClick}
        className="absolute bottom-3 right-3 z-[1000] p-2.5 rounded-xl bg-brand-dark/90 border border-slate-700 text-brand-sky shadow-xl hover:bg-slate-800 active:scale-95 transition-all"
        title="Recenter to my location"
      >
        <Navigation className="w-4 h-4" />
      </button>
    </div>
  );
};
