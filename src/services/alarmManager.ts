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
 * Unlock Web Audio on user gesture (e.g. tapping "Alight Alert" or "Test Chime")
 * Mobile Chrome requires AudioContext to be resumed during a direct user touch gesture.
 */
export function unlockAudio() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    // Play inaudible silent buffer to register user activation with the browser
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
    unlockAudio();
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Master volume gain node
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.7, now);
    masterGain.connect(ctx.destination);

    // Sequence of melodic chime notes
    const notes = [
      { freq: 523.25, start: 0.00, duration: 0.55, gain: 0.28 }, // C5
      { freq: 659.25, start: 0.25, duration: 0.55, gain: 0.26 }, // E5
      { freq: 783.99, start: 0.50, duration: 0.65, gain: 0.24 }, // G5
      { freq: 987.77, start: 0.75, duration: 0.75, gain: 0.22 }, // B5
      { freq: 1046.50, start: 1.05, duration: 1.50, gain: 0.25 }, // C6
      // Harmonizing chord notes ringing out gently
      { freq: 659.25, start: 1.25, duration: 2.20, gain: 0.15 }, // E5 sustain
      { freq: 783.99, start: 1.25, duration: 2.20, gain: 0.14 }, // G5 sustain
      { freq: 1046.50, start: 1.25, duration: 2.40, gain: 0.16 }, // C6 sustain
    ];

    notes.forEach(({ freq, start, duration, gain: targetGain }) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      // Pure sine wave for smooth, soothing bell tone
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + start);

      // Envelope: Soft fast attack, smooth exponential decay
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
      navigator.vibrate([300, 150, 300, 150, 600]);
    }
  } catch (err) {
    console.warn('Audio chime playback error:', err);
  }
}

/**
 * Starts continuous repeating prolonged chime (every 4.5 seconds)
 */
export function startContinuousChime() {
  stopContinuousChime();
  stopBackgroundAudioKeepAlive();
  playGentleTransitChime();
  chimeIntervalId = setInterval(() => {
    playGentleTransitChime();
  }, 4500);
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
 * Background Audio Keep-Alive Service:
 * On Android Chrome and iOS Safari, the browser aggressively freezes JS execution and shuts down
 * `navigator.geolocation.watchPosition` within seconds after the screen locks or user switches apps.
 * Playing an active HTML5 audio stream with MediaSession metadata registers the app as an active
 * foreground media service with the OS power manager, keeping the JS thread & GPS tracking alive.
 */
let backgroundAudio: HTMLAudioElement | null = null;

export function startBackgroundAudioKeepAlive(stopName: string) {
  try {
    if (!backgroundAudio) {
      backgroundAudio = new Audio('/silence.wav');
      backgroundAudio.loop = true;
      backgroundAudio.volume = 0.01;
    }

    backgroundAudio.play().catch((err) => {
      console.warn('Background audio autoplay notice:', err);
    });

    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `Alighting Alert Active 🚌`,
        artist: `Destination: ${stopName}`,
        album: 'SG Bus Kaki Real-Time GPS Shield',
        artwork: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      });

      navigator.mediaSession.setActionHandler('play', () => {
        backgroundAudio?.play().catch(() => {});
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        // Allow user to pause from lock screen if desired
      });
    }
  } catch (err) {
    console.warn('Could not initialize background audio keep-alive:', err);
  }
}

export function stopBackgroundAudioKeepAlive() {
  if (backgroundAudio) {
    try {
      backgroundAudio.pause();
      backgroundAudio.src = '';
    } catch {
      // Safe fail
    }
    backgroundAudio = null;
  }

  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    try {
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
