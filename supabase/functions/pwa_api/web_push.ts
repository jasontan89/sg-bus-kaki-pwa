// @ts-ignore npm specifier supported by Deno Edge Runtime
import webpush from 'npm:web-push@3.6.7';

// Load VAPID credentials safely with environment override support
const VAPID_PUBLIC_KEY =
  Deno.env.get('VAPID_PUBLIC_KEY') ||
  'BHSw8VkpCSgUdC1_XRhHMvLMdm7w-VhRH_tahYM2ZXOBAhQ2A80SPwEvakojni6fs7gT3R_ke7ZKspb6w79rBw8';
const VAPID_PRIVATE_KEY =
  Deno.env.get('VAPID_PRIVATE_KEY') ||
  '0NjJb44lF_ejmjnJcudihhCFMs2mGaDh6KmTyT8BhdU';
const VAPID_SUBJECT =
  Deno.env.get('VAPID_SUBJECT') ||
  'mailto:support@sgbuskaki.app';

// Configure VAPID credentials safely
let vapidConfigured = false;
if (VAPID_SUBJECT && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidConfigured = true;
    console.log('VAPID Web Push initialized successfully.');
  } catch (err) {
    console.error('Failed to configure VAPID details:', err);
  }
} else {
  console.warn('VAPID credentials not fully configured in environment secrets.');
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
  if (!vapidConfigured) {
    return { success: false, error: 'VAPID credentials not configured on server' };
  }

  try {
    const stringified = JSON.stringify(payload);
    const result = await webpush.sendNotification(subscription, stringified);
    return { success: true, statusCode: result.statusCode };
  } catch (err: any) {
    console.error('Failed to send push notification:', err?.statusCode, err?.message);
    return { success: false, error: err?.message, statusCode: err?.statusCode };
  }
}
