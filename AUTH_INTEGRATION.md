# Auth Integration Guide (Firebase Auth + Backend APIs)

## Overview
- User accounts live in **Firebase Authentication** (email/password via iOS Firebase SDK).
- Backend trusts Firebase by verifying **ID tokens** on each request.
- Firestore stores profiles at `users/{uid}`; backend creates/updates these docs.
- Protected endpoints require `Authorization: Bearer <idToken>`.

## iOS: Sign Up (Create Account) Screen
1. Collect user information:
   - Email and password (for Firebase Auth)
   - **First Name** (`firstName`: string)
   - **Last Name** (`lastName`: string)
   - **Date of Birth** (`dateOfBirth`: string in ISO format `YYYY-MM-DD`, e.g., `"1990-05-15"`)
   
2. Use FirebaseAuth SDK to create the account:
   ```swift
   Auth.auth().createUser(withEmail: email, password: password) { result, error in ... }
   ```
   
3. Get ID token:
   ```swift
   result?.user.getIDToken { idToken, error in ... }
   ```
   
4. Call backend to sync/create profile with user information:
   - POST `/api/auth/me` with body:
     ```json
     {
       "idToken": "<id-token>",
       "firstName": "John",
       "lastName": "Doe",
       "dateOfBirth": "1990-05-15"
     }
     ```
   - Response contains `{ uid, email, profile }`.
   - **Important**: Backend automatically calculates `chronologicalAgeYears` from `dateOfBirth`.
   - The `profile` object will contain:
     - `firstName`, `lastName`, `dateOfBirth` (as provided)
     - `chronologicalAgeYears` (calculated automatically from dateOfBirth)
     - Other profile fields
   
5. Store needed profile fields in app state:
   - Use `profile.firstName` and `profile.lastName` to display user's name
   - Use `profile.chronologicalAgeYears` for age-related calculations
   - Use `profile.dateOfBirth` if you need the birth date (e.g., for display or future updates)
   
6. Note: Password is **never** sent to the backend, only to Firebase Auth SDK.

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
1. User is authenticated; profile exists (created during sign-up).
2. Get `chronologicalAgeYears` from profile:
   - If profile was created with `dateOfBirth` during sign-up, use `profile.chronologicalAgeYears`
   - If not available in profile, calculate from `profile.dateOfBirth` or collect from user
3. Call `POST /api/onboarding/submit` with body:
   ```json
   {
     "chronologicalAgeYears": 32,
     "answers": { "activity": 0.5, "smokingAlcohol": -0.5, ... }
   }
   ```
   (No `userId` needed; backend uses token.)
   - **Note**: `chronologicalAgeYears` should match the value from the profile (which was calculated from `dateOfBirth` during sign-up)
4. Backend computes `totalScore`, `BAOYears = -totalScore * AGE_FACTOR`, sets baseline/current bio age, and updates `users/{uid}`.
5. Use response (`baselineBiologicalAgeYears`, `currentBiologicalAgeYears`, `BAOYears`, `totalScore`) in UI.

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

## Profile Page

### Getting Profile Data
The profile object from `POST /api/auth/me` contains:
```json
{
  "uid": "user-id",
  "email": "user@example.com",
  "profile": {
    "userId": "user-id",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "dateOfBirth": "1990-05-15",
    "chronologicalAgeYears": 34,
    "baselineBiologicalAgeYears": 34.5,
    "currentBiologicalAgeYears": 34.2,
    "currentAgingDebtYears": 0.2,
    "rejuvenationStreakDays": 5,
    "accelerationStreakDays": 0,
    "totalRejuvenationDays": 10,
    "totalAccelerationDays": 2,
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-15T00:00:00.000Z"
  }
}
```

### Displaying User Name
1. Get user profile from `POST /api/auth/me` or from stored app state.
2. Display name:
   ```swift
   // Full name (combine firstName and lastName)
   let firstName = profile.firstName ?? ""
   let lastName = profile.lastName ?? ""
   let fullName = "\(firstName) \(lastName)".trimmingCharacters(in: .whitespaces)
   
   // If both are empty, you might want to show email or "User" as fallback
   if fullName.isEmpty {
       fullName = profile.email ?? "User"
   }
   
   // Or display separately:
   // Display firstName in UI: profile.firstName ?? "Not set"
   // Display lastName in UI: profile.lastName ?? "Not set"
   ```
   - **Use `profile.firstName`** for first name (may be null/empty)
   - **Use `profile.lastName`** for last name (may be null/empty)
   - Combine them for full name display
   - Handle null/empty values appropriately with fallbacks

### Displaying User Age
- **Use `profile.chronologicalAgeYears`** to display the user's chronological age
- This value is automatically calculated from `profile.dateOfBirth`
- Format: `profile.chronologicalAgeYears` is a number (e.g., 34) representing years
- Example: `"Age: \(Int(profile.chronologicalAgeYears ?? 0)) years"`

### Logout
1. Call logout endpoint (optional, for consistency):
   ```swift
   // POST /api/auth/logout with Authorization header
   var request = URLRequest(url: logoutURL)
   request.httpMethod = "POST"
   request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
   ```
   
2. **Important**: Logout is primarily handled client-side with Firebase Auth SDK:
   ```swift
   try Auth.auth().signOut()
   ```
   
3. Clear local app state (user data, tokens, etc.)
4. Navigate to login/signup screen

### Updating Profile
Use `PATCH /api/auth/profile` to update profile fields:
```json
{
  "firstName": "Updated First Name",
  "lastName": "Updated Last Name",
  "dateOfBirth": "1990-05-15"
}
```
- If `dateOfBirth` is updated, `chronologicalAgeYears` is automatically recalculated
- You can also update `chronologicalAgeYears` directly (though using `dateOfBirth` is recommended)

## Endpoints (Auth + Longevity)
- `POST /api/auth/me` — verify token, create/read profile. Accepts optional `firstName`, `lastName`, `dateOfBirth` during sign-up.
- `PATCH /api/auth/profile` — update profile fields (`firstName`, `lastName`, `dateOfBirth`, `chronologicalAgeYears`); protected.
- `POST /api/auth/logout` — logout endpoint (logout is primarily client-side); protected.
- `POST /api/onboarding/submit` — protected; computes baseline bio age and saves onboarding.
- `POST /api/age/daily-update` — protected; saves daily check-in, updates bio age state.
- `GET /api/stats/summary` — protected; returns current state and history arrays.
- (Optional) `GET /api/age/trend/:userId`, `POST /api/age/morning-briefing`, `POST /api/age/evening-briefing`, `POST /api/chat` — can also be called with Authorization header; backend uses token uid where applicable.

## Error Handling
- Missing/invalid token → `401 { "error": "Unauthorized" }`
- Missing profile for a verified uid → backend creates it via `/api/auth/me`; some endpoints may return `404` with guidance to initialize profile/onboarding.

