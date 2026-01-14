/**
 * Apple Subscription Management
 * Handles Apple auto-renewable subscription verification and status tracking
 */

import * as admin from 'firebase-admin';
import { firestore } from '../config/firestore';
import { getUserDocument } from '../longevity/longevityStore';

export type SubscriptionStatus = 'active' | 'expired';
export type SubscriptionPlan = 'membership_monthly' | 'membership_yearly';

export interface SubscriptionState {
  status: SubscriptionStatus;
  plan: SubscriptionPlan;
  renewalDate: string; // ISO date string
  originalTransactionId: string;
}

export interface AppleReceiptResponse {
  status: number;
  receipt?: {
    in_app?: Array<{
      original_transaction_id: string;
      product_id: string;
      expires_date_ms?: string;
      expires_date?: string;
      transaction_id: string;
    }>;
  };
  latest_receipt_info?: Array<{
    original_transaction_id: string;
    product_id: string;
    expires_date_ms?: string;
    expires_date?: string;
    transaction_id: string;
  }>;
  pending_renewal_info?: Array<{
    original_transaction_id: string;
    auto_renew_status: string;
  }>;
}

// Apple receipt validation endpoints
const APPLE_PRODUCTION_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';

// App Store shared secret (from App Store Connect)
// Should be set via environment variable: APPLE_SHARED_SECRET
const APPLE_SHARED_SECRET = process.env.APPLE_SHARED_SECRET;

/**
 * Validates Apple receipt with Apple's servers
 * Tries production first, then sandbox if needed
 */
