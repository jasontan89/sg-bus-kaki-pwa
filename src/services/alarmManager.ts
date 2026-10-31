/**
 * SG Bus Kaki - Alighting Alarm, Earbuds Nap Audio Bridge & Commuter Presence Manager
 *
 * Features:
 * 1. Prolonged, calming multi-tone harmonic chime (warm melodic arpeggio & resolving chord).
 * 2. In-memory 16-bit PCM WAV chime synthesizer + optional "Earbuds Nap Mode" HTML5 <audio>
 *    stream bridge so sleeping headphone commuters hear continuous chime audio with screen locked.
 * 3. AudioContext unlocker for mobile Chrome/Android autoplay policies.
 * 4. Non-blocking Screen Wake Lock with explicit commuter toggle and auto-release on screen lock.
 * 5. High-precision Haversine proximity computation with strict numeric parsing.
 */

let audioCtx: AudioContext | null = null;
let chimeIntervalId: any = null;
let chimeAutoStopTimer: any = null;
let wakeLockSentinel: any = null;
let isWakeLockRequested = false;

let bgWorker: Worker | null = null;
let bgTickCallbacks: Set<() => void> = new Set();
let lastTickTime = 0;
let webLockReleaseResolver: (() => void) | null = null;

// Optional Earbuds Nap Mode HTML5 <audio> bridge
let napAudioEl: HTMLAudioElement | null = null;
let napShieldEnabled = false;
let napAlarmAutoStopTimer: any = null;
let cachedChimeWavUrl: string | null = null;

/**
 * Generates an in-memory 16-bit 22050Hz mono PCM WAV Blob URL containing our 5-tone
 * ascending harmonic transit chime + warm resolving C-major chord (4.4s loopable cycle).
 * Works 100% offline with zero network fetch.
 */
function getChimeWavBlobUrl(): string {
  if (cachedChimeWavUrl) return cachedChimeWavUrl;

  const sampleRate = 22050;
  const durationSec = 4.4;
  const numSamples = Math.floor(sampleRate * durationSec);
  const pcm = new Float32Array(numSamples);

  const notes = [
    { freq: 523.25, start: 0.0, duration: 0.55, amp: 0.28 }, // C5
    { freq: 659.25, start: 0.24, duration: 0.55, amp: 0.26 }, // E5
    { freq: 783.99, start: 0.48, duration: 0.65, amp: 0.25 }, // G5
    { freq: 987.77, start: 0.72, duration: 0.75, amp: 0.24 }, // B5
    { freq: 1046.5, start: 1.0, duration: 1.6, amp: 0.28 }, // C6
    { freq: 659.25, start: 1.18, duration: 2.3, amp: 0.16 }, // E5 chord sustain
    { freq: 783.99, start: 1.18, duration: 2.3, amp: 0.15 }, // G5 chord sustain
    { freq: 1046.5, start: 1.18, duration: 2.5, amp: 0.18 }, // C6 chord sustain
  ];

  for (const note of notes) {
    const startIdx = Math.floor(note.start * sampleRate);
    const totalNoteSamples = Math.floor(note.duration * sampleRate);
    const attackSamples = Math.max(1, Math.floor(0.035 * sampleRate));
    const endIdx = Math.min(numSamples, startIdx + totalNoteSamples);

    for (let i = startIdx; i < endIdx; i++) {
      const localIdx = i - startIdx;
      const t = localIdx / sampleRate;
      let env = 1.0;
      if (localIdx < attackSamples) {
        env = localIdx / attackSamples;
      } else {
        const decayProgress = (localIdx - attackSamples) / Math.max(1, totalNoteSamples - attackSamples);
        env = Math.exp(-3.8 * decayProgress);
      }
      // Fundamental + subtle 2nd harmonic warmth
      const sample =
        Math.sin(2 * Math.PI * note.freq * t) * 0.88 +
        Math.sin(4 * Math.PI * note.freq * t) * 0.12;
      pcm[i] += sample * note.amp * env;
    }
  }

  // Encode as standard 44-byte RIFF WAVE header + 16-bit signed PCM
  const wavBuffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(wavBuffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let byteOffset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(byteOffset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    byteOffset += 2;
  }

  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  cachedChimeWavUrl = URL.createObjectURL(blob);
  return cachedChimeWavUrl;
}

/**
 * Starts the optional "Earbuds Nap Mode" HTML5 <audio> silent channel during a direct user tap.
 * Keeps an active audio stream open so when the Service Worker receives the background FCM push,
 * swapping <audio>.src to the synthesized WAV chime rings continuously into the user's earbuds
 * even while the screen remains locked.
 */
export async function startEarbudsNapShield(stopName?: string): Promise<boolean> {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return false;
  try {
    // Pre-warm WAV chime blob URL while in foreground
    getChimeWavBlobUrl();

    if (!napAudioEl) {
      napAudioEl = new Audio('/silence.wav');
      napAudioEl.preload = 'auto';
    }
    napAudioEl.pause();
    napAudioEl.src = '/silence.wav';
    napAudioEl.loop = true;
    napAudioEl.volume = 0.02;

    await napAudioEl.play();
    napShieldEnabled = true;

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: '🎧 Earbuds Nap Alarm Armed',
          artist: stopName ? `Alighting at ${stopName}` : 'SG Bus Kaki Ride Shield',
          album: 'SG Bus Kaki',
          artwork: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
        });
        navigator.mediaSession.playbackState = 'playing';
      } catch {
        // Safe fail
      }
    }
    return true;
  } catch (err) {
    console.warn('Could not activate Earbuds Nap Audio Shield:', err);
    napShieldEnabled = false;
    return false;
  }
}

