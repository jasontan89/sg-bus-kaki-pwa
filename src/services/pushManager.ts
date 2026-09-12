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
 * Subscribes commuter device to Web Push via Service Worker.
 * Automatically validates and rotates stale subscriptions if the backend VAPID key changed.
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
  const targetKeyBytes = urlBase64ToUint8Array(vapidPublicKey);

  // If subscription already exists, check if it was signed with the current VAPID key
  if (subscription) {
    try {
      const existingKey = subscription.options?.applicationServerKey;
      let isKeyMatch = false;

      if (existingKey) {
        const existingBytes = new Uint8Array(existingKey);
        if (existingBytes.length === targetKeyBytes.length) {
          isKeyMatch = existingBytes.every((b, i) => b === targetKeyBytes[i]);
        }
      }

      // If the VAPID key differs (e.g. after security rotation), unsubscribe stale endpoint
      if (!isKeyMatch) {
        console.info('Stale VAPID key subscription detected. Rotating to current credentials...');
        await subscription.unsubscribe();
        subscription = null;
      }
    } catch (checkErr) {
      console.warn('Could not verify existing subscription key, refreshing:', checkErr);
      if (subscription) {
        await (subscription as PushSubscription).unsubscribe().catch(() => {});
        subscription = null;
      }
    }
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: targetKeyBytes as any,
    });
    console.info('Fresh Web Push subscription created successfully with active VAPID key.');
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

/**
 * Dispatches a native OS notification.
 * On modern Android Chrome, new Notification() in window scope is forbidden and throws:
 * "Failed to construct 'Notification': Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead."
 * This helper uses navigator.serviceWorker.ready.showNotification() to guarantee native lock-screen delivery.
 */
export async function dispatchNativeNotification(
  title: string,
  options: any = {}
): Promise<boolean> {
  // Trigger tactile vibration immediately if supported
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(options.vibrate || [500, 250, 500, 250, 1000]);
    } catch {
      // Safe fail
    }
  }

  // Check notification support
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  // Request or check permission
  if (Notification.permission !== 'granted') {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return false;
    } catch {
      return false;
    }
  }

  const defaultOptions: any = {
    icon: '/bus-mascot.svg',
    badge: '/bus-mascot.svg',
    vibrate: [500, 250, 500, 250, 1000],
    requireInteraction: true,
    ...options,
  };

  // Primary: Use Service Worker registration (Android Chrome requirement)
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, defaultOptions);
        return true;
      }
    } catch (swErr) {
      console.warn('SW showNotification fallback needed:', swErr);
    }
  }

  // Fallback: Window Notification for desktop browsers
  try {
    new Notification(title, defaultOptions);
    return true;
  } catch (winErr) {
    console.warn('Window Notification failed:', winErr);
  }

  return false;
}
