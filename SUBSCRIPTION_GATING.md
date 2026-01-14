# Subscription Gating Implementation

## Overview

The backend now implements subscription-gated access to all core app features. Users can authenticate, but require an **active subscription** to access premium features.

## Backend Implementation

### Middleware: `requireSubscription`

A new middleware `requireSubscription` has been added to `src/auth/authMiddleware.ts` that:
- Checks if the authenticated user has an active subscription
- Returns `403` with error code `subscription_required` if subscription is not active
- Must be used after `requireAuth` middleware

### Error Response Format

When subscription is not active, endpoints return:

```json
{
  "error": "subscription_required",
  "message": "An active subscription is required to access this feature.",
  "code": "SUBSCRIPTION_REQUIRED"
}
```

**HTTP Status:** `403 Forbidden`

## Gated Endpoints

All core app features now require an active subscription:

### Core Features
- `POST /api/chat` - RAG chat
- `POST /api/age/daily-update` - Daily check-in
- `GET /api/age/state/:userId` - Age state
- `POST /api/age/morning-briefing` - Morning briefing
- `POST /api/age/evening-briefing` - Evening briefing
- `GET /api/age/trend/:userId` - Age trends
- `POST /api/onboarding/submit` - Onboarding submission
- `GET /api/stats/summary` - Stats summary
- `GET /api/longevity/trends` - Longevity trends
- `GET /api/analytics/delta` - Delta analytics

### Score Endpoints
- `POST /api/score/onboarding` - Score onboarding
- `POST /api/score/daily` - Daily score update
- `GET /api/score/state/:userId` - Score state

### Profile Management
- `PATCH /api/auth/profile` - Profile updates

### Debug
- `GET /api/debug/onboarding-status` - Onboarding status

## Non-Gated Endpoints

These endpoints remain accessible without subscription:

### Authentication
- `POST /api/auth/me` - **Returns subscription status** (use this to check on app startup)
- `POST /api/auth/logout` - Logout
- `POST /api/auth/password-reset/*` - Password reset flow
- `PATCH /api/auth/email` - Email change (requires email verification)
- `PATCH /api/auth/password` - Password change (requires email verification)
- `DELETE /api/auth/account` - Account deletion (requires email verification)

### Subscription Management
- `POST /api/subscription/verify` - Verify Apple receipt (no subscription required to verify)
- `GET /api/subscription/status` - Get subscription status
- `POST /api/subscription/apple-notification` - Apple webhook (public)

### Legal
- `GET /api/legal/privacy` - Privacy policy
- `GET /api/legal/terms` - Terms of service
- `POST /api/legal/consent` - Record consent
- `GET /api/legal/consent` - Get consent status

## Frontend Integration Guide

### 1. Check Subscription on App Startup

Call `POST /api/auth/me` after authentication to get subscription status:

```swift
// Response includes:
{
  "subscription": {
    "status": "active" | "expired" | null,
    "plan": "membership_monthly" | "membership_yearly" | null,
    "renewalDate": "2024-12-31T00:00:00Z" | null,
    "membershipDisplayName": "Free" | "Longevity Premium"
  }
}
```

### 2. Handle Subscription Required Errors

When any gated endpoint returns `403` with `error: "subscription_required"`:

1. **Redirect to Membership Screen**
   - Show membership purchase options
   - Allow user to purchase via StoreKit

2. **After Purchase**
   - Call `POST /api/subscription/verify` with receipt data
   - Backend will update subscription status
   - Retry the original request

### 3. Subscription Verification Flow

```swift
// After StoreKit purchase:
1. Get receipt data from StoreKit
2. Call POST /api/subscription/verify with { receiptData: base64Receipt }
3. Backend validates with Apple and updates subscription status
4. Retry the original API call that was blocked
```

### 4. Periodic Subscription Check

- Check subscription status on app launch via `POST /api/auth/me`
- Check before accessing premium features
- Handle `403 subscription_required` errors gracefully

### 5. Subscription Status Display

Use `subscription.membershipDisplayName` from `/api/auth/me`:
- `"Free"` - No active subscription
- `"Longevity Premium"` - Active subscription

## Apple Server-to-Server Notifications

The backend automatically handles Apple Server-to-Server Notifications via:
- `POST /api/subscription/apple-notification`

This webhook updates subscription status when:
- Subscription is renewed
- Subscription is cancelled
- Subscription expires
- Subscription is refunded

**Note:** Ensure this endpoint is publicly accessible for Apple to call.

## Security Notes

1. **Subscription status is checked server-side** - Client cannot bypass
2. **Receipt validation** - All receipts are validated with Apple servers
3. **Status expiration** - Backend checks `renewalDate` to ensure subscription hasn't expired
4. **Atomic updates** - Subscription status updates are atomic in Firestore

## Testing

### Test Active Subscription
1. Purchase subscription via StoreKit (sandbox)
2. Call `POST /api/subscription/verify` with receipt
3. Verify `GET /api/subscription/status` returns `status: "active"`
4. Test gated endpoints - should work

### Test Expired Subscription
1. Let subscription expire (or manually set `subscriptionStatus: "expired"` in Firestore)
2. Call any gated endpoint
3. Should receive `403` with `subscription_required` error

### Test No Subscription
1. New user without subscription
2. Call any gated endpoint
3. Should receive `403` with `subscription_required` error

## Migration Notes

- **Existing users:** Will need to purchase subscription to continue using app
- **Onboarding:** Users can authenticate but cannot complete onboarding without subscription
- **Profile updates:** Profile updates now require subscription (except email/password changes which require email verification)

