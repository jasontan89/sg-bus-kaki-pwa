/**
 * SG Bus Kaki - Alighting Alarm & Commuter Presence Manager
 * 
 * Features:
 * 1. Prolonged, calming multi-tone harmonic chime (warm melodic arpeggio & resolving chord).
 * 2. AudioContext unlocker for mobile Chrome/Android autoplay policies.
 * 3. Non-blocking Screen Wake Lock with explicit commuter toggle and auto-release on screen lock.
 * 4. High-precision Haversine proximity computation with strict numeric parsing.
 * 5. Gentle tactile haptic pulses.
 */

let audioCtx: AudioContext | null = null;
let chimeIntervalId: any = null;
let wakeLockSentinel: any = null;
let isWakeLockRequested = false;

let bgWorker: Worker | null = null;
let bgTickCallbacks: Set<() => void> = new Set();
let lastTickTime = 0;
let webLockReleaseResolver: (() => void) | null = null;

function acquireInvisibleWebLock() {
  if (webLockReleaseResolver) return;
  if (typeof navigator !== 'undefined' && 'locks' in navigator && (navigator as any).locks?.request) {
    try {
      (navigator as any).locks
        .request('sg_bus_kaki_active_alert', () => {
          return new Promise<void>((resolve) => {
            webLockReleaseResolver = resolve;
          });
        })
        .catch(() => {
          webLockReleaseResolver = null;
        });
    } catch {
      // Safe fail
    }
  }
}

function releaseInvisibleWebLock() {
  if (webLockReleaseResolver) {
    try {
      webLockReleaseResolver();
    } catch {
      // Safe fail
    }
    webLockReleaseResolver = null;
  }
}

function emitBackgroundTick() {
  const now = Date.now();
  if (now - lastTickTime < 2000) return;
  lastTickTime = now;
  bgTickCallbacks.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      console.warn('Background tick callback error:', err);
    }
  });
}

