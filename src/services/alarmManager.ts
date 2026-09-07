/**
 * SG Bus Kaki - Alighting Alarm & Commuter Presence Manager
 * 
 * Features:
 * 1. Gentle, calming multi-tone harmonic chime (sine-wave melodic chord inspired by Japanese transit chimes).
 * 2. Non-blocking Screen Wake Lock with explicit commuter toggle and auto-release on screen lock.
 * 3. High-precision Haversine proximity computation.
 * 4. Gentle tactile haptic pulses.
 */

// Global AudioContext & repeating chime timer
let audioCtx: AudioContext | null = null;
let chimeIntervalId: any = null;
let wakeLockSentinel: any = null;
let isWakeLockRequested = false;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Plays a calm, gentle, and pleasant 3-tone harmonic chime (C5 -> E5 -> G5)
 * Waveform: Pure Sine wave with smooth envelope curve (soft attack, graceful decay).
 */
export function playGentleTransitChime() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Chime Notes: C5 (523.25Hz), E5 (659.25Hz), G5 (783.99Hz)
    const notes = [
      { freq: 523.25, start: 0, duration: 0.35, gain: 0.28 },
      { freq: 659.25, start: 0.16, duration: 0.4, gain: 0.25 },
      { freq: 783.99, start: 0.32, duration: 0.65, gain: 0.22 },
    ];

    notes.forEach(({ freq, start, duration, gain: targetGain }) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = 'sine'; // Pure, melodic and non-abrasive
      osc.frequency.setValueAtTime(freq, now + start);

      // Envelope: Fast soft attack, smooth exponential decay
      gainNode.gain.setValueAtTime(0.001, now + start);
      gainNode.gain.linearRampToValueAtTime(targetGain, now + start + 0.04);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + start + duration);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now + start);
      osc.stop(now + start + duration);
    });

    // Gentle tactile haptic pulse (if supported)
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([180, 80, 180]);
    }
  } catch (err) {
    console.warn('Audio chime playback error:', err);
  }
}

/**
 * Starts continuous repeating gentle chime (every 2.8 seconds)
 */
export function startContinuousChime() {
  stopContinuousChime();
  playGentleTransitChime();
  chimeIntervalId = setInterval(() => {
    playGentleTransitChime();
  }, 2800);
}

/**
 * Stops continuous repeating chime
 */
export function stopContinuousChime() {
  if (chimeIntervalId) {
    clearInterval(chimeIntervalId);
    chimeIntervalId = null;
  }
}

/**
 * Requests W3C Screen Wake Lock to keep display active while reading/dozing in the HUD.
 * NOTE: The commuter is 100% free to lock their phone screen (power button) or switch apps!
 * When locked or backgrounded, the OS releases the lock cleanly.
 */
export async function requestScreenWakeLock(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
    return false;
  }
  try {
    isWakeLockRequested = true;
    wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
    });
    return true;
  } catch (err) {
    console.log('Screen Wake Lock not acquired (possibly battery saver or unsupported):', err);
    return false;
  }
}

/**
 * Releases Screen Wake Lock
 */
export async function releaseScreenWakeLock() {
  isWakeLockRequested = false;
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch {
      // Ignore release error
    }
    wakeLockSentinel = null;
  }
}

/**
 * Re-acquire wake lock on visibility restore if user has enabled it
 */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && isWakeLockRequested && !wakeLockSentinel) {
      try {
        if ('wakeLock' in navigator) {
          wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        }
      } catch {
        // Safe fail
      }
    }
  });
}

/**
 * Haversine formula to compute great-circle distance between two GPS coordinates in meters.
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Formats distance in meters to friendly display string (e.g. "450 m" or "2.3 km")
 */
export function formatDistance(meters: number | null): string {
  if (meters === null || isNaN(meters)) return '--';
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}
