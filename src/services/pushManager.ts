/**
 * SG Bus Kaki - W3C Web Push Notification Manager
 * Handles VAPID key encoding, PushManager subscriptions, and Android notification permissions.
 */

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function getNotificationPermission(): NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isPushSupported()) {
    return 'denied';
  }
  return await Notification.requestPermission();
}

/**
 * Converts standard or base64url string to Uint8Array for PushManager applicationServerKey
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Subscribes commuter device to Web Push via Service Worker
 */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription | null> {
  if (!isPushSupported()) {
    console.warn('Web Push not supported on this browser');
    return null;
  }

  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission not granted');
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertedVapidKey as any,
    });
  }

  return subscription;
}

/**
 * Fetches current active Web Push subscription (if any)
 */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch (err) {
    console.warn('Error checking push subscription:', err);
    return null;
  }
}

/**
 * Unsubscribes from Web Push
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const subscription = await getCurrentSubscription();
    if (subscription) {
      return await subscription.unsubscribe();
    }
    return false;
  } catch (err) {
    console.warn('Error unsubscribing from push:', err);
    return false;
  }
}

/**
 * Serializes subscription keys to base64 for backend storage
 */
export function serializeSubscription(subscription: PushSubscription) {
  const rawKey = subscription.getKey ? subscription.getKey('p256dh') : null;
  const rawAuth = subscription.getKey ? subscription.getKey('auth') : null;

  const p256dh = rawKey
    ? btoa(String.fromCharCode(...new Uint8Array(rawKey)))
    : '';
  const auth = rawAuth
    ? btoa(String.fromCharCode(...new Uint8Array(rawAuth)))
    : '';

  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh,
      auth,
    },
  };
}
