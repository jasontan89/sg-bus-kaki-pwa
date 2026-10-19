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

let backgroundAudio: HTMLAudioElement | null = null;
let keepAliveWavUrl: string | null = null;
let alarmChimeWavUrl: string | null = null;
let isChimeRinging = false;
let isKeepAliveActive = false;
let currentKeepAliveLabel = 'Active Transit Alert';
let bgWorker: Worker | null = null;
let bgTickCallbacks: Set<() => void> = new Set();
let lastTickTime = 0;

/**
 * Generates an in-memory 20-second 16-bit PCM WAV Blob URL with an imperceptible
 * sub-audible signal (-80 dBFS at 20Hz).
 * Why:
 * 1. Chromium on Android requires <audio> duration >= 5 seconds (kMinimumDurationForContent)
 *    to grant an Android OS Foreground Media Service & MediaSession lock.
 * 2. Chromium's SilentAudioDetector drops the audio wake lock if PCM samples are pure 0.
 *    Using +/- 3 LSB out of 32767 is 100% inaudible at volume=1.0 while keeping the CPU & audio pipeline awake.
 */
function getKeepAliveWavUrl(): string {
  if (keepAliveWavUrl) return keepAliveWavUrl;

  const sampleRate = 8000;
  const durationSeconds = 20;
  const numSamples = sampleRate * durationSeconds;
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * 20 * i) / sampleRate) * 3);
    view.setInt16(44 + i * 2, sample, true);
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  keepAliveWavUrl = URL.createObjectURL(blob);
  return keepAliveWavUrl;
}

/**
 * Generates an in-memory 4.2-second 16-bit PCM WAV Blob URL containing the loud
 * 5-tone ascending harmonic transit chime + resolving chord.
 * Why:
 * When the PWA is in the background on Android, Web Audio API (AudioContext) oscillators
 * can be suspended or blocked if not routed through the active HTML5 <audio> MediaSession element.
 * Switching the already-playing HTML5 <audio> element's src to this WAV guarantees loud
 * background audio playback through Android's foreground media channel!
 */