function ensureBackgroundWorker() {
  if (bgWorker || typeof Worker === 'undefined') return;
  try {
    const workerCode = `
      let timer = setInterval(() => {
        self.postMessage('tick');
      }, 3000);
      self.onmessage = (e) => {
        if (e.data === 'stop') {
          clearInterval(timer);
          self.close();
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    bgWorker = new Worker(URL.createObjectURL(blob));
    bgWorker.onmessage = () => {
      emitBackgroundTick();
    };
  } catch (err) {
    console.warn('Could not start background Web Worker:', err);
  }
}

function stopBackgroundWorker() {
  if (bgWorker) {
    try {
      bgWorker.postMessage('stop');
      bgWorker.terminate();
    } catch {
      // Safe fail
    }
    bgWorker = null;
  }
}

export function registerBackgroundTickCallback(cb: () => void): () => void {
  bgTickCallbacks.add(cb);
  return () => {
    bgTickCallbacks.delete(cb);
  };
}

export function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Unlock Web Audio Context on user gesture (e.g. tapping "Alight Alert", "Arm Alert", or "Test Chime")
 */
export function unlockAudio() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch (err) {
    console.warn('Audio unlock warning:', err);
  }
}

/**
 * Plays a prolonged, rich, calming, and noticeable 5-tone melodic chime sequence:
 * Ascending melody: C5 (523Hz) -> E5 (659Hz) -> G5 (784Hz) -> B5 (988Hz) -> C6 (1046Hz)
 * Followed by a warm resonant resolving chord (E5 + G5 + C6) with smooth 2.0s exponential decay.
 * Total duration: ~3.8 seconds.
 */
export function playGentleTransitChime() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;

    // Master volume gain node
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.85, now);
    masterGain.connect(ctx.destination);

    // Sequence of melodic chime notes
    const notes = [
      { freq: 523.25, start: 0.00, duration: 0.55, gain: 0.30 }, // C5
      { freq: 659.25, start: 0.25, duration: 0.55, gain: 0.28 }, // E5
      { freq: 783.99, start: 0.50, duration: 0.65, gain: 0.26 }, // G5
      { freq: 987.77, start: 0.75, duration: 0.75, gain: 0.25 }, // B5
      { freq: 1046.50, start: 1.05, duration: 1.50, gain: 0.28 }, // C6
      // Harmonizing chord notes ringing out gently
      { freq: 659.25, start: 1.25, duration: 2.20, gain: 0.16 }, // E5 sustain
      { freq: 783.99, start: 1.25, duration: 2.20, gain: 0.15 }, // G5 sustain
      { freq: 1046.50, start: 1.25, duration: 2.40, gain: 0.18 }, // C6 sustain
    ];

    notes.forEach(({ freq, start, duration, gain: targetGain }) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + start);

      gainNode.gain.setValueAtTime(0.0001, now + start);
      gainNode.gain.linearRampToValueAtTime(targetGain, now + start + 0.04);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);

      osc.connect(gainNode);
      gainNode.connect(masterGain);

      osc.start(now + start);
      osc.stop(now + start + duration);
    });

    // Gentle tactile haptic pulse on Android devices
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([400, 150, 400, 150, 800]);
      } catch {
        // Safe fail
      }
    }
  } catch (err) {
    console.warn('Audio chime playback error:', err);
  }
}

let chimeAutoStopTimer: any = null;

/**
 * Starts continuous repeating prolonged chime via Web Audio API + Haptics
 * (Does NOT create any persistent MediaSession player widget in the Android notification drawer)
 */
export function startContinuousChime(_alertLabel?: string, maxDurationMs?: number) {
  if (chimeIntervalId) {
    clearInterval(chimeIntervalId);
    chimeIntervalId = null;
  }
  if (chimeAutoStopTimer) {
    clearTimeout(chimeAutoStopTimer);
    chimeAutoStopTimer = null;
  }

  playGentleTransitChime();
  chimeIntervalId = setInterval(() => {
    playGentleTransitChime();
  }, 4500);

  if (maxDurationMs && maxDurationMs > 0) {
    chimeAutoStopTimer = setTimeout(() => {
      stopContinuousChime();
    }, maxDurationMs);
  }
}

/**
 * Stops continuous repeating chime
 */
export function stopContinuousChime() {
  if (chimeIntervalId) {
    clearInterval(chimeIntervalId);
    chimeIntervalId = null;
  }
  if (chimeAutoStopTimer) {
    clearTimeout(chimeAutoStopTimer);
    chimeAutoStopTimer = null;
  }
}

/**
 * Invisible Background Presence Service:
 * Uses W3C Web Locks API (navigator.locks) + a dedicated Web Worker timer without playing any
 * HTML5 <audio> track or creating a MediaSession player card ("Transit Alert Active") in the
 * Android notification shade. Cloud Web Push (FCM + Service Worker) handles background notifications.
 */
export function startBackgroundAudioKeepAlive(_stopName?: string) {
  try {
    acquireInvisibleWebLock();
    ensureBackgroundWorker();
    // Ensure any old MediaSession metadata from previous versions is cleared
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
      } catch {
        // Safe fail
      }
    }
  } catch (err) {
    console.warn('Could not initialize background worker keep-alive:', err);
  }
}

export function stopBackgroundAudioKeepAlive() {
  releaseInvisibleWebLock();
  stopBackgroundWorker();

  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
    } catch {
      // Safe fail
    }
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
 * Strictly converts arguments to numbers to prevent string concatenation bugs.
 */
export function calculateHaversineDistanceMeters(
  lat1: any,
  lon1: any,
  lat2: any,
  lon2: any
): number | null {
  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);

  if (
    isNaN(nLat1) || isNaN(nLon1) || isNaN(nLat2) || isNaN(nLon2) ||
    nLat1 === 0 || nLon1 === 0 || nLat2 === 0 || nLon2 === 0
  ) {
    return null;
  }

  const R = 6371000; // Earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(nLat2 - nLat1);
  const dLon = toRad(nLon2 - nLon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(nLat1)) * Math.cos(toRad(nLat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Formats distance in meters to friendly display string (e.g. "450 m" or "2.3 km")
 */
export function formatDistance(meters: number | null): string {
  if (meters === null || isNaN(meters)) return 'Acquiring GPS...';
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}
