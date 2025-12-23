# Auth Integration Guide (Firebase Auth + Backend APIs)

## Overview
- User accounts live in **Firebase Authentication** (email/password via iOS Firebase SDK).
- Backend trusts Firebase by verifying **ID tokens** on each request.
- Firestore stores profiles at `users/{uid}`; backend creates/updates these docs.
- Protected endpoints require `Authorization: Bearer <idToken>`.

## iOS: Sign Up (Create Account) Screen
1. Use FirebaseAuth SDK:
   ```swift
   Auth.auth().createUser(withEmail: email, password: password) { result, error in ... }
   ```
2. Get ID token:
   ```swift
   result?.user.getIDToken { idToken, error in ... }
   ```
3. Call backend to sync/create profile:
   - POST `/api/auth/me` with body `{ "idToken": "<id-token>" }`
   - Response contains `{ uid, email, profile }`.
4. Store needed profile fields (e.g., `chronologicalAgeYears`) in app state.
5. Note: Password is **never** sent to the backend, only to Firebase Auth SDK.

## iOS: Login Screen
1. Sign in with FirebaseAuth:
   ```swift
   Auth.auth().signIn(withEmail: email, password: password) { result, error in ... }
   ```
2. Get ID token:
   ```swift
   result?.user.getIDToken { idToken, error in ... }
   ```
3. Call POST `/api/auth/me` to fetch/create Firestore profile.

## Calling Protected Backend APIs
For every longevity API call:
1. Obtain current ID token:
   ```swift
   Auth.auth().currentUser?.getIDToken { idToken, error in ... }
   ```
2. Add header `Authorization: Bearer <idToken>`.
3. Example:
   ```swift
   var request = URLRequest(url: summaryURL)
   request.httpMethod = "GET"
   request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
   ```
Backend middleware (`requireAuth`) verifies the token and sets `req.user.uid`, used as `userId`.

## Onboarding Flow
1. User is authenticated; profile exists.
2. Call `POST /api/onboarding/submit` with body:
   ```json
   {
     "chronologicalAgeYears": 32,
     "answers": { "activity": 0.5, "smokingAlcohol": -0.5, ... }
   }
   ```
   (No `userId` needed; backend uses token.)
3. Backend computes `totalScore`, `BAOYears = -totalScore * AGE_FACTOR`, sets baseline/current bio age, and updates `users/{uid}`.
4. Use response (`baselineBiologicalAgeYears`, `currentBiologicalAgeYears`, `BAOYears`, `totalScore`) in UI.

## Daily Check-in Flow
1. User is authenticated and has token.
2. Collect metrics:
   ```json
   {
     "metrics": {
       "date": "2025-12-23",
       "sleepHours": 7.5,
       "steps": 9500,
       "vigorousMinutes": 20,
       "processedFoodScore": 2,
       "alcoholUnits": 1,
       "stressLevel": 4,
       "lateCaffeine": false,
       "screenLate": true,
       "bedtimeHour": 23
     }
   }
   ```
3. POST `/api/age/daily-update` with Authorization header.
4. Backend computes `score` and `deltaYears`, updates `users/{uid}` and `users/{uid}/dailyEntries/{date}`, returns:
   ```json
   {
     "state": { ...BiologicalAgeState... },
     "today": { "date": "...", "score": number, "deltaYears": number, "reasons": [] }
   }
   ```
5. UI can use this response directly or call summary to refresh.

## Score / Summary Screen
1. Ensure user is authenticated and has ID token.
2. GET `/api/stats/summary` with Authorization header.
3. Response:
   - `state.chronologicalAgeYears` (fixed profile age)
   - `state.currentBiologicalAgeYears` (current bio age)
   - `weeklyHistory`, `monthlyHistory`, `yearlyHistory` arrays for charts (empty if no data)
   - Optional `today` entry if today exists

## Endpoints (Auth + Longevity)
- `POST /api/auth/me` — verify token, create/read profile.
- `PATCH /api/auth/profile` — update basic profile fields (e.g., chronologicalAgeYears); protected.
- `POST /api/onboarding/submit` — protected; computes baseline bio age and saves onboarding.
- `POST /api/age/daily-update` — protected; saves daily check-in, updates bio age state.
- `GET /api/stats/summary` — protected; returns current state and history arrays.
- (Optional) `GET /api/age/trend/:userId`, `POST /api/age/morning-briefing`, `POST /api/age/evening-briefing`, `POST /api/chat` — can also be called with Authorization header; backend uses token uid where applicable.

## Error Handling
- Missing/invalid token → `401 { "error": "Unauthorized" }`
- Missing profile for a verified uid → backend creates it via `/api/auth/me`; some endpoints may return `404` with guidance to initialize profile/onboarding.