function getAlarmChimeWavUrl(): string {
  if (alarmChimeWavUrl) return alarmChimeWavUrl;

  const sampleRate = 22050;
  const durationSeconds = 4.2;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const notes = [
    { freq: 523.25, start: 0.0, duration: 0.55, gain: 0.35 },  // C5
    { freq: 659.25, start: 0.25, duration: 0.55, gain: 0.35 }, // E5
    { freq: 783.99, start: 0.5, duration: 0.65, gain: 0.35 },  // G5
    { freq: 987.77, start: 0.75, duration: 0.75, gain: 0.35 }, // B5
    { freq: 1046.5, start: 1.05, duration: 1.6, gain: 0.40 },  // C6
    // Warm resolving chord + double alert chime
    { freq: 659.25, start: 1.25, duration: 2.2, gain: 0.22 },
    { freq: 783.99, start: 1.25, duration: 2.2, gain: 0.22 },
    { freq: 1046.5, start: 1.25, duration: 2.4, gain: 0.25 },
    { freq: 880.0, start: 2.7, duration: 0.35, gain: 0.38 },   // A5 alert pulse
    { freq: 1046.5, start: 3.1, duration: 0.7, gain: 0.42 },   // C6 alert pulse
  ];

  const floatSamples = new Float32Array(numSamples);

  for (const note of notes) {
    const startIdx = Math.floor(note.start * sampleRate);
    const endIdx = Math.min(numSamples, Math.floor((note.start + note.duration) * sampleRate));
    const attackSamples = Math.floor(0.03 * sampleRate);

    for (let i = startIdx; i < endIdx; i++) {
      const localIdx = i - startIdx;
      const localTime = localIdx / sampleRate;
      let env = 1.0;
      if (localIdx < attackSamples) {
        env = localIdx / attackSamples;
      } else {
        const decayProgress = (localTime - 0.03) / Math.max(0.05, note.duration - 0.03);
        env = Math.exp(-3.2 * decayProgress);
      }
      // Fundamental + soft 2nd harmonic for warm bell clarity on phone speakers
      const wave =
        Math.sin(2 * Math.PI * note.freq * localTime) * 0.8 +
        Math.sin(2 * Math.PI * note.freq * 2 * localTime) * 0.2;
      floatSamples[i] += wave * note.gain * env;
    }
  }

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-0.98, Math.min(0.98, floatSamples[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  alarmChimeWavUrl = URL.createObjectURL(blob);
  return alarmChimeWavUrl;
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

function ensureBackgroundAudioElement(): HTMLAudioElement {
  if (!backgroundAudio) {
    backgroundAudio = new Audio();
    backgroundAudio.preload = 'auto';
    backgroundAudio.loop = true;
    backgroundAudio.volume = 1.0;
    backgroundAudio.addEventListener('timeupdate', () => {
      emitBackgroundTick();
    });
  }
  return backgroundAudio;
}

/**
 * Unlock Web Audio & HTML5 Audio element on user gesture (e.g. tapping "Alight Alert", "Arm Alert", or "Test Chime")
 * Mobile Chrome requires both AudioContext and HTMLAudioElement to be blessed during a direct user touch gesture.
 */
export function unlockAudio() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    // Play inaudible silent buffer to register user activation with Web Audio API
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);

    // Also pre-warm and bless the HTML5 Audio element during the user gesture
    const audio = ensureBackgroundAudioElement();
    if (!audio.src) {
      audio.src = getKeepAliveWavUrl();
    }
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
 * Starts continuous repeating prolonged chime.
 * CRITICAL FOR ANDROID BACKGROUND AUDIO:
 * Does NOT destroy the HTML5 <audio> MediaSession! Instead, it switches the active
 * HTML5 <audio> element from the silent keep-alive WAV to the loud synthesized Alarm WAV
 * so Android plays the chime at full volume even when the PWA is in the background or screen is off!
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
  isChimeRinging = true;

  // 1. Switch active HTML5 <audio> element to loud alarm WAV for background playback
  try {
    const audio = ensureBackgroundAudioElement();
    const alarmUrl = getAlarmChimeWavUrl();
    if (audio.src !== alarmUrl) {
      audio.src = alarmUrl;
    }
    audio.loop = true;
    audio.volume = 1.0;
    audio.play().catch((err) => {
      console.warn('HTML5 alarm audio play fallback to WebAudio:', err);
    });

    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: alertLabel || '⏰ Transit Alarm Ringing! 🚌',
        artist: 'Tap to return to SG Bus Kaki',
        album: 'SG Bus Kaki Alert',
        artwork: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      });
      navigator.mediaSession.playbackState = 'playing';
    }
  } catch (err) {
    console.warn('Error switching background audio to alarm chime:', err);
  }

  // 2. Also play Web Audio synthesizer chime & haptic vibration
  playGentleTransitChime();
  chimeIntervalId = setInterval(() => {
    playGentleTransitChime();
    // Ensure HTML5 audio stays playing if interrupted
    if (isChimeRinging && backgroundAudio && backgroundAudio.paused) {
      backgroundAudio.play().catch(() => {});
    }
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
  isChimeRinging = false;
  if (chimeIntervalId) {
    clearInterval(chimeIntervalId);
    chimeIntervalId = null;
  }
  if (chimeAutoStopTimer) {
    clearTimeout(chimeAutoStopTimer);
    chimeAutoStopTimer = null;
  }

  // If keep-alive is still needed for other active alarms, switch back to keep-alive WAV
  if (isKeepAliveActive && backgroundAudio) {
    try {
      backgroundAudio.src = getKeepAliveWavUrl();
      backgroundAudio.loop = true;
      backgroundAudio.volume = 1.0;
      backgroundAudio.play().catch(() => {});
      updateKeepAliveMediaSession(currentKeepAliveLabel);
    } catch {
      // Safe fail
    }
  } else if (backgroundAudio) {
    try {
      backgroundAudio.pause();
    } catch {
      // Safe fail
    }
  }
}

function updateKeepAliveMediaSession(label: string) {
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `Transit Alert Active 🚌`,
        artist: `Monitoring: ${label}`,
        album: 'SG Bus Kaki Real-Time Background Shield',
        artwork: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      });
      navigator.mediaSession.playbackState = 'playing';

      navigator.mediaSession.setActionHandler('play', () => {
        backgroundAudio?.play().catch(() => {});
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        if (isChimeRinging) {
          stopContinuousChime();
        } else {
          // Keep background protection running unless user explicitly cancels alarm in app
          backgroundAudio?.play().catch(() => {});
        }
      });
    } catch {
      // Safe fail
    }
  }
}

/**
 * Background Audio Keep-Alive Service:
 * Plays a 20-second sub-audible (-80 dBFS) WAV stream with MediaSession metadata and starts a
 * dedicated Web Worker timer so Android Chrome keeps the JS thread, network polling, and audio
 * session alive when the user navigates out of the PWA or locks their screen.
 */
export function startBackgroundAudioKeepAlive(stopName: string) {
  try {
    isKeepAliveActive = true;
    currentKeepAliveLabel = stopName || 'Active Transit Alert';
    ensureBackgroundWorker();

    const audio = ensureBackgroundAudioElement();
    if (!isChimeRinging) {
      const keepAliveUrl = getKeepAliveWavUrl();
      if (audio.src !== keepAliveUrl) {
        audio.src = keepAliveUrl;
      }
      audio.loop = true;
      audio.volume = 1.0;
      audio.play().catch((err) => {
        console.warn('Background audio autoplay notice:', err);
      });
      updateKeepAliveMediaSession(currentKeepAliveLabel);
    }
  } catch (err) {
    console.warn('Could not initialize background audio keep-alive:', err);
  }
}

export function stopBackgroundAudioKeepAlive() {
  isKeepAliveActive = false;
  stopBackgroundWorker();

  if (backgroundAudio && !isChimeRinging) {
    try {
      backgroundAudio.pause();
      backgroundAudio.removeAttribute('src');
      backgroundAudio.load();
    } catch {
      // Safe fail
    }
    backgroundAudio = null;
  }

  if (!isChimeRinging && typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
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