/**
 * Swaps the active Earbuds Nap Mode <audio> stream from silence.wav to the loud melodic WAV chime.
 * Works in background when triggered via Service Worker 'PUSH_ALIGHT_TRIGGERED' postMessage.
 */
export function triggerEarbudsNapAlarm(stopName?: string, maxDurationMs = 45000): boolean {
  if (!napShieldEnabled || !napAudioEl) return false;
  try {
    if (napAlarmAutoStopTimer) {
      clearTimeout(napAlarmAutoStopTimer);
      napAlarmAutoStopTimer = null;
    }

    const chimeUrl = getChimeWavBlobUrl();
    napAudioEl.src = chimeUrl;
    napAudioEl.loop = true;
    napAudioEl.volume = 1.0;
    napAudioEl.play().catch((err) => {
      console.warn('Nap audio chime swap play notice:', err);
    });

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: `⏰ ALIGHT NOW: ${stopName || 'Destination'}!`,
          artist: 'Prepare to alight at your stop',
          album: 'SG Bus Kaki',
          artwork: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
        });
        navigator.mediaSession.playbackState = 'playing';
      } catch {
        // Safe fail
      }
    }

    if (maxDurationMs > 0) {
      napAlarmAutoStopTimer = setTimeout(() => {
        stopEarbudsNapShield();
      }, maxDurationMs);
    }
    return true;
  } catch {
    return false;
  }
}

export function stopEarbudsNapShield() {
  napShieldEnabled = false;
  if (napAlarmAutoStopTimer) {
    clearTimeout(napAlarmAutoStopTimer);
    napAlarmAutoStopTimer = null;
  }
  if (napAudioEl) {
    try {
      napAudioEl.pause();
      napAudioEl.currentTime = 0;
      napAudioEl.src = '/silence.wav';
    } catch {
      // Safe fail
    }
  }
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
    } catch {
      // Safe fail
    }
  }
}

export function isEarbudsNapShieldActive(): boolean {
  return napShieldEnabled;
}

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
      }, 3500);
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
 */
export function playGentleTransitChime() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.85, now);
    masterGain.connect(ctx.destination);

    const notes = [
      { freq: 523.25, start: 0.0, duration: 0.55, gain: 0.3 }, // C5
      { freq: 659.25, start: 0.25, duration: 0.55, gain: 0.28 }, // E5
      { freq: 783.99, start: 0.5, duration: 0.65, gain: 0.26 }, // G5
      { freq: 987.77, start: 0.75, duration: 0.75, gain: 0.25 }, // B5
      { freq: 1046.5, start: 1.05, duration: 1.5, gain: 0.28 }, // C6
      { freq: 659.25, start: 1.25, duration: 2.2, gain: 0.16 }, // E5 sustain
      { freq: 783.99, start: 1.25, duration: 2.2, gain: 0.15 }, // G5 sustain
      { freq: 1046.5, start: 1.25, duration: 2.4, gain: 0.18 }, // C6 sustain
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

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([500, 200, 500, 200, 1000]);
      } catch {
        // Safe fail
      }
    }
  } catch (err) {
    console.warn('Audio chime playback error:', err);
  }
}

/**
 * Starts continuous repeating prolonged chime via Web Audio API (foreground)
 * AND activates the HTML5 <audio> Earbuds Nap Alarm stream if Nap Shield was enabled.
 */
export function startContinuousChime(alertLabel?: string, maxDurationMs?: number) {
  if (chimeIntervalId) {
    clearInterval(chimeIntervalId);
    chimeIntervalId = null;
  }
  if (chimeAutoStopTimer) {
    clearTimeout(chimeAutoStopTimer);
    chimeAutoStopTimer = null;
  }

  // If Earbuds Nap Mode is active, trigger the background-capable HTML5 <audio> WAV stream
  const handledByNapStream = triggerEarbudsNapAlarm(alertLabel, maxDurationMs || 45000);

  // If in foreground (or Nap Mode off), run Web Audio synthesizer chime
  if (!handledByNapStream) {
    playGentleTransitChime();
    chimeIntervalId = setInterval(() => {
      playGentleTransitChime();
    }, 4500);

    if (maxDurationMs && maxDurationMs > 0) {
      chimeAutoStopTimer = setTimeout(() => {
        stopContinuousChime();
      }, maxDurationMs);
    }
  } else if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([800, 250, 800, 250, 1200]);
    } catch {
      // Safe fail
    }
  }
}

/**
 * Stops continuous repeating chime (both Web Audio and Earbuds Nap stream)
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
  if (napShieldEnabled) {
    stopEarbudsNapShield();
  }
}

export function startBackgroundAudioKeepAlive(_stopName?: string) {
  try {
    acquireInvisibleWebLock();
    ensureBackgroundWorker();
    if (!napShieldEnabled && typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
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
  stopEarbudsNapShield();
}

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
    isNaN(nLat1) ||
    isNaN(nLon1) ||
    isNaN(nLat2) ||
    isNaN(nLon2) ||
    nLat1 === 0 ||
    nLon1 === 0 ||
    nLat2 === 0 ||
    nLon2 === 0
  ) {
    return null;
  }

  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(nLat2 - nLat1);
  const dLon = toRad(nLon2 - nLon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(nLat1)) * Math.cos(toRad(nLat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function formatDistance(meters: number | null): string {
  if (meters === null || isNaN(meters)) return 'Acquiring GPS...';
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}
