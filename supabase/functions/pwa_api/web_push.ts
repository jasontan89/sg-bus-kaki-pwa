// @ts-ignore npm specifier supported by Deno Edge Runtime
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC_KEY =
  Deno.env.get('VAPID_PUBLIC_KEY') ||
  'BOf8CICk12spIImcvztWy2XrTNW2iOsrbCNLYl4zbT4wGI9NEPsAvYzRNInigEMg9E-6vP4fJBAsec3kDLIw70U';

const VAPID_PRIVATE_KEY =
  Deno.env.get('VAPID_PRIVATE_KEY') ||
  '45DtCTZ6Uuk3B1b-yXO37p163rq9kI5b4ojWwZDAR_Y';

const VAPID_SUBJECT =
  Deno.env.get('VAPID_SUBJECT') || 'mailto:tansooneejason@gmail.com';

// Configure VAPID credentials
try {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch (err) {
  console.warn('VAPID setup warning:', err);
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, any>;
}

export async function sendPushNotification(
  subscription: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  },
  payload: PushNotificationPayload
) {
  try {
    const stringified = JSON.stringify(payload);
    const result = await webpush.sendNotification(subscription, stringified);
    return { success: true, statusCode: result.statusCode };
  } catch (err: any) {
    console.error('Failed to send push notification:', err?.statusCode, err?.message);
    return { success: false, error: err?.message, statusCode: err?.statusCode };
  }
}
