import React from 'react';
import { Eye } from 'lucide-react';

interface StreetViewButtonProps {
  latitude: number | string;
  longitude: number | string;
  stopName?: string;
  className?: string;
  variant?: 'button' | 'icon';
}

export const StreetViewButton: React.FC<StreetViewButtonProps> = ({
  latitude,
  longitude,
  stopName = 'Bus Stop',
  className = '',
  variant = 'button',
}) => {
  const lat = Number(latitude);
  const lon = Number(longitude);

  const isValid = !isNaN(lat) && !isNaN(lon) && lat > 1.0 && lon > 100.0;

  if (!isValid) return null;

  const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;

  if (variant === 'icon') {
    return (
      <a
        href={streetViewUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-brand-sky text-slate-300 hover:text-brand-sky active:scale-95 transition-all inline-flex items-center justify-center ${className}`}
        title={`View 360° Street View for ${stopName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <Eye className="w-4 h-4 text-brand-sky" />
      </a>
    );
  }

  return (
    <a
      href={streetViewUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-brand-sky/60 text-slate-300 hover:text-brand-sky text-xs font-semibold active:scale-95 transition-all ${className}`}
      title={`Open 360° Street View for ${stopName}`}
      onClick={(e) => e.stopPropagation()}
    >
      <Eye className="w-3.5 h-3.5 text-brand-sky" />
      <span>Street View</span>
    </a>
  );
};
