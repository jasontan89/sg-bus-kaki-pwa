// Supabase Edge Function: pwa_api
// Deno TypeScript HTTP router serving SG Bus Kaki PWA

// @ts-ignore npm specifier
import { createClient } from 'npm:@supabase/supabase-js@2.48.1';
import { sendPushNotification } from './web_push.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const LTA_API_URL = 'https://datamall2.mytransport.sg/ltaodataservice';
const LTA_API_KEY =
  Deno.env.get('LTA_ACCOUNT_KEY') ||
  Deno.env.get('LTA_DATAMALL_API_KEY') ||
  '';

const VAPID_PUBLIC_KEY =
  Deno.env.get('VAPID_PUBLIC_KEY') ||
  'BHSw8VkpCSgUdC1_XRhHMvLMdm7w-VhRH_tahYM2ZXOBAhQ2A80SPwEvakojni6fs7gT3R_ke7ZKspb6w79rBw8';

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  };
}

function calculateEtaMinutes(estTimeStr: string | null): number | null {
  if (!estTimeStr || !estTimeStr.trim()) return null;
  const target = new Date(estTimeStr).getTime();
  if (isNaN(target)) return null;
  const now = Date.now();
  const diffMinutes = Math.floor((target - now) / 60000);
  return Math.max(0, diffMinutes);
}

function calculateEtaSeconds(estTimeStr: string | null): number | null {
  if (!estTimeStr || !estTimeStr.trim()) return null;
  const target = new Date(estTimeStr).getTime();
  if (isNaN(target)) return null;
  return Math.round((target - Date.now()) / 1000);
}

// Distance between two points in meters
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function isValidCoord(lat: any, lon: any): boolean {
  const nLat = Number(lat);
  const nLon = Number(lon);
  return (
    !isNaN(nLat) &&
    !isNaN(nLon) &&
    Math.abs(nLat) > 0.1 &&
    Math.abs(nLon) > 0.1 &&
    !(nLat === 1.35 && nLon === 103.82)
  );
}

interface RouteStopEnriched {
  service_no: string;
  direction: number;
  stop_sequence: number;
  bus_stop_code: string;
  distance: number;
  latitude: number;
  longitude: number;
  description?: string;
}

interface CandidateRouteMatch {
  serviceNo: string;
  direction: number;
  boardSeq: number;
  boardStopCode: string;
  boardDistMeters: number;
  probeStopCode: string;
  targetSeq: number;
}

