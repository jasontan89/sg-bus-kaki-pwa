import React, { useState, useRef, useEffect } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Maximize2, Minimize2, Activity, Users } from 'lucide-react';
import { MRTLineInfo } from '../types/transit';
import { fetchTrainAlerts } from '../services/api';

const MRT_LINES: MRTLineInfo[] = [
  { code: 'NSL', name: 'North-South Line', color: '#d32f2f', bgClass: 'bg-red-500', textClass: 'text-red-400', status: 'Normal', crowdLevel: 'Moderate' },
  { code: 'EWL', name: 'East-West Line', color: '#2e7d32', bgClass: 'bg-emerald-600', textClass: 'text-emerald-400', status: 'Normal', crowdLevel: 'Low' },
  { code: 'CCL', name: 'Circle Line', color: '#f57c00', bgClass: 'bg-amber-500', textClass: 'text-amber-400', status: 'Normal', crowdLevel: 'Low' },
  { code: 'DTL', name: 'Downtown Line', color: '#1976d2', bgClass: 'bg-blue-600', textClass: 'text-blue-400', status: 'Normal', crowdLevel: 'Low' },
  { code: 'NEL', name: 'North-East Line', color: '#7b1fa2', bgClass: 'bg-purple-600', textClass: 'text-purple-400', status: 'Normal', crowdLevel: 'Moderate' },
  { code: 'TEL', name: 'Thomson-East Coast Line', color: '#8d6e63', bgClass: 'bg-amber-800', textClass: 'text-amber-300', status: 'Normal', crowdLevel: 'Low' },
];

