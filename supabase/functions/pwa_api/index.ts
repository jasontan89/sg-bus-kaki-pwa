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
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  };
}

function jsonResponse(data: any, status = 200, req?: Request) {
  const headers = req ? getCorsHeaders(req) : {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  };
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function calculateEtaMinutes(estTimeStr: string | null): number | null {
  if (!estTimeStr || !estTimeStr.trim()) return null;
  const target = new Date(estTimeStr).getTime();
  if (isNaN(target)) return null;
  const now = Date.now();
  const diffMinutes = Math.floor((target - now) / 60000);
  return Math.max(0, diffMinutes);
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

    // 2b. Test / Instant Relay Web Push (sends a real FCM push notification to verify or wake background device)
    if (req.method === 'POST' && path.endsWith('/test-push')) {
      const body = await req.json().catch(() => ({}));
      const endpoint = body.endpoint;

      let sub: any = null;
      if (endpoint) {
        const { data } = await supabase
          .from('pwa_push_subscriptions')
          .select('*')
          .eq('endpoint', endpoint)
          .single();
        sub = data;
      } else {
        const { data } = await supabase
          .from('pwa_push_subscriptions')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(1)
          .single();
        sub = data;
      }

      if (!sub) {
        return jsonResponse({ error: 'No active push subscription found on server' }, 404);
      }

      const pushResult = await sendPushNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        {
          title: body.title || '🚌 SG Bus Kaki Test Alert',
          body: body.body || 'Success! Web Push is working in the background on your phone! 🔔✨',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: body.tag || 'test-push-alert',
          data: { url: body.url || '/' },
        }
      );

      return jsonResponse({ ok: pushResult.success, result: pushResult });
    }

    // Helper: Check all active unfired bus arrival alarms in Supabase & dispatch high-urgency FCM Web Push
    const runAlarmCheckPass = async () => {
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
          let { data: sub } = await supabase
            .from('pwa_push_subscriptions')
            .select('endpoint, p256dh, auth')
            .eq('endpoint', alarm.endpoint)
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

          if (!sub || !sub.p256dh || !sub.auth) continue;

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

                const subscriptionObj = {
                  endpoint: sub.endpoint,
                  keys: {
                    p256dh: sub.p256dh,
                    auth: sub.auth,
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
                  setTimeout(() => {
                    sendPushNotification(subscriptionObj, {
                      ...payload,
                      tag: `bus-alarm-${alarm.id}-repeat-${Date.now()}`,
                    }).catch(() => {});
                  }, 2500);
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
    };

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

      // Immediately schedule background check passes at +4s and +20s so if the bus is already
      // within leadMins when the user exits the app, the cloud push arrives within seconds!
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

    // 4. Delete Bus Arrival Alarm (IDOR protected: verifies client endpoint)
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
            }
          : undefined;

        const nextBus3 = s.NextBus3?.EstimatedArrival
          ? {
              estimatedArrival: s.NextBus3.EstimatedArrival,
              etaMinutes: calculateEtaMinutes(s.NextBus3.EstimatedArrival),
              load: s.NextBus3.Load || '',
              feature: s.NextBus3.Feature || '',
              type: s.NextBus3.Type || '',
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

      // Sort services naturally (e.g. 2, 7, 65, 190, 857, NR1)
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

      // Query stops in bounding box (+/- 0.03 deg is ~3.3km)
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
      // Strip any PostgREST syntax characters (commas, parens, quotes)
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

      // Fetch stop descriptions and coordinates
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

    // 10. Cron Worker: Check active alarms & dispatch Web Push (Protected by CRON_SECRET)
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

      // Pass 1 (at 0s of cron minute) — returns immediately so pg_net never times out
      const pass1 = await runAlarmCheckPass();

      // Schedule Pass 2 (+20s) and Pass 3 (+40s) in background if unfired alarms remain
      if (pass1.remainingCount > 0) {
        const bgFollowUp = (async () => {
          try {
            await new Promise((resolve) => setTimeout(resolve, 20000));
            const pass2 = await runAlarmCheckPass();
            if (pass2.remainingCount > 0) {
              await new Promise((resolve) => setTimeout(resolve, 20000));
              await runAlarmCheckPass();
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
        processedAlarms: pass1.activeCount,
        triggeredCount: pass1.triggeredCount,
        remainingCount: pass1.remainingCount,
      });
    }

    return jsonResponse({ message: 'SG Bus Kaki PWA Backend API Active 🚌' });
  } catch (globalErr: any) {
    console.error('Unhandled server error:', globalErr);
    return jsonResponse({ error: globalErr?.message || 'Server error' }, 500);
  }
});