async function fetchLtaBusArrivalRaw(
  busStopCode: string,
  serviceNo?: string,
  cache?: Map<string, any>
): Promise<any | null> {
  const key = `${busStopCode}::${serviceNo || '*'}`;
  if (cache && cache.has(key)) return cache.get(key);
  if (cache && serviceNo && cache.has(`${busStopCode}::*`)) {
    const allData = cache.get(`${busStopCode}::*`);
    if (allData && Array.isArray(allData.Services)) {
      const filtered = {
        ...allData,
        Services: allData.Services.filter(
          (s: any) => String(s.ServiceNo).toLowerCase() === String(serviceNo).toLowerCase()
        ),
      };
      cache.set(key, filtered);
      return filtered;
    }
  }

  try {
    let ltaUrl = `${LTA_API_URL}/v3/BusArrival?BusStopCode=${encodeURIComponent(busStopCode)}`;
    if (serviceNo) {
      ltaUrl += `&ServiceNo=${encodeURIComponent(serviceNo)}`;
    }
    const res = await fetch(ltaUrl, {
      headers: { AccountKey: LTA_API_KEY, accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (cache) cache.set(key, data);
    return data;
  } catch (err) {
    console.warn(`LTA BusArrival fetch warning (${busStopCode}):`, err);
    return null;
  }
}

async function fetchEnrichedRouteStops(
  serviceNo: string,
  direction?: number | null
): Promise<RouteStopEnriched[]> {
  let query = supabase
    .from('lta_bus_routes')
    .select('service_no, direction, stop_sequence, bus_stop_code, distance')
    .ilike('service_no', serviceNo.trim());

  if (direction === 1 || direction === 2) {
    query = query.eq('direction', direction);
  }

  const { data: routes } = await query
    .order('direction', { ascending: true })
    .order('stop_sequence', { ascending: true });

  if (!routes || routes.length === 0) return [];

  const uniqueCodes = Array.from(new Set(routes.map((r: any) => r.bus_stop_code)));
  const { data: stops } = await supabase
    .from('lta_bus_stops')
    .select('bus_stop_code, latitude, longitude, description')
    .in('bus_stop_code', uniqueCodes);

  const stopMap = new Map<string, any>((stops || []).map((s: any) => [s.bus_stop_code, s]));

  return routes
    .map((r: any) => {
      const s = stopMap.get(r.bus_stop_code);
      return {
        service_no: r.service_no,
        direction: Number(r.direction),
        stop_sequence: Number(r.stop_sequence),
        bus_stop_code: r.bus_stop_code,
        distance: Number(r.distance) || 0,
        latitude: Number(s?.latitude) || 0,
        longitude: Number(s?.longitude) || 0,
        description: s?.description || '',
      };
    })
    .filter((r) => r.latitude !== 0 && r.longitude !== 0);
}

/**
 * Discovers candidate bus routes connecting user's current GPS vicinity to targetStopCode,
 * and optionally locks onto an explicit service or the closest live LTA bus vehicle.
 */
async function resolveRideRouteAndVehicle(params: {
  targetStopCode: string;
  targetLat: number;
  targetLon: number;
  userLat?: number | null;
  userLon?: number | null;
  requestedMode?: string | null;
  requestedServiceNo?: string | null;
  requestedDirection?: number | null;
}) {
  const {
    targetStopCode,
    userLat,
    userLon,
    requestedMode,
    requestedServiceNo,
    requestedDirection,
  } = params;

  const hasUserGps = isValidCoord(userLat, userLon);
  const uLat = Number(userLat);
  const uLon = Number(userLon);

  // Step A: Discover connecting bus services from user's vicinity -> targetStopCode
  let candidateMatches: CandidateRouteMatch[] = [];
  let candidateServices: string[] = [];

  if (hasUserGps) {
    const [{ data: targetRoutes }, { data: nearbyStops }] = await Promise.all([
      supabase
        .from('lta_bus_routes')
        .select('service_no, direction, stop_sequence')
        .eq('bus_stop_code', targetStopCode),
      supabase
        .from('lta_bus_stops')
        .select('bus_stop_code, latitude, longitude')
        .gte('latitude', uLat - 0.0065)
        .lte('latitude', uLat + 0.0065)
        .gte('longitude', uLon - 0.0065)
        .lte('longitude', uLon + 0.0065),
    ]);

    if (targetRoutes && targetRoutes.length > 0 && nearbyStops && nearbyStops.length > 0) {
      const nearbyWithDist = nearbyStops
        .map((s: any) => ({
          code: s.bus_stop_code as string,
          dist: haversineMeters(uLat, uLon, Number(s.latitude), Number(s.longitude)),
        }))
        .filter((s) => s.dist <= 650)
        .sort((a, b) => a.dist - b.dist);

      if (nearbyWithDist.length > 0) {
        const nearbyDistMap = new Map(nearbyWithDist.map((s) => [s.code, s.dist]));
        const targetServiceNos = Array.from(new Set(targetRoutes.map((r: any) => r.service_no)));
        const nearbyCodes = nearbyWithDist.map((s) => s.code);

        const { data: upstreamRoutes } = await supabase
          .from('lta_bus_routes')
          .select('service_no, direction, stop_sequence, bus_stop_code')
          .in('bus_stop_code', nearbyCodes)
          .in('service_no', targetServiceNos);

        if (upstreamRoutes && upstreamRoutes.length > 0) {
          const bestPerServiceDir = new Map<string, CandidateRouteMatch>();

          for (const up of upstreamRoutes) {
            // Find matching target occurrence downstream on the same service & direction
            const matchingTargets = targetRoutes
              .filter(
                (tr: any) =>
                  tr.service_no === up.service_no &&
                  Number(tr.direction) === Number(up.direction) &&
                  Number(tr.stop_sequence) > Number(up.stop_sequence)
              )
              .sort((a: any, b: any) => Number(a.stop_sequence) - Number(b.stop_sequence));

            if (matchingTargets.length === 0) continue;
            const targetOcc = matchingTargets[0];
            const bDist = nearbyDistMap.get(up.bus_stop_code) ?? 999;
            const key = `${up.service_no}::${up.direction}`;
            const existing = bestPerServiceDir.get(key);

            if (!existing || bDist < existing.boardDistMeters) {
              bestPerServiceDir.set(key, {
                serviceNo: up.service_no,
                direction: Number(up.direction),
                boardSeq: Number(up.stop_sequence),
                boardStopCode: up.bus_stop_code,
                boardDistMeters: bDist,
                probeStopCode: up.bus_stop_code,
                targetSeq: Number(targetOcc.stop_sequence),
              });
            }
          }

          candidateMatches = Array.from(bestPerServiceDir.values()).sort(
            (a, b) => a.boardDistMeters - b.boardDistMeters
          );

          // Resolve immediate next downstream stop (boardSeq + 1) as the LTA probe stop
          if (candidateMatches.length > 0) {
            const topCandidates = candidateMatches.slice(0, 6);
            const nextSeqQueries = topCandidates.map((c) =>
              supabase
                .from('lta_bus_routes')
                .select('bus_stop_code')
                .eq('service_no', c.serviceNo)
                .eq('direction', c.direction)
                .eq('stop_sequence', Math.min(c.targetSeq, c.boardSeq + 1))
                .maybeSingle()
            );
            const nextStops = await Promise.all(nextSeqQueries);
            nextStops.forEach((res, idx) => {
              if (res.data?.bus_stop_code) {
                topCandidates[idx].probeStopCode = res.data.bus_stop_code;
              }
            });
            candidateMatches = topCandidates;
          }

          candidateServices = Array.from(new Set(candidateMatches.map((c) => c.serviceNo)));
        }
      }
    }
  }

  // Fallback candidate list: if no nearby connecting stops (e.g. GPS off), list services serving targetStopCode
  if (candidateServices.length === 0) {
    const { data: atTarget } = await supabase
      .from('lta_bus_routes')
      .select('service_no')
      .eq('bus_stop_code', targetStopCode)
      .limit(16);
    if (atTarget && atTarget.length > 0) {
      candidateServices = Array.from(new Set(atTarget.map((r: any) => String(r.service_no)))).slice(
        0,
        8
      );
    }
  }

  // Step B: If commuter explicitly picked MRT or Trajectory mode
  if (requestedMode === 'mrt' || requestedMode === 'trajectory_eta') {
    return {
      trackingMode: requestedMode,
      serviceNo: null,
      direction: null,
      boardingStopSeq: null,
      trackedStopSeq: null,
      targetStopSeq: null,
      stopsRemaining: null,
      candidateServices,
      candidatesMeta: candidateMatches,
      vehicleLat: null,
      vehicleLon: null,
    };
  }

  // Step C: Explicit Bus Service requested (either from SearchView route or HUD pill click)
  if (requestedServiceNo && requestedServiceNo.trim()) {
    const cleanSvc = requestedServiceNo.trim();
    const allStops = await fetchEnrichedRouteStops(cleanSvc, null);

    if (allStops.length > 0) {
      const dirsToCheck =
        requestedDirection === 1 || requestedDirection === 2
          ? [requestedDirection, requestedDirection === 1 ? 2 : 1]
          : [1, 2];

      let chosenDir: number | null = null;
      let chosenBoardSeq: number | null = null;
      let chosenTargetSeq: number | null = null;
      let bestUserDist = Infinity;

      for (const dir of dirsToCheck) {
        const dirStops = allStops.filter((s) => s.direction === dir);
        if (dirStops.length === 0) continue;

        const targetOccurrences = dirStops.filter(
          (s) => s.bus_stop_code === targetStopCode && s.stop_sequence > 1
        );
        const targets =
          targetOccurrences.length > 0
            ? targetOccurrences
            : dirStops.filter((s) => s.bus_stop_code === targetStopCode);

        for (const tStop of targets) {
          if (hasUserGps) {
            const upstream = dirStops.filter((s) => s.stop_sequence < tStop.stop_sequence);
            for (const uStop of upstream) {
              const d = haversineMeters(uLat, uLon, uStop.latitude, uStop.longitude);
              // Give slight preference to explicitly requested direction if distances are comparable
              const dirPenalty = requestedDirection && dir !== requestedDirection ? 250 : 0;
              if (d + dirPenalty < bestUserDist) {
                bestUserDist = d + dirPenalty;
                chosenDir = dir;
                chosenBoardSeq = uStop.stop_sequence;
                chosenTargetSeq = tStop.stop_sequence;
              }
            }
          } else if (chosenDir === null) {
            chosenDir = dir;
            chosenTargetSeq = tStop.stop_sequence;
            chosenBoardSeq = Math.max(1, tStop.stop_sequence - 8);
          }
        }
      }

      if (chosenDir !== null && chosenTargetSeq !== null && chosenBoardSeq !== null) {
        if (!candidateServices.includes(cleanSvc)) {
          candidateServices = [cleanSvc, ...candidateServices].slice(0, 8);
        }
        return {
          trackingMode: 'bus_locked',
          serviceNo: allStops[0].service_no,
          direction: chosenDir,
          boardingStopSeq: chosenBoardSeq,
          trackedStopSeq: Math.min(chosenTargetSeq, chosenBoardSeq + 1),
          targetStopSeq: chosenTargetSeq,
          stopsRemaining: Math.max(0, chosenTargetSeq - chosenBoardSeq),
          candidateServices,
          candidatesMeta: candidateMatches,
          vehicleLat: null,
          vehicleLon: null,
        };
      }
    }
  }

  // Step D: Zero-Tap Auto-Detect Bus Vehicle Match
  if (candidateMatches.length === 1) {
    // Only 1 bus service connects the commuter's current stop area directly to targetStopCode!
    const only = candidateMatches[0];
    return {
      trackingMode: 'bus_locked',
      serviceNo: only.serviceNo,
      direction: only.direction,
      boardingStopSeq: only.boardSeq,
      trackedStopSeq: Math.min(only.targetSeq, only.boardSeq + 1),
      targetStopSeq: only.targetSeq,
      stopsRemaining: Math.max(0, only.targetSeq - only.boardSeq),
      candidateServices,
      candidatesMeta: candidateMatches,
      vehicleLat: null,
      vehicleLon: null,
    };
  }

  if (candidateMatches.length > 1 && hasUserGps) {
    const ltaCache = new Map<string, any>();
    let bestScore = -Infinity;
    let bestMatch: CandidateRouteMatch | null = null;
    let bestVehicleCoords: { lat: number; lon: number } | null = null;

    for (const cand of candidateMatches.slice(0, 5)) {
      const arrivalData = await fetchLtaBusArrivalRaw(cand.probeStopCode, undefined, ltaCache);
      const svcObj = (arrivalData?.Services || []).find(
        (s: any) => String(s.ServiceNo).toLowerCase() === cand.serviceNo.toLowerCase()
      );
      if (!svcObj) continue;

      const slots = [svcObj.NextBus, svcObj.NextBus2].filter(Boolean);
      for (const slot of slots) {
        const bLat = parseFloat(slot.Latitude);
        const bLon = parseFloat(slot.Longitude);
        const etaSec = calculateEtaSeconds(slot.EstimatedArrival);

        if (isValidCoord(bLat, bLon)) {
          const busToUser = haversineMeters(uLat, uLon, bLat, bLon);
          if (busToUser <= 450) {
            const score = 1000 - busToUser - cand.boardDistMeters * 0.25;
            if (score > bestScore) {
              bestScore = score;
              bestMatch = cand;
              bestVehicleCoords = { lat: bLat, lon: bLon };
            }
          }
        } else if (etaSec !== null && etaSec >= -45 && etaSec <= 240) {
          const score = 350 - Math.abs(etaSec) - cand.boardDistMeters * 0.3;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = cand;
            bestVehicleCoords = null;
          }
        }
      }
    }

    if (bestMatch && bestScore >= 200) {
      return {
        trackingMode: 'bus_locked',
        serviceNo: bestMatch.serviceNo,
        direction: bestMatch.direction,
        boardingStopSeq: bestMatch.boardSeq,
        trackedStopSeq: Math.min(bestMatch.targetSeq, bestMatch.boardSeq + 1),
        targetStopSeq: bestMatch.targetSeq,
        stopsRemaining: Math.max(0, bestMatch.targetSeq - bestMatch.boardSeq),
        candidateServices,
        candidatesMeta: candidateMatches,
        vehicleLat: bestVehicleCoords?.lat ?? null,
        vehicleLon: bestVehicleCoords?.lon ?? null,
      };
    }

    // Multiple connecting bus routes exist, wait briefly in auto_detect to lock as vehicle moves
    return {
      trackingMode: 'auto_detect',
      serviceNo: null,
      direction: null,
      boardingStopSeq: candidateMatches[0].boardSeq,
      trackedStopSeq: Math.min(candidateMatches[0].targetSeq, candidateMatches[0].boardSeq + 1),
      targetStopSeq: candidateMatches[0].targetSeq,
      stopsRemaining: Math.max(0, candidateMatches[0].targetSeq - candidateMatches[0].boardSeq),
      candidateServices,
      candidatesMeta: candidateMatches,
      vehicleLat: null,
      vehicleLon: null,
    };
  }

  // No connecting bus route found (e.g. MRT / car ride) -> Kinematic Trajectory ETA mode
  return {
    trackingMode: 'trajectory_eta',
    serviceNo: null,
    direction: null,
    boardingStopSeq: null,
    trackedStopSeq: null,
    targetStopSeq: null,
    stopsRemaining: null,
    candidateServices,
    candidatesMeta: [],
    vehicleLat: null,
    vehicleLon: null,
  };
}

async function resolveSubscriptionForEndpoint(endpoint: string) {
  let { data: sub } = await supabase
    .from('pwa_push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('endpoint', endpoint)
    .maybeSingle();

  if (!sub) {
    const { data: latestSub } = await supabase
      .from('pwa_push_subscriptions')
      .select('endpoint, p256dh, auth')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    sub = latestSub;
  }

  if (!sub || !sub.p256dh || !sub.auth) return null;
  return {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.p256dh,
      auth: sub.auth,
    },
  };
}

/**
 * Atomically marks an alight alarm as fired and dispatches a 3-pulse High-Urgency VAPID Web Push
 * cadence (0s, +4s, +10s) that stops immediately if the user taps "I Have Alighted".
 */
async function triggerAlightPushSequence(
  alarm: any,
  distMeters: number,
  stopsRemaining: number | null
): Promise<boolean> {
  // Atomic CAS update so concurrent cron + heartbeat passes never double-fire
  const { data: updatedRows, error: updateErr } = await supabase
    .from('pwa_alight_alarms')
    .update({
      fired: true,
      estimated_distance_meters: distMeters,
      stops_remaining: stopsRemaining ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', alarm.id)
    .eq('fired', false)
    .select('id');

  if (updateErr || !updatedRows || updatedRows.length === 0) {
    return false;
  }

  const subscriptionObj = await resolveSubscriptionForEndpoint(alarm.endpoint);
  if (!subscriptionObj) return false;

  const stopLabel = alarm.target_stop_name || `Stop ${alarm.target_stop_code}`;
  const distText = distMeters > 0 ? `${distMeters}m` : `within ${alarm.threshold_meters}m`;
  const body = alarm.service_no
    ? `Bus ${alarm.service_no} is ${distText} from ${stopLabel}! Prepare to alight now.`
    : `Approaching ${stopLabel} (${distText} away)! Prepare to alight now.`;

  const basePayload = {
    title: `⏰ ALIGHT NOW: ${stopLabel}`,
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: `alight-now-${alarm.id}-p1`,
    data: {
      type: 'ALIGHT_ALARM',
      alarmId: alarm.id,
      stopCode: alarm.target_stop_code,
      stopName: stopLabel,
      serviceNo: alarm.service_no || null,
      distanceMeters: distMeters,
      url: `/?alight=hud&stop=${encodeURIComponent(alarm.target_stop_code)}`,
    },
  };

  const firstPush = await sendPushNotification(subscriptionObj, basePayload);

  // Schedule Pulse 2 (+4s) & Pulse 3 (+10s) unless commuter already dismissed/deleted the alarm
  const reinforcementTask = (async () => {
    try {
      await new Promise((r) => setTimeout(r, 4000));
      const { data: stillActive1 } = await supabase
        .from('pwa_alight_alarms')
        .select('id')
        .eq('id', alarm.id)
        .maybeSingle();
      if (!stillActive1) return;

      await sendPushNotification(subscriptionObj, {
        ...basePayload,
        tag: `alight-now-${alarm.id}-p2-${Date.now()}`,
      });

      await new Promise((r) => setTimeout(r, 6000));
      const { data: stillActive2 } = await supabase
        .from('pwa_alight_alarms')
        .select('id')
        .eq('id', alarm.id)
        .maybeSingle();
      if (!stillActive2) return;

      await sendPushNotification(subscriptionObj, {
        ...basePayload,
        tag: `alight-now-${alarm.id}-p3-${Date.now()}`,
      });
    } catch (err) {
      console.warn('Reinforcement alight push warning:', err);
    }
  })();

  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') {
    edgeRuntime.waitUntil(reinforcementTask);
  }

  return firstPush.success;
}

/**
 * Evaluates all active unfired Alighting Alarms every 20 seconds:
 * - Tier 1: Progressive Route-Checkpoint Relay using LTA v3/BusArrival live vehicle GPS & ETA
 * - Tier 2: Kinematic Velocity Trajectory Estimator fallback for MRT / car / unmatched rides
 */
async function runAlightAlarmCheckPass() {
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  const { data: alarms, error } = await supabase
    .from('pwa_alight_alarms')
    .select('*')
    .eq('fired', false)
    .gt('expires_at', nowIso);

  if (error || !alarms || alarms.length === 0) {
    return { activeCount: 0, triggeredCount: 0, remainingCount: 0 };
  }

  const ltaCache = new Map<string, any>();
  let triggeredCount = 0;

  for (const alarm of alarms) {
    try {
      const meta = (alarm.metadata && typeof alarm.metadata === 'object') ? { ...alarm.metadata } : {};
      let mode: string = alarm.tracking_mode || 'auto_detect';
      let serviceNo: string | null = alarm.service_no;
      let direction: number | null = alarm.direction;
      let trackedSeq: number | null = alarm.tracked_stop_seq;
      let targetSeq: number | null = alarm.target_stop_seq;

      // 1. If in auto_detect, attempt to lock onto an active candidate bus (or promote top corridor bus after 45s)
      if (mode === 'auto_detect') {
        const candidates: CandidateRouteMatch[] = Array.isArray(meta.candidates)
          ? meta.candidates
          : [];
        const ageSec = (nowMs - new Date(alarm.created_at).getTime()) / 1000;

        if (candidates.length > 0) {
          let lockedCand: CandidateRouteMatch | null = null;
          let bestScore = -Infinity;
          let matchedCoords: { lat: number; lon: number } | null = null;

          const refLat = isValidCoord(alarm.last_user_lat, alarm.last_user_lon)
            ? Number(alarm.last_user_lat)
            : null;
          const refLon = isValidCoord(alarm.last_user_lat, alarm.last_user_lon)
            ? Number(alarm.last_user_lon)
            : null;

          for (const cand of candidates.slice(0, 4)) {
            const arr = await fetchLtaBusArrivalRaw(cand.probeStopCode, undefined, ltaCache);
            const svc = (arr?.Services || []).find(
              (s: any) => String(s.ServiceNo).toLowerCase() === cand.serviceNo.toLowerCase()
            );
            if (!svc) continue;

            for (const slot of [svc.NextBus, svc.NextBus2].filter(Boolean)) {
              const bLat = parseFloat(slot.Latitude);
              const bLon = parseFloat(slot.Longitude);
              const etaSec = calculateEtaSeconds(slot.EstimatedArrival);

              if (refLat !== null && refLon !== null && isValidCoord(bLat, bLon)) {
                const dist = haversineMeters(refLat, refLon, bLat, bLon);
                if (dist <= 450 || ageSec >= 40) {
                  const score = 1000 - Math.min(dist, 900);
                  if (score > bestScore) {
                    bestScore = score;
                    lockedCand = cand;
                    matchedCoords = { lat: bLat, lon: bLon };
                  }
                }
              } else if (etaSec !== null && etaSec <= 300) {
                const score = 300 - Math.max(0, etaSec);
                if (score > bestScore && ageSec >= 35) {
                  bestScore = score;
                  lockedCand = cand;
                }
              }
            }
          }

          if (lockedCand) {
            mode = 'bus_locked';
            serviceNo = lockedCand.serviceNo;
            direction = lockedCand.direction;
            trackedSeq = Math.min(lockedCand.targetSeq, lockedCand.boardSeq + 1);
            targetSeq = lockedCand.targetSeq;
            if (matchedCoords) {
              meta.last_vehicle_lat = matchedCoords.lat;
              meta.last_vehicle_lon = matchedCoords.lon;
              meta.last_vehicle_at = nowMs;
            }
          }
        } else if (ageSec >= 25) {
          mode = 'trajectory_eta';
        }
      }

      // 2. Tier 1: Progressive Route-Checkpoint Relay for Bus-Locked Rides
      let handledByBusRelay = false;

      if (mode === 'bus_locked' && serviceNo) {
        const routeStops = await fetchEnrichedRouteStops(serviceNo, direction);
        if (routeStops.length > 0) {
          // Ensure targetSeq & trackedSeq are initialized
          if (!targetSeq) {
            const tMatch =
              routeStops.find((s) => s.bus_stop_code === alarm.target_stop_code && s.stop_sequence > 1) ||
              routeStops.find((s) => s.bus_stop_code === alarm.target_stop_code);
            targetSeq = tMatch ? tMatch.stop_sequence : routeStops[routeStops.length - 1].stop_sequence;
          }
          if (!trackedSeq) {
            trackedSeq = Math.max(1, targetSeq - 6);
          }

          const routeWindow = routeStops.filter(
            (s) => s.stop_sequence >= Math.max(1, trackedSeq! - 1) && s.stop_sequence <= targetSeq!
          );

          if (routeWindow.length > 0) {
            const stopsGap = Math.max(0, targetSeq - trackedSeq);
            const isFinalApproach =
              stopsGap <= 3 ||
              (alarm.estimated_distance_meters !== null &&
                alarm.estimated_distance_meters <= Math.max(1800, alarm.threshold_meters * 2.5));

            const checkpointSeq = isFinalApproach
              ? targetSeq
              : Math.min(targetSeq, trackedSeq + 3);
            const checkpointStop =
              routeWindow.find((s) => s.stop_sequence === checkpointSeq) ||
              routeWindow[routeWindow.length - 1];

            const arrivalData = await fetchLtaBusArrivalRaw(
              checkpointStop.bus_stop_code,
              serviceNo,
              ltaCache
            );
            let svc = (arrivalData?.Services || [])[0];

            // Expressway / tunnel leap fallback: also inspect destination stop directly if checkpoint empty
            let queriedDestDirectly = checkpointStop.bus_stop_code === alarm.target_stop_code;
            if (!svc && !queriedDestDirectly) {
              const destData = await fetchLtaBusArrivalRaw(
                alarm.target_stop_code,
                serviceNo,
                ltaCache
              );
              svc = (destData?.Services || [])[0];
              queriedDestDirectly = true;
            }

            if (svc) {
              const slots = [svc.NextBus, svc.NextBus2, svc.NextBus3].filter(Boolean);
              const refLat = isValidCoord(meta.last_vehicle_lat, meta.last_vehicle_lon)
                ? Number(meta.last_vehicle_lat)
                : isValidCoord(alarm.last_user_lat, alarm.last_user_lon)
                ? Number(alarm.last_user_lat)
                : null;
              const refLon = isValidCoord(meta.last_vehicle_lat, meta.last_vehicle_lon)
                ? Number(meta.last_vehicle_lon)
                : isValidCoord(alarm.last_user_lat, alarm.last_user_lon)
                ? Number(alarm.last_user_lon)
                : null;
              const refTimeMs = Number(
                meta.last_vehicle_at ||
                  (alarm.last_user_sync_at ? new Date(alarm.last_user_sync_at).getTime() : 0) ||
                  new Date(alarm.created_at).getTime()
              );
              const dtSec = Math.max(10, (nowMs - refTimeMs) / 1000);
              // Maximum plausible bus travel distance in dtSec (up to 26 m/s on expressways + 550m GPS tolerance)
              const maxPlausibleJumpMeters = dtSec * 26 + 550;

              let chosenSlot: any = null;
              let chosenProjectedSeq = trackedSeq;
              let chosenDistToTarget: number | null = null;
              let chosenCoords: { lat: number; lon: number } | null = null;

              for (const slot of slots) {
                const bLat = parseFloat(slot.Latitude);
                const bLon = parseFloat(slot.Longitude);

                if (isValidCoord(bLat, bLon)) {
                  // Continuity guard: prevent snapping to an earlier bus way ahead near the destination
                  if (refLat !== null && refLon !== null) {
                    const jumpFromRef = haversineMeters(refLat, refLon, bLat, bLon);
                    const prevTargetDist = haversineMeters(
                      refLat,
                      refLon,
                      alarm.target_lat,
                      alarm.target_lon
                    );
                    const slotTargetDist = haversineMeters(
                      bLat,
                      bLon,
                      alarm.target_lat,
                      alarm.target_lon
                    );

                    // Reject if this vehicle is way closer to destination than physically reachable in dtSec
                    if (
                      prevTargetDist - slotTargetDist > maxPlausibleJumpMeters &&
                      jumpFromRef > maxPlausibleJumpMeters
                    ) {
                      continue;
                    }
                  }

                  // Project vehicle GPS onto routeWindow
                  let nearestStop = routeWindow[0];
                  let minStopDist = Infinity;
                  for (const rs of routeWindow) {
                    const d = haversineMeters(bLat, bLon, rs.latitude, rs.longitude);
                    if (d < minStopDist) {
                      minStopDist = d;
                      nearestStop = rs;
                    }
                  }

                  // Vehicle should not be way behind our already-confirmed tracked sequence (allow 1 stop GPS tolerance)
                  if (nearestStop.stop_sequence < trackedSeq - 1 && minStopDist > 400) {
                    continue;
                  }

                  chosenSlot = slot;
                  chosenProjectedSeq = Math.max(trackedSeq, nearestStop.stop_sequence);
                  chosenDistToTarget = haversineMeters(
                    bLat,
                    bLon,
                    alarm.target_lat,
                    alarm.target_lon
                  );
                  chosenCoords = { lat: bLat, lon: bLon };
                  break;
                }
              }

              // Fallback when LTA temporarily omits Latitude/Longitude strings ("")
              if (!chosenSlot && slots.length > 0) {
                const fallbackSlot = slots[0];
                const etaSec = calculateEtaSeconds(fallbackSlot.EstimatedArrival);
                if (etaSec !== null) {
                  handledByBusRelay = true;
                  const lastSeqAdvanceMs = Number(meta.last_seq_advance_at || 0);
                  if (!queriedDestDirectly && etaSec <= 35 && nowMs - lastSeqAdvanceMs >= 40000) {
                    chosenProjectedSeq = Math.min(targetSeq, trackedSeq + 1);
                    meta.last_seq_advance_at = nowMs;
                  }
                  const newStopsLeft = Math.max(0, targetSeq - chosenProjectedSeq);
                  const estMeters = queriedDestDirectly
                    ? Math.max(0, Math.round(Math.max(0, etaSec) * 7.0))
                    : Math.max(
                        alarm.threshold_meters + 100,
                        haversineMeters(
                          checkpointStop.latitude,
                          checkpointStop.longitude,
                          alarm.target_lat,
                          alarm.target_lon
                        ) + Math.max(0, etaSec) * 6
                      );

                  const thresholdSec = Math.max(50, Math.round(alarm.threshold_meters / 7.0));
                  if (
                    (queriedDestDirectly && etaSec <= thresholdSec && newStopsLeft <= 2) ||
                    estMeters <= alarm.threshold_meters
                  ) {
                    const firedOk = await triggerAlightPushSequence(
                      { ...alarm, service_no: serviceNo },
                      estMeters,
                      newStopsLeft
                    );
                    if (firedOk) triggeredCount++;
                  } else {
                    await supabase
                      .from('pwa_alight_alarms')
                      .update({
                        tracking_mode: mode,
                        service_no: serviceNo,
                        direction,
                        tracked_stop_seq: chosenProjectedSeq,
                        target_stop_seq: targetSeq,
                        stops_remaining: newStopsLeft,
                        estimated_distance_meters: Math.round(estMeters),
                        metadata: meta,
                        updated_at: nowIso,
                      })
                      .eq('id', alarm.id);
                  }
                }
              } else if (chosenSlot && chosenDistToTarget !== null) {
                handledByBusRelay = true;
                if (chosenCoords) {
                  meta.last_vehicle_lat = chosenCoords.lat;
                  meta.last_vehicle_lon = chosenCoords.lon;
                  meta.last_vehicle_at = nowMs;
                }
                const newStopsLeft = Math.max(0, targetSeq - chosenProjectedSeq);

                if (chosenDistToTarget <= alarm.threshold_meters) {
                  const firedOk = await triggerAlightPushSequence(
                    { ...alarm, service_no: serviceNo },
                    chosenDistToTarget,
                    newStopsLeft
                  );
                  if (firedOk) triggeredCount++;
                } else {
                  await supabase
                    .from('pwa_alight_alarms')
                    .update({
                      tracking_mode: mode,
                      service_no: serviceNo,
                      direction,
                      tracked_stop_seq: chosenProjectedSeq,
                      target_stop_seq: targetSeq,
                      stops_remaining: newStopsLeft,
                      estimated_distance_meters: chosenDistToTarget,
                      metadata: meta,
                      updated_at: nowIso,
                    })
                    .eq('id', alarm.id);
                }
              }
            }
          }
        }
      }

      if (handledByBusRelay) continue;

      // 3. Tier 2: Kinematic Velocity Trajectory Estimator (MRT / Car / Unmatched or LTA Feed Gap)
      const anchorTimeMs = alarm.last_user_sync_at
        ? new Date(alarm.last_user_sync_at).getTime()
        : new Date(alarm.created_at).getTime();
      const anchorDist =
        typeof meta.anchor_distance_meters === 'number'
          ? meta.anchor_distance_meters
          : isValidCoord(alarm.last_user_lat, alarm.last_user_lon)
          ? haversineMeters(
              Number(alarm.last_user_lat),
              Number(alarm.last_user_lon),
              alarm.target_lat,
              alarm.target_lon
            )
          : alarm.estimated_distance_meters;

      if (anchorDist === null || anchorDist === undefined) continue;

      const observedSpeed = Number(alarm.last_user_speed_mps) || 0;
      const defaultSpeedMps = mode === 'mrt' ? 10.5 : 6.5; // ~38 km/h MRT, ~23.4 km/h Singapore urban road
      const effectiveSpeedMps =
        observedSpeed >= 2.0 && observedSpeed <= 32.0 ? observedSpeed : defaultSpeedMps;

      // Apply a 30s boarding acceleration grace window only if user was stationary when arming
      const graceSec = observedSpeed >= 2.0 ? 0 : 30;
      const elapsedMovingSec = Math.max(0, (nowMs - anchorTimeMs) / 1000 - graceSec);
      const projectedDist = Math.max(
        0,
        Math.round(anchorDist - elapsedMovingSec * effectiveSpeedMps)
      );

      // Stage 1: Gentle Pre-Arrival Heads-Up Push (~1.1km out) in trajectory mode
      let preAlertFired = Boolean(alarm.pre_alert_fired);
      if (
        !preAlertFired &&
        anchorDist > alarm.threshold_meters + 700 &&
        projectedDist <= alarm.threshold_meters + 650 &&
        projectedDist > alarm.threshold_meters
      ) {
        preAlertFired = true;
        const subObj = await resolveSubscriptionForEndpoint(alarm.endpoint);
        if (subObj) {
          const minsEst = Math.max(1, Math.round(projectedDist / (effectiveSpeedMps * 60)));
          await sendPushNotification(subObj, {
            title: `📍 Approaching ${alarm.target_stop_name || alarm.target_stop_code}`,
            body: `Estimated ~${minsEst} min away (~${projectedDist}m est.). Get ready or tap to check live GPS.`,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: `alight-pre-${alarm.id}`,
            data: {
              type: 'ALIGHT_PRE_ALERT',
              alarmId: alarm.id,
              stopCode: alarm.target_stop_code,
              url: `/?alight=hud&stop=${encodeURIComponent(alarm.target_stop_code)}`,
            },
          });
        }
      }

      // Stage 2: High-Urgency Alight Trigger
      if (projectedDist <= alarm.threshold_meters) {
        const firedOk = await triggerAlightPushSequence(alarm, projectedDist, null);
        if (firedOk) triggeredCount++;
      } else {
        await supabase
          .from('pwa_alight_alarms')
          .update({
            tracking_mode: mode,
            estimated_distance_meters: projectedDist,
            pre_alert_fired: preAlertFired,
            metadata: meta,
            updated_at: nowIso,
          })
          .eq('id', alarm.id);
      }
    } catch (err) {
      console.error(`Error evaluating alight alarm ${alarm.id}:`, err);
    }
  }

  return {
    activeCount: alarms.length,
    triggeredCount,
    remainingCount: Math.max(0, alarms.length - triggeredCount),
  };
}

// Helper: Check all active unfired bus arrival alarms in Supabase & dispatch high-urgency FCM Web Push
async function runAlarmCheckPass() {
  const { data: alarms, error } = await supabase
    .from('pwa_bus_alarms')
    .select('id, endpoint, bus_stop_code, bus_stop_name, service_no, lead_mins')
    .eq('fired', false)
    .gt('expires_at', new Date().toISOString());

  if (error || !alarms || alarms.length === 0) {
    return { activeCount: 0, triggeredCount: 0, remainingCount: 0 };
  }

  let passTriggered = 0;

  for (const alarm of alarms) {
    try {
      const subscriptionObj = await resolveSubscriptionForEndpoint(alarm.endpoint);
      if (!subscriptionObj) continue;

      const ltaUrl = `${LTA_API_URL}/v3/BusArrival?BusStopCode=${encodeURIComponent(
        alarm.bus_stop_code
      )}&ServiceNo=${encodeURIComponent(alarm.service_no)}`;
      const ltaRes = await fetch(ltaUrl, {
        headers: { AccountKey: LTA_API_KEY, accept: 'application/json' },
      });

      if (ltaRes.ok) {
        const data = await ltaRes.json();
        const service = (data.Services || [])[0];
        if (service && service.NextBus?.EstimatedArrival) {
          const etaMins = calculateEtaMinutes(service.NextBus.EstimatedArrival);

          if (etaMins !== null && etaMins <= alarm.lead_mins) {
            const payload = {
              title: `🚌 Bus ${alarm.service_no} Arriving!`,
              body: `Arriving ${
                etaMins <= 0 ? 'now' : `in ${etaMins} mins`
              } at ${alarm.bus_stop_name || alarm.bus_stop_code}! Prepare to board.`,
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              tag: `bus-alarm-${alarm.id}-${Date.now()}`,
              data: {
                alarmId: alarm.id,
                stopCode: alarm.bus_stop_code,
                serviceNo: alarm.service_no,
                url: `/?stop=${alarm.bus_stop_code}`,
              },
            };

            const pushRes = await sendPushNotification(subscriptionObj, payload);

            if (pushRes.success) {
              await supabase
                .from('pwa_bus_alarms')
                .update({ fired: true })
                .eq('id', alarm.id);
              passTriggered++;

              // Send a second reinforcement push 2.5s later so Android OEM skins wake & ring reliably
              const reinforce = (async () => {
                await new Promise((r) => setTimeout(r, 2500));
                await sendPushNotification(subscriptionObj, {
                  ...payload,
                  tag: `bus-alarm-${alarm.id}-repeat-${Date.now()}`,
                }).catch(() => {});
              })();

              const edgeRuntime = (globalThis as any).EdgeRuntime;
              if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') {
                edgeRuntime.waitUntil(reinforce);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`Error processing alarm ${alarm.id}:`, err);
    }
  }

  return {
    activeCount: alarms.length,
    triggeredCount: passTriggered,
    remainingCount: Math.max(0, alarms.length - passTriggered),
  };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const jsonResponse = (data: any, status = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  };

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/pwa_api/, '');

  try {
    // 1. Get VAPID Public Key
    if (req.method === 'GET' && path.endsWith('/vapid-public-key')) {
      return jsonResponse({ publicKey: VAPID_PUBLIC_KEY });
    }

    // 2. Register or update Web Push subscription
    if (req.method === 'POST' && path.endsWith('/subscribe')) {
      const body = await req.json();
      const { endpoint, keys, mrt_lines = [], alert_filter = 'major' } = body;

      if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
        return jsonResponse({ error: 'Missing endpoint or subscription keys' }, 400);
      }

      const { error } = await supabase.from('pwa_push_subscriptions').upsert(
        {
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          mrt_lines,
          alert_filter,
          user_agent: req.headers.get('user-agent'),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' }
      );

      if (error) {
        console.error('Subscription DB error:', error);
        return jsonResponse({ error: error.message }, 500);
      }

      return jsonResponse({ ok: true });
    }

    // 2b. Test / Instant Relay Web Push
    if (req.method === 'POST' && path.endsWith('/test-push')) {
      const body = await req.json().catch(() => ({}));
      const endpoint = body.endpoint;

      const subObj = await resolveSubscriptionForEndpoint(endpoint || '');
      if (!subObj) {
        return jsonResponse({ error: 'No active push subscription found on server' }, 404);
      }

      const pushResult = await sendPushNotification(subObj, {
        title: body.title || '🚌 SG Bus Kaki Test Alert',
        body: body.body || 'Success! Web Push is working in the background on your phone! 🔔✨',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: body.tag || 'test-push-alert',
        data: {
          type: body.type || 'TEST_PUSH',
          url: body.url || '/',
        },
      });

      return jsonResponse({ ok: pushResult.success, result: pushResult });
    }

    // 3. Set Bus Arrival Alarm
    if (req.method === 'POST' && path.endsWith('/bus-alarm')) {
      const body = await req.json();
      const { endpoint, busStopCode, busStopName, serviceNo, leadMins = 3 } = body;

      if (!endpoint || !busStopCode || !serviceNo) {
        return jsonResponse({ error: 'Missing alarm parameters' }, 400);
      }

      const { data, error } = await supabase
        .from('pwa_bus_alarms')
        .insert({
          endpoint,
          bus_stop_code: busStopCode,
          bus_stop_name: busStopName,
          service_no: serviceNo,
          lead_mins: leadMins,
        })
        .select('id')
        .single();

      if (error) {
        console.error('Alarm DB insert error:', error);
        return jsonResponse({ error: error.message }, 500);
      }

      const edgeRuntime = (globalThis as any).EdgeRuntime;
      if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') {
        edgeRuntime.waitUntil(
          (async () => {
            await new Promise((r) => setTimeout(r, 4000));
            const p1 = await runAlarmCheckPass();
            if (p1.remainingCount > 0) {
              await new Promise((r) => setTimeout(r, 16000));
              await runAlarmCheckPass();
            }
          })()
        );
      }

      return jsonResponse({ ok: true, alarmId: data.id });
    }

    // 4. Delete Bus Arrival Alarm
    if (req.method === 'DELETE' && path.includes('/bus-alarm/')) {
      const id = path.split('/').pop();
      const endpoint = url.searchParams.get('endpoint');
      if (id) {
        let query = supabase.from('pwa_bus_alarms').delete().eq('id', id);
        if (endpoint) {
          query = query.eq('endpoint', endpoint);
        }
        await query;
      }
      return jsonResponse({ ok: true });
    }

    // =========================================================================
    // 4b. CLOUD ALIGHTING ALARM ENDPOINTS (Background Screen-Off Ride Tracking)
    // =========================================================================

    // Arm a new Cloud Alighting Alarm
    if (req.method === 'POST' && path.endsWith('/alight-alarm')) {
      const body = await req.json();
      const {
        endpoint,
        keys,
        targetStopCode,
        targetStopName,
        roadName = '',
        targetLat,
        targetLon,
        thresholdMeters = 500,
        trackingMode = 'auto_detect',
        serviceNo = null,
        direction = null,
        userLat = null,
        userLon = null,
        userSpeedMps = null,
      } = body;

      if (!endpoint || !targetStopCode || !isValidCoord(targetLat, targetLon)) {
        return jsonResponse({ error: 'Missing endpoint or valid destination coordinates' }, 400);
      }

      const nowIso = new Date().toISOString();

      // Atomic subscription upsert so FK constraint always succeeds in 1 round-trip
      if (keys && keys.p256dh && keys.auth) {
        await supabase.from('pwa_push_subscriptions').upsert(
          {
            endpoint,
            p256dh: keys.p256dh,
            auth: keys.auth,
            user_agent: req.headers.get('user-agent'),
            updated_at: nowIso,
          },
          { onConflict: 'endpoint' }
        );
      }

      // Clear any previous active alight alarms for this device endpoint
      await supabase.from('pwa_alight_alarms').delete().eq('endpoint', endpoint);

      const resolved = await resolveRideRouteAndVehicle({
        targetStopCode,
        targetLat: Number(targetLat),
        targetLon: Number(targetLon),
        userLat,
        userLon,
        requestedMode: trackingMode,
        requestedServiceNo: serviceNo,
        requestedDirection: direction,
      });

      const hasUserGps = isValidCoord(userLat, userLon);
      const initialDist = hasUserGps
        ? haversineMeters(Number(userLat), Number(userLon), Number(targetLat), Number(targetLon))
        : null;
      const safeThreshold = Math.min(Math.max(150, Number(thresholdMeters) || 500), 2000);
      const alreadyInsideThreshold = initialDist !== null && initialDist <= safeThreshold;

      const metadata: Record<string, any> = {
        candidates: resolved.candidatesMeta,
      };
      if (initialDist !== null) {
        metadata.anchor_distance_meters = initialDist;
      }
      if (resolved.vehicleLat && resolved.vehicleLon) {
        metadata.last_vehicle_lat = resolved.vehicleLat;
        metadata.last_vehicle_lon = resolved.vehicleLon;
        metadata.last_vehicle_at = Date.now();
      }

      const { data: inserted, error: insertErr } = await supabase
        .from('pwa_alight_alarms')
        .insert({
          endpoint,
          target_stop_code: targetStopCode,
          target_stop_name: targetStopName || `Stop ${targetStopCode}`,
          road_name: roadName,
          target_lat: Number(targetLat),
          target_lon: Number(targetLon),
          threshold_meters: safeThreshold,
          tracking_mode: resolved.trackingMode,
          service_no: resolved.serviceNo,
          direction: resolved.direction,
          boarding_stop_seq: resolved.boardingStopSeq,
          tracked_stop_seq: resolved.trackedStopSeq,
          target_stop_seq: resolved.targetStopSeq,
          stops_remaining: resolved.stopsRemaining,
          last_user_lat: hasUserGps ? Number(userLat) : null,
          last_user_lon: hasUserGps ? Number(userLon) : null,
          last_user_speed_mps:
            userSpeedMps !== null && !isNaN(Number(userSpeedMps)) && Number(userSpeedMps) >= 0
              ? Number(userSpeedMps)
              : null,
          last_user_sync_at: hasUserGps ? nowIso : null,
          estimated_distance_meters: initialDist,
          candidate_services: resolved.candidateServices,
          metadata,
          fired: alreadyInsideThreshold,
          updated_at: nowIso,
        })
        .select('*')
        .single();

      if (insertErr) {
        console.error('Alight alarm insert error:', insertErr);
        return jsonResponse({ error: insertErr.message }, 500);
      }

      // Kick off immediate sub-minute check passes (+10s, +28s) in case user locks phone right away
      if (!alreadyInsideThreshold) {
        const edgeRuntime = (globalThis as any).EdgeRuntime;
        if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') {
          edgeRuntime.waitUntil(
            (async () => {
              await new Promise((r) => setTimeout(r, 10000));
              const p1 = await runAlightAlarmCheckPass();
              if (p1.remainingCount > 0) {
                await new Promise((r) => setTimeout(r, 18000));
                await runAlightAlarmCheckPass();
              }
            })()
          );
        }
      }

      return jsonResponse({ ok: true, alarm: inserted });
    }

    // Heartbeat / Mode Override / Visibility-Hide Telemetry Sync
    if (req.method === 'POST' && path.endsWith('/alight-alarm/heartbeat')) {
      const body = await req.json();
      const {
        alarmId,
        endpoint,
        userLat,
        userLon,
        userSpeedMps,
        thresholdMeters,
        overrideMode,
        overrideServiceNo,
        overrideDirection,
      } = body;

      let query = supabase
        .from('pwa_alight_alarms')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);

      if (alarmId) {
        query = supabase.from('pwa_alight_alarms').select('*').eq('id', alarmId);
      } else if (endpoint) {
        query = query.eq('endpoint', endpoint);
      } else {
        return jsonResponse({ error: 'Missing alarmId or endpoint' }, 400);
      }

      const { data: alarm } = await query.maybeSingle();
      if (!alarm) {
        return jsonResponse({ ok: false, expired: true, alarm: null });
      }

      const nowIso = new Date().toISOString();
      const nowMs = Date.now();
      const meta = (alarm.metadata && typeof alarm.metadata === 'object') ? { ...alarm.metadata } : {};

      const hasFreshGps = isValidCoord(userLat, userLon);
      const effLat = hasFreshGps ? Number(userLat) : alarm.last_user_lat;
      const effLon = hasFreshGps ? Number(userLon) : alarm.last_user_lon;
      const effThreshold =
        thresholdMeters !== undefined
          ? Math.min(Math.max(150, Number(thresholdMeters) || 500), 2000)
          : alarm.threshold_meters;

      let nextMode = alarm.tracking_mode;
      let nextService = alarm.service_no;
      let nextDir = alarm.direction;
      let nextBoardSeq = alarm.boarding_stop_seq;
      let nextTrackedSeq = alarm.tracked_stop_seq;
      let nextTargetSeq = alarm.target_stop_seq;
      let nextStopsRemaining = alarm.stops_remaining;
      let nextCandidates = alarm.candidate_services || [];

      // Handle explicit commuter mode/bus switch from ActiveRideHUD pills
      if (overrideMode || overrideServiceNo !== undefined) {
        const reResolved = await resolveRideRouteAndVehicle({
          targetStopCode: alarm.target_stop_code,
          targetLat: alarm.target_lat,
          targetLon: alarm.target_lon,
          userLat: effLat,
          userLon: effLon,
          requestedMode: overrideMode || (overrideServiceNo ? 'bus_locked' : 'auto_detect'),
          requestedServiceNo: overrideServiceNo || null,
          requestedDirection: overrideDirection || null,
        });
        nextMode = reResolved.trackingMode;
        nextService = reResolved.serviceNo;
        nextDir = reResolved.direction;
        nextBoardSeq = reResolved.boardingStopSeq;
        nextTrackedSeq = reResolved.trackedStopSeq;
        nextTargetSeq = reResolved.targetStopSeq;
        nextStopsRemaining = reResolved.stopsRemaining;
        if (reResolved.candidateServices.length > 0) {
          nextCandidates = reResolved.candidateServices;
        }
        meta.candidates = reResolved.candidatesMeta;
        delete meta.last_vehicle_lat;
        delete meta.last_vehicle_lon;
      }

      // Compute updated distance & smoothed approach speed when fresh foreground GPS arrives
      let nextDist = alarm.estimated_distance_meters;
      let nextSpeed = alarm.last_user_speed_mps;

      if (hasFreshGps) {
        const freshDist = haversineMeters(
          Number(userLat),
          Number(userLon),
          alarm.target_lat,
          alarm.target_lon
        );
        nextDist = freshDist;
        meta.anchor_distance_meters = freshDist;

        if (userSpeedMps !== null && userSpeedMps !== undefined && Number(userSpeedMps) > 1.2) {
          const reported = Number(userSpeedMps);
          nextSpeed = nextSpeed ? nextSpeed * 0.4 + reported * 0.6 : reported;
        } else if (
          isValidCoord(alarm.last_user_lat, alarm.last_user_lon) &&
          alarm.last_user_sync_at
        ) {
          const dt = (nowMs - new Date(alarm.last_user_sync_at).getTime()) / 1000;
          if (dt >= 4 && dt <= 180) {
            const prevDist = haversineMeters(
              Number(alarm.last_user_lat),
              Number(alarm.last_user_lon),
              alarm.target_lat,
              alarm.target_lon
            );
            const approachRate = (prevDist - freshDist) / dt;
            if (approachRate >= 1.5 && approachRate <= 30) {
              nextSpeed = nextSpeed ? nextSpeed * 0.45 + approachRate * 0.55 : approachRate;
            }
          }
        }

        // Also advance tracked_stop_seq using real foreground GPS if locked onto a bus route
        if (nextMode === 'bus_locked' && nextService && nextTargetSeq) {
          const routeStops = await fetchEnrichedRouteStops(nextService, nextDir);
          if (routeStops.length > 0) {
            let closestStop: RouteStopEnriched | null = null;
            let minD = Infinity;
            for (const rs of routeStops) {
              if (rs.stop_sequence <= nextTargetSeq) {
                const d = haversineMeters(Number(userLat), Number(userLon), rs.latitude, rs.longitude);
                if (d < minD) {
                  minD = d;
                  closestStop = rs;
                }
              }
            }
            if (closestStop && minD <= 500) {
              nextTrackedSeq = Math.max(nextTrackedSeq || 1, closestStop.stop_sequence);
              nextStopsRemaining = Math.max(0, nextTargetSeq - nextTrackedSeq);
            }
          }
        }
      }

      if (nextDist !== null && nextDist <= effThreshold && !alarm.fired) {
        await triggerAlightPushSequence(
          { ...alarm, service_no: nextService, threshold_meters: effThreshold },
          nextDist,
          nextStopsRemaining
        );
        const { data: firedRow } = await supabase
          .from('pwa_alight_alarms')
          .select('*')
          .eq('id', alarm.id)
          .maybeSingle();
        return jsonResponse({ ok: true, alarm: firedRow });
      }

      const { data: updated, error: updErr } = await supabase
        .from('pwa_alight_alarms')
        .update({
          threshold_meters: effThreshold,
          tracking_mode: nextMode,
          service_no: nextService,
          direction: nextDir,
          boarding_stop_seq: nextBoardSeq,
          tracked_stop_seq: nextTrackedSeq,
          target_stop_seq: nextTargetSeq,
          stops_remaining: nextStopsRemaining,
          last_user_lat: effLat,
          last_user_lon: effLon,
          last_user_speed_mps: nextSpeed,
          last_user_sync_at: hasFreshGps ? nowIso : alarm.last_user_sync_at,
          estimated_distance_meters: nextDist,
          candidate_services: nextCandidates,
          metadata: meta,
          updated_at: nowIso,
        })
        .eq('id', alarm.id)
        .select('*')
        .single();

      if (updErr) {
        return jsonResponse({ error: updErr.message }, 500);
      }

      return jsonResponse({ ok: true, alarm: updated });
    }

    // Fetch Active Alight Alarm Status (on app resume / visibility restore)
    if (req.method === 'GET' && path.endsWith('/alight-alarm/status')) {
      const endpoint = url.searchParams.get('endpoint');
      const alarmId = url.searchParams.get('id');

      if (!endpoint && !alarmId) {
        return jsonResponse({ ok: true, alarm: null });
      }

      let query = supabase
        .from('pwa_alight_alarms')
        .select('*')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1);

      if (alarmId) {
        query = query.eq('id', alarmId);
      } else if (endpoint) {
        query = query.eq('endpoint', endpoint);
      }

      const { data: alarm } = await query.maybeSingle();
      return jsonResponse({ ok: true, alarm: alarm || null });
    }

    // Cancel / Dismiss Active Alight Alarm (from HUD or Lock-Screen Service Worker Action)
    if (
      (req.method === 'DELETE' && path.includes('/alight-alarm/')) ||
      (req.method === 'POST' && path.endsWith('/alight-alarm/cancel'))
    ) {
      let id = path.includes('/alight-alarm/') ? path.split('/').pop() : null;
      let endpoint = url.searchParams.get('endpoint');

      if (req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        id = body.alarmId || id;
        endpoint = body.endpoint || endpoint;
      }

      if (id && id !== 'cancel') {
        let query = supabase.from('pwa_alight_alarms').delete().eq('id', id);
        if (endpoint) {
          query = query.eq('endpoint', endpoint);
        }
        await query;
      } else if (endpoint) {
        await supabase.from('pwa_alight_alarms').delete().eq('endpoint', endpoint);
      }

      return jsonResponse({ ok: true });
    }

    // 5. Get Live Bus Arrivals
    if (req.method === 'GET' && path.endsWith('/bus-arrivals')) {
      const stopCode = url.searchParams.get('stop');
      if (!stopCode) {
        return jsonResponse({ error: 'Missing stop parameter' }, 400);
      }

      const ltaUrl = `${LTA_API_URL}/v3/BusArrival?BusStopCode=${encodeURIComponent(stopCode)}`;
      const ltaRes = await fetch(ltaUrl, {
        headers: { AccountKey: LTA_API_KEY, accept: 'application/json' },
      });

      if (!ltaRes.ok) {
        return jsonResponse({ error: 'Failed to fetch from LTA DataMall', status: ltaRes.status }, 502);
      }

      const ltaData = await ltaRes.json();
      const rawServices = ltaData.Services || [];

      const services = rawServices.map((s: any) => {
        const nextBus = {
          estimatedArrival: s.NextBus?.EstimatedArrival || '',
          etaMinutes: calculateEtaMinutes(s.NextBus?.EstimatedArrival),
          load: s.NextBus?.Load || '',
          feature: s.NextBus?.Feature || '',
          type: s.NextBus?.Type || '',
          latitude: parseFloat(s.NextBus?.Latitude) || undefined,
          longitude: parseFloat(s.NextBus?.Longitude) || undefined,
        };

        const nextBus2 = s.NextBus2?.EstimatedArrival
          ? {
              estimatedArrival: s.NextBus2.EstimatedArrival,
              etaMinutes: calculateEtaMinutes(s.NextBus2.EstimatedArrival),
              load: s.NextBus2.Load || '',
              feature: s.NextBus2.Feature || '',
              type: s.NextBus2.Type || '',
              latitude: parseFloat(s.NextBus2?.Latitude) || undefined,
              longitude: parseFloat(s.NextBus2?.Longitude) || undefined,
            }
          : undefined;

        const nextBus3 = s.NextBus3?.EstimatedArrival
          ? {
              estimatedArrival: s.NextBus3.EstimatedArrival,
              etaMinutes: calculateEtaMinutes(s.NextBus3.EstimatedArrival),
              load: s.NextBus3.Load || '',
              feature: s.NextBus3.Feature || '',
              type: s.NextBus3.Type || '',
              latitude: parseFloat(s.NextBus3?.Latitude) || undefined,
              longitude: parseFloat(s.NextBus3?.Longitude) || undefined,
            }
          : undefined;

        return {
          serviceNo: s.ServiceNo,
          operator: s.Operator,
          nextBus,
          nextBus2,
          nextBus3,
        };
      });

      services.sort((a: any, b: any) =>
        a.serviceNo.localeCompare(b.serviceNo, undefined, { numeric: true, sensitivity: 'base' })
      );

      return jsonResponse({ ok: true, busStopCode: stopCode, services });
    }

    // 6. Nearby Bus Stops (bounded limit to prevent DoS)
    if (req.method === 'GET' && path.endsWith('/bus-nearby')) {
      const lat = parseFloat(url.searchParams.get('lat') || '1.35');
      const lon = parseFloat(url.searchParams.get('lon') || '103.82');
      const rawLimit = parseInt(url.searchParams.get('limit') || '15', 10);
      const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 15 : rawLimit), 50);

      const latDelta = 0.035;
      const lonDelta = 0.035;

      const { data: stops, error } = await supabase
        .from('lta_bus_stops')
        .select('bus_stop_code, road_name, description, latitude, longitude')
        .gte('latitude', lat - latDelta)
        .lte('latitude', lat + latDelta)
        .gte('longitude', lon - lonDelta)
        .lte('longitude', lon + lonDelta);

      if (error || !stops) {
        return jsonResponse({ stops: [] });
      }

      const withDistance = stops.map((s: any) => ({
        ...s,
        distance: haversineMeters(lat, lon, s.latitude, s.longitude),
      }));

      withDistance.sort((a: any, b: any) => a.distance - b.distance);
      return jsonResponse({ stops: withDistance.slice(0, limit) });
    }

    // 7. Bus Search (sanitized against PostgREST filter injection)
    if (req.method === 'GET' && path.endsWith('/bus-search')) {
      const rawQ = url.searchParams.get('q') || '';
      const q = rawQ.replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
      if (!q) return jsonResponse({ stops: [] });

      const { data: stops } = await supabase
        .from('lta_bus_stops')
        .select('bus_stop_code, road_name, description, latitude, longitude')
        .or(`bus_stop_code.ilike.%${q}%,road_name.ilike.%${q}%,description.ilike.%${q}%`)
        .limit(25);

      return jsonResponse({ stops: stops || [] });
    }

    // 8. Bus Route Sequence
    if (req.method === 'GET' && path.endsWith('/bus-route')) {
      const service = (url.searchParams.get('service') || '').trim();
      const direction = parseInt(url.searchParams.get('direction') || '1', 10);

      const { data: routes } = await supabase
        .from('lta_bus_routes')
        .select('service_no, direction, stop_sequence, bus_stop_code, distance, wd_first_bus, wd_last_bus, sat_first_bus, sat_last_bus, sun_first_bus, sun_last_bus')
        .eq('service_no', service)
        .eq('direction', direction)
        .order('stop_sequence', { ascending: true });

      if (!routes || routes.length === 0) {
        return jsonResponse({ stops: [] });
      }

      const stopCodes = routes.map((r: any) => r.bus_stop_code);
      const { data: stops } = await supabase
        .from('lta_bus_stops')
        .select('bus_stop_code, description, road_name, latitude, longitude')
        .in('bus_stop_code', stopCodes);

      const stopMap = new Map((stops || []).map((s: any) => [s.bus_stop_code, s]));

      const enriched = routes.map((r: any) => {
        const s: any = stopMap.get(r.bus_stop_code);
        return {
          ...r,
          description: s?.description || `Stop ${r.bus_stop_code}`,
          road_name: s?.road_name || '',
          latitude: s?.latitude,
          longitude: s?.longitude,
        };
      });

      return jsonResponse({ stops: enriched });
    }

    // 9. Train Service Alerts
    if (req.method === 'GET' && path.endsWith('/train-alerts')) {
      try {
        const ltaRes = await fetch(`${LTA_API_URL}/TrainServiceAlerts`, {
          headers: { AccountKey: LTA_API_KEY },
        });
        if (ltaRes.ok) {
          const alertData = await ltaRes.json();
          return jsonResponse(alertData.value || { status: 1, message: 'Normal' });
        }
      } catch (err) {
        console.warn('Train alert fetch error:', err);
      }
      return jsonResponse({ status: 1, message: 'All MRT lines normal' });
    }

    // 10. Cron Worker: Check active arrival & alighting alarms every 20s (0s, +20s, +40s)
    if ((req.method === 'POST' || req.method === 'GET') && path.endsWith('/cron-check')) {
      const authHeader = req.headers.get('authorization') || '';
      const envCronSecret = Deno.env.get('CRON_SECRET') || '';
      const pwaCronSecret = '73413d5806fa4253b87a505def85c94b1f412a6927494e6cb2799c056dd0ccbc';

      const isAuthorized =
        authHeader === `Bearer ${pwaCronSecret}` ||
        (envCronSecret.length > 0 && authHeader === `Bearer ${envCronSecret}`);

      if (!isAuthorized) {
        return jsonResponse({ error: 'Unauthorized cron invocation' }, 401);
      }

      // Pass 1 (at 0s of cron minute) — evaluates both Bus Arrival Alarms and Alighting Ride Alarms
      const [busPass1, alightPass1] = await Promise.all([
        runAlarmCheckPass(),
        runAlightAlarmCheckPass(),
      ]);

      const totalRemaining1 = busPass1.remainingCount + alightPass1.remainingCount;

      // Schedule Pass 2 (+20s) and Pass 3 (+40s) in background if unfired alarms remain
      if (totalRemaining1 > 0) {
        const bgFollowUp = (async () => {
          try {
            await new Promise((resolve) => setTimeout(resolve, 20000));
            const [busPass2, alightPass2] = await Promise.all([
              runAlarmCheckPass(),
              runAlightAlarmCheckPass(),
            ]);
            if (busPass2.remainingCount + alightPass2.remainingCount > 0) {
              await new Promise((resolve) => setTimeout(resolve, 20000));
              await Promise.all([runAlarmCheckPass(), runAlightAlarmCheckPass()]);
            }
          } catch (err) {
            console.error('Background sub-minute alarm check error:', err);
          }
        })();

        const edgeRuntime = (globalThis as any).EdgeRuntime;
        if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') {
          edgeRuntime.waitUntil(bgFollowUp);
        }
      }

      return jsonResponse({
        ok: true,
        processedAlarms: busPass1.activeCount,
        triggeredCount: busPass1.triggeredCount,
        remainingCount: busPass1.remainingCount,
        alightProcessed: alightPass1.activeCount,
        alightTriggered: alightPass1.triggeredCount,
        alightRemaining: alightPass1.remainingCount,
      });
    }

    return jsonResponse({ message: 'SG Bus Kaki PWA Backend API Active 🚌' });
  } catch (globalErr: any) {
    console.error('Unhandled server error:', globalErr);
    return jsonResponse({ error: globalErr?.message || 'Server error' }, 500);
  }
});