export const MrtMapView: React.FC = () => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lines, setLines] = useState<MRTLineInfo[]>(MRT_LINES);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startPanRef = useRef({ x: 0, y: 0 });
  const initialPinchDistRef = useRef<number | null>(null);
  const initialScaleRef = useRef(1);

  // Check live MRT service status from backend
  useEffect(() => {
    const checkAlerts = async () => {
      try {
        const alert = await fetchTrainAlerts();
        if (alert && alert.status === 2 && alert.affected) {
          setLines((prev) =>
            prev.map((line) => {
              if (alert.affected?.some((a) => a.includes(line.code))) {
                return { ...line, status: 'Disrupted', details: alert.message };
              }
              return line;
            })
          );
        }
      } catch {
        // Safe fail
      }
    };
    checkAlerts();
  }, []);

  // Multi-Touch Pinch-to-Zoom & Touch Pan Handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // 2 fingers = Pinch
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const dist = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
      initialPinchDistRef.current = dist;
      initialScaleRef.current = scale;
    } else if (e.touches.length === 1) {
      // 1 finger = Pan
      isDraggingRef.current = true;
      startPanRef.current = {
        x: e.touches[0].clientX - position.x,
        y: e.touches[0].clientY - position.y,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialPinchDistRef.current !== null) {
      // Pinching
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const currentDist = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
      const factor = currentDist / initialPinchDistRef.current;
      const newScale = Math.min(4.5, Math.max(0.6, initialScaleRef.current * factor));
      setScale(newScale);
    } else if (e.touches.length === 1 && isDraggingRef.current) {
      // Panning
      setPosition({
        x: e.touches[0].clientX - startPanRef.current.x,
        y: e.touches[0].clientY - startPanRef.current.y,
      });
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      initialPinchDistRef.current = null;
    }
    if (e.touches.length === 0) {
      isDraggingRef.current = false;
    }
  };

  // Mouse drag & wheel zoom handlers (desktop pair-testing)
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    startPanRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    setPosition({
      x: e.clientX - startPanRef.current.x,
      y: e.clientY - startPanRef.current.y,
    });
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setScale((prev) => Math.min(4.5, Math.max(0.6, prev + delta)));
  };

  const handleZoomIn = () => setScale((s) => Math.min(4.5, s + 0.3));
  const handleZoomOut = () => setScale((s) => Math.max(0.6, s - 0.3));
  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  return (
    <div className={`space-y-3 pb-24 ${isFullscreen ? 'fixed inset-0 z-[9995] bg-black p-2 pb-6' : ''}`}>
      {/* View Header */}
      {!isFullscreen && (
        <div className="flex items-center justify-between px-1">
          <div>
            <h2 className="text-base font-black text-white flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-brand-sky" />
              Singapore MRT & LRT Network
            </h2>
            <p className="text-xs text-slate-400">Pinch fingers to zoom • Works 100% offline</p>
          </div>
        </div>
      )}

      {/* MRT Lines Status Carousel */}
      {!isFullscreen && (
        <div className="flex space-x-2 overflow-x-auto pb-1 scrollbar-none">
          {lines.map((l) => (
            <button
              key={l.code}
              onClick={() => setSelectedLine(selectedLine === l.code ? null : l.code)}
              className={`flex-shrink-0 px-3 py-2 rounded-xl border text-left transition-all ${
                selectedLine === l.code
                  ? 'bg-slate-800 border-white text-white shadow-md'
                  : 'bg-brand-dark/90 border-slate-800 text-slate-300'
              }`}
            >
              <div className="flex items-center space-x-2 mb-0.5">
                <span className={`w-2.5 h-2.5 rounded-full ${l.bgClass}`} />
                <span className="font-bold text-xs">{l.code}</span>
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.2 rounded ${
                  l.status === 'Normal' ? 'text-emerald-400 bg-emerald-950/60' : 'text-rose-400 bg-rose-950/60 animate-pulse'
                }`}>
                  {l.status}
                </span>
              </div>
              <div className="flex items-center space-x-1 text-[10px] text-slate-400">
                <Users className="w-3 h-3" />
                <span>Crowd: {l.crowdLevel}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Interactive Pinch-to-Zoom Vector Map Container */}
      <div
        ref={containerRef}
        className={`relative w-full overflow-hidden rounded-2xl border border-slate-800 bg-[#090d16] select-none touch-none ${
          isFullscreen ? 'h-[92vh]' : 'h-[62vh]'
        }`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {/* Floating Zoom & Pan Controls */}
        <div className="absolute top-3 right-3 z-20 flex flex-col space-y-1.5">
          <button
            onClick={handleZoomIn}
            className="p-2.5 rounded-xl bg-brand-dark/90 border border-slate-700 text-white hover:bg-slate-800 active:scale-95 shadow-xl transition-all"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-2.5 rounded-xl bg-brand-dark/90 border border-slate-700 text-white hover:bg-slate-800 active:scale-95 shadow-xl transition-all"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={handleReset}
            className="p-2.5 rounded-xl bg-brand-dark/90 border border-slate-700 text-brand-sky hover:bg-slate-800 active:scale-95 shadow-xl transition-all"
            title="Reset Zoom"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2.5 rounded-xl bg-brand-dark/90 border border-slate-700 text-slate-300 hover:bg-slate-800 active:scale-95 shadow-xl transition-all"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Map'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>

        {/* Pinch gesture helper pill */}
        <div className="absolute bottom-3 left-3 z-20 px-2.5 py-1 rounded-lg bg-slate-900/80 backdrop-blur-md border border-slate-800 text-[10px] font-mono text-slate-400">
          Scale: {(scale * 100).toFixed(0)}% • Pinch with 2 fingers to zoom
        </div>

        {/* SVG Vector MRT Map Canvas */}
        <div
          className="w-full h-full flex items-center justify-center transition-transform duration-75 ease-out origin-center"
          style={{
            transform: `translate3d(${position.x}px, ${position.y}px, 0px) scale(${scale})`,
            cursor: isDraggingRef.current ? 'grabbing' : 'grab',
          }}
        >
          <img
            src="/mrt_map.svg"
            alt="Singapore MRT Network Map"
            className="max-w-none w-[900px] sm:w-[1100px] h-auto pointer-events-none filter drop-shadow-2xl"
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
};