async function validateReceiptWithApple(
  receiptData: string
): Promise<AppleReceiptResponse> {
  if (!APPLE_SHARED_SECRET) {
    console.warn('[appleSubscription] APPLE_SHARED_SECRET not configured');
  }

  const requestBody = {
    'receipt-data': receiptData,
    password: APPLE_SHARED_SECRET,
    'exclude-old-transactions': true,
  };

  // Try production first
  try {
    const productionResponse = await fetch(APPLE_PRODUCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const productionData: AppleReceiptResponse = await productionResponse.json();

    // Status 0 = valid receipt
    if (productionData.status === 0) {
      return productionData;
    }

    // Status 21007 = receipt is from sandbox, try sandbox endpoint
    if (productionData.status === 21007) {
      console.log('[appleSubscription] Receipt is from sandbox, trying sandbox endpoint');
      const sandboxResponse = await fetch(APPLE_SANDBOX_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const sandboxData: AppleReceiptResponse = await sandboxResponse.json();
      return sandboxData;
    }

    // Other error status
    throw new Error(`Apple receipt validation failed with status: ${productionData.status}`);
  } catch (error: any) {
    console.error('[appleSubscription] Error validating receipt:', error);
    throw error;
  }
}

/**
 * Extracts subscription state from Apple receipt response
 */
function extractSubscriptionState(
  receiptResponse: AppleReceiptResponse
): SubscriptionState | null {
  // Use latest_receipt_info if available (more reliable), otherwise use receipt.in_app
  const transactions = receiptResponse.latest_receipt_info || receiptResponse.receipt?.in_app || [];

  if (transactions.length === 0) {
    return null;
  }

  // Find the most recent transaction for our subscription products
  const subscriptionProducts = ['membership_monthly', 'membership_yearly'];
  const subscriptionTransactions = transactions.filter((t) =>
    subscriptionProducts.includes(t.product_id)
  );

  if (subscriptionTransactions.length === 0) {
    return null;
  }

  // Sort by transaction_id (most recent first) and get the latest
  const latestTransaction = subscriptionTransactions.sort((a, b) => {
    const aId = parseInt(a.transaction_id) || 0;
    const bId = parseInt(b.transaction_id) || 0;
    return bId - aId;
  })[0];

  // Check if subscription is active (not expired)
  const expiresDateMs = latestTransaction.expires_date_ms
    ? parseInt(latestTransaction.expires_date_ms)
    : latestTransaction.expires_date
    ? new Date(latestTransaction.expires_date).getTime()
    : null;

  if (!expiresDateMs) {
    return null;
  }

  const now = Date.now();
  const isActive = expiresDateMs > now;

  const renewalDate = new Date(expiresDateMs).toISOString();

  return {
    status: isActive ? 'active' : 'expired',
    plan: latestTransaction.product_id as SubscriptionPlan,
    renewalDate,
    originalTransactionId: latestTransaction.original_transaction_id,
  };
}

/**
 * Updates user's subscription state in Firestore
 */
async function updateSubscriptionState(
  userId: string,
  subscriptionState: SubscriptionState | null
): Promise<void> {
  const updates: any = {
    updatedAt: new Date().toISOString(),
  };

  if (subscriptionState) {
    updates.subscriptionStatus = subscriptionState.status;
    updates.subscriptionPlan = subscriptionState.plan;
    updates.subscriptionRenewalDate = subscriptionState.renewalDate;
    updates.subscriptionOriginalTransactionId = subscriptionState.originalTransactionId;
  } else {
    // Clear subscription if no valid subscription found
    updates.subscriptionStatus = 'expired';
    updates.subscriptionPlan = null;
    updates.subscriptionRenewalDate = null;
    updates.subscriptionOriginalTransactionId = null;
  }

  await firestore.collection('users').doc(userId).set(updates, { merge: true });
}

/**
 * Verifies Apple receipt and updates user subscription state
 * @param userId - User ID
 * @param receiptData - Base64-encoded receipt data from iOS
 * @returns Subscription state or null if invalid
 */
export async function verifyAndUpdateSubscription(
  userId: string,
  receiptData: string
): Promise<SubscriptionState | null> {
  try {
    // Validate receipt with Apple
    const receiptResponse = await validateReceiptWithApple(receiptData);

    // Extract subscription state
    const subscriptionState = extractSubscriptionState(receiptResponse);

    // Update user document
    await updateSubscriptionState(userId, subscriptionState);

    return subscriptionState;
  } catch (error: any) {
    console.error('[appleSubscription] Error verifying subscription:', error);
    // On error, mark subscription as expired
    await updateSubscriptionState(userId, null);
    throw error;
  }
}

/**
 * Gets user's current subscription status
 */
export async function getSubscriptionStatus(userId: string): Promise<{
  status: SubscriptionStatus | null;
  plan: SubscriptionPlan | null;
  renewalDate: string | null;
}> {
  const user = await getUserDocument(userId);
  if (!user) {
    return {
      status: null,
      plan: null,
      renewalDate: null,
    };
  }

  // Check if subscription is still active (renewalDate hasn't passed)
  if (user.subscriptionStatus === 'active' && user.subscriptionRenewalDate) {
    const renewalDate = new Date(user.subscriptionRenewalDate);
    const now = new Date();
    if (renewalDate <= now) {
      // Subscription expired, update status
      await updateSubscriptionState(userId, null);
      return {
        status: 'expired',
        plan: null,
        renewalDate: null,
      };
    }
  }

  return {
    status: user.subscriptionStatus || null,
    plan: user.subscriptionPlan || null,
    renewalDate: user.subscriptionRenewalDate || null,
  };
}

/**
 * Checks if user has active subscription
 */
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const subscription = await getSubscriptionStatus(userId);
  return subscription.status === 'active';
}

/**
 * Handles Apple Server-to-Server Notification
 * This should be called when Apple sends a notification about subscription changes
 * @param notification - Apple notification payload
 */
export async function handleAppleNotification(notification: any): Promise<void> {
  try {
    const notificationType = notification.notification_type;
    const unifiedReceipt = notification.unified_receipt;
    const originalTransactionId = unifiedReceipt?.latest_receipt_info?.[0]?.original_transaction_id;

    if (!originalTransactionId) {
      console.warn('[appleSubscription] No original_transaction_id in notification');
      return;
    }

    // Find user by original_transaction_id
    const usersQuery = await firestore
      .collection('users')
      .where('subscriptionOriginalTransactionId', '==', originalTransactionId)
      .limit(1)
      .get();

    if (usersQuery.empty) {
      console.warn('[appleSubscription] No user found for original_transaction_id:', originalTransactionId);
      return;
    }

    const userId = usersQuery.docs[0].id;
    const receiptData = unifiedReceipt.latest_receipt;

    // Re-verify subscription and update state
    if (receiptData) {
      await verifyAndUpdateSubscription(userId, receiptData);
      console.log('[appleSubscription] Updated subscription for user:', userId, 'notification_type:', notificationType);
    }
  } catch (error: any) {
    console.error('[appleSubscription] Error handling Apple notification:', error);
    throw error;
  }
}

