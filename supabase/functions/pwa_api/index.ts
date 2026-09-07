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
  'vBe1lm0lQc2G5wIoeSJwpQ==';

const VAPID_PUBLIC_KEY =
  Deno.env.get('VAPID_PUBLIC_KEY') ||
  'BOf8CICk12spIImcvztWy2XrTNW2iOsrbCNLYl4zbT4wGI9NEPsAvYzRNInigEMg9E-6vP4fJBAsec3kDLIw70U';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function calculateEtaMinutes(estTimeStr: string | null): number | null {
  if (!estTimeStr || !estTimeStr.trim()) return null;
  const target = new Date(estTimeStr).getTime();
  if (isNaN(target)) return null;
  const now = Date.now();
  const diffMinutes = Math.round((target - now) / 60000);
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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

      return jsonResponse({ ok: true, alarmId: data.id });
    }

    // 4. Delete Bus Arrival Alarm
    if (req.method === 'DELETE' && path.includes('/bus-alarm/')) {
      const id = path.split('/').pop();
      if (id) {
        await supabase.from('pwa_bus_alarms').delete().eq('id', id);
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

    // 6. Nearby Bus Stops
    if (req.method === 'GET' && path.endsWith('/bus-nearby')) {
      const lat = parseFloat(url.searchParams.get('lat') || '1.35');
      const lon = parseFloat(url.searchParams.get('lon') || '103.82');
      const limit = parseInt(url.searchParams.get('limit') || '15', 10);

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

    // 7. Bus Search
    if (req.method === 'GET' && path.endsWith('/bus-search')) {
      const q = (url.searchParams.get('q') || '').trim();
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

      // Fetch stop descriptions
      const stopCodes = routes.map((r: any) => r.bus_stop_code);
      const { data: stops } = await supabase
        .from('lta_bus_stops')
        .select('bus_stop_code, description, road_name')
        .in('bus_stop_code', stopCodes);

      const stopMap = new Map((stops || []).map((s: any) => [s.bus_stop_code, s]));

      const enriched = routes.map((r: any) => {
        const s: any = stopMap.get(r.bus_stop_code);
        return {
          ...r,
          description: s?.description || `Stop ${r.bus_stop_code}`,
          road_name: s?.road_name || '',
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

    // 10. Cron Worker: Check active alarms & dispatch Web Push
    if (req.method === 'POST' && path.endsWith('/cron-check')) {
      // Find unfired alarms
      const { data: alarms, error } = await supabase
        .from('pwa_bus_alarms')
        .select(`
          id,
          endpoint,
          bus_stop_code,
          bus_stop_name,
          service_no,
          lead_mins,
          pwa_push_subscriptions!inner (
            p256dh,
            auth
          )
        `)
        .eq('fired', false)
        .gt('expires_at', new Date().toISOString());

      if (error) {
        return jsonResponse({ error: error.message }, 500);
      }

      let triggeredCount = 0;

      for (const alarm of alarms || []) {
        try {
          // Fetch arrival for stop
          const ltaUrl = `${LTA_API_URL}/v3/BusArrival?BusStopCode=${encodeURIComponent(alarm.bus_stop_code)}&ServiceNo=${encodeURIComponent(alarm.service_no)}`;
          const ltaRes = await fetch(ltaUrl, {
            headers: { AccountKey: LTA_API_KEY, accept: 'application/json' },
          });

          if (ltaRes.ok) {
            const data = await ltaRes.json();
            const service = (data.Services || [])[0];
            if (service && service.NextBus?.EstimatedArrival) {
              const etaMins = calculateEtaMinutes(service.NextBus.EstimatedArrival);

              if (etaMins !== null && etaMins <= alarm.lead_mins) {
                // Trigger Web Push!
                const subKeys = (alarm as any).pwa_push_subscriptions;
                const pushRes = await sendPushNotification(
                  {
                    endpoint: alarm.endpoint,
                    keys: {
                      p256dh: subKeys.p256dh,
                      auth: subKeys.auth,
                    },
                  },
                  {
                    title: `🚌 Bus ${alarm.service_no} Arriving!`,
                    body: `Arriving in ${etaMins <= 0 ? 'now' : `${etaMins} mins`} at ${alarm.bus_stop_name || alarm.bus_stop_code}.`,
                    icon: '/icon-192.png',
                    badge: '/favicon.svg',
                    tag: `bus-alarm-${alarm.id}`,
                    data: {
                      stopCode: alarm.bus_stop_code,
                      serviceNo: alarm.service_no,
                      url: `/?stop=${alarm.bus_stop_code}`,
                    },
                  }
                );

                if (pushRes.success) {
                  await supabase
                    .from('pwa_bus_alarms')
                    .update({ fired: true })
                    .eq('id', alarm.id);
                  triggeredCount++;
                }
              }
            }
          }
        } catch (err) {
          console.error(`Error processing alarm ${alarm.id}:`, err);
        }
      }

      return jsonResponse({ ok: true, processedAlarms: (alarms || []).length, triggeredCount });
    }

    return jsonResponse({ message: 'SG Bus Kaki PWA Backend API Active 🚌' });
  } catch (globalErr: any) {
    console.error('Unhandled server error:', globalErr);
    return jsonResponse({ error: globalErr?.message || 'Server error' }, 500);
  }
});
