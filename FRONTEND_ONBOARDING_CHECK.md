# Frontend Onboarding Check Implementation

## Problem
Backend correctly returns `hasCompletedOnboarding: true`, but frontend still shows onboarding questions.

## Solution
Frontend must check the `hasCompletedOnboarding` field from backend responses.

## Backend Endpoints That Return `hasCompletedOnboarding`

### 1. POST /api/auth/me
**Response:**
```json
{
  "uid": "mCMWVfE6U1NiSDzaEDb2mjtWghR2",
  "email": "gd@gmail.com",
  "profile": { ... },
  "hasCompletedOnboarding": true  // ← CHECK THIS FIELD
}
```

### 2. GET /api/stats/summary
**Response:**
```json
{
  "userId": "mCMWVfE6U1NiSDzaEDb2mjtWghR2",
  "state": { ... },
  "hasCompletedOnboarding": true,  // ← CHECK THIS FIELD
  "today": { ... },
  "weeklyHistory": [ ... ]
}
```

## Frontend Implementation Checklist

### ✅ Step 1: On App Launch
```swift
// After calling POST /api/auth/me
let response = await apiClient.post("/api/auth/me", body: { idToken })

if response.hasCompletedOnboarding == true {
    // Navigate to main app screen
    navigateToMainScreen()
} else {
    // Show onboarding questions
    navigateToOnboarding()
}
```

### ✅ Step 2: Check Response Structure
Make sure you're reading the correct field:
- ✅ `response.hasCompletedOnboarding` (boolean)
- ❌ NOT `response.profile.hasCompletedOnboarding`
- ❌ NOT checking if `onboardingAnswers` exists in profile

### ✅ Step 3: Navigation Logic
```swift
func checkOnboardingStatus() async {
    do {
        let authResponse = try await apiClient.post("/api/auth/me", ...)
        
        if authResponse.hasCompletedOnboarding == true {
            // User completed onboarding - go to main screen
            DispatchQueue.main.async {
                self.showMainScreen = true
                self.showOnboarding = false
            }
        } else {
            // User needs to complete onboarding
            DispatchQueue.main.async {
                self.showOnboarding = true
                self.showMainScreen = false
            }
        }
    } catch {
        // Handle error
    }
}
```

### ✅ Step 4: After Onboarding Submission
After successfully submitting onboarding (`POST /api/onboarding/submit`):
1. Refresh user status by calling `POST /api/auth/me` again
2. Check `hasCompletedOnboarding` field
3. Navigate to main screen

```swift
func submitOnboarding(answers: OnboardingAnswers) async {
    do {
        // Submit onboarding
        let submitResponse = try await apiClient.post("/api/onboarding/submit", ...)
        
        // Refresh auth status to get updated hasCompletedOnboarding
        let authResponse = try await apiClient.post("/api/auth/me", ...)
        
        if authResponse.hasCompletedOnboarding == true {
            navigateToMainScreen()
        }
    } catch {
        // Handle error
    }
}
```

## Debug Endpoint

If you need to debug onboarding status, use:
**GET /api/debug/onboarding-status** (requires auth token)

**Response:**
```json
{
  "userId": "mCMWVfE6U1NiSDzaEDb2mjtWghR2",
  "userExists": true,
  "hasCompletedOnboarding": true,
  "onboardingAnswers": { ... },
  "baselineBiologicalAgeYears": 37.77,
  "message": "Onboarding completed"
}
```

## Common Mistakes to Avoid

❌ **Don't check** `profile.onboardingAnswers` directly
❌ **Don't compute** onboarding status on client
❌ **Don't assume** onboarding is incomplete if `hasCompletedOnboarding` is missing
✅ **Always check** `hasCompletedOnboarding` field from backend
✅ **Always trust** backend as source of truth

## Testing

1. Complete onboarding for a user
2. Close and reopen app
3. Call `POST /api/auth/me`
4. Verify `hasCompletedOnboarding: true` in response
5. Frontend should navigate to main screen (not onboarding)

## Backend Verification

Backend logs show:
```
[hasCompletedOnboarding] userId: mCMWVfE6U1NiSDzaEDb2mjtWghR2 hasCompletedOnboarding: true
```

This confirms backend is working correctly. The issue is in frontend not checking this field.

