# Daily Check-in Implementation Guide (Frontend)

We need to support daily check-in once per day based on the user's local timezone.

## Requirements

### Timezone Detection & Storage

- **Detect user timezone from the device**: Use `TimeZone.current.identifier` (IANA format, e.g. "Europe/Istanbul", "America/New_York")
- **Send timezone to backend**:
  1. On first onboarding (if available)
  2. On app launch if timezone differs from stored value
  3. When user manually changes timezone (if you add this feature)

### Backend Endpoints

#### 1. Update Timezone
**PATCH /api/auth/profile**
```json
{
  "timezone": "Europe/Istanbul"
}
```
- Protected endpoint (requires auth token)
- Updates user's timezone in profile
- Accepts IANA timezone string

#### 2. Check Daily Check-in Status
**GET /api/stats/summary**
- Protected endpoint (requires auth token)
- Returns `today` field:
  - If `today` is `undefined` → check-in not completed today
  - If `today` exists → check-in already completed
- Backend calculates "today" based on user's timezone

#### 3. Submit Daily Check-in
**POST /api/age/daily-update**
- Protected endpoint (requires auth token)
- Accepts metrics payload (no date needed - backend computes it)
- **Response codes**:
  - `200`: Check-in successful
  - `409`: Daily check-in already completed (duplicate)
  - `404`: User not found (complete onboarding first)
  - `500`: Server error

### UI Behavior

#### Daily Check-in Button State

1. **Enabled** (can check in):
   - When `GET /api/stats/summary` returns `today: undefined`
   - User can submit check-in

2. **Disabled + Success State** (already checked in):
   - When `GET /api/stats/summary` returns `today: { date, score, ... }`
   - Show success message or indicator
   - Button disabled with completed state

3. **Loading State**:
   - While checking status or submitting

#### Important Rules

- **DO NOT compute "today" on client** for validation
- **Client only reflects backend truth** - backend is source of truth
- **No manual date math on client** - backend handles timezone calculations
- **No GMT offsets** - use IANA timezone strings only

### Implementation Flow

#### On App Launch

1. Detect device timezone: `TimeZone.current.identifier`
2. Call `GET /api/auth/me` to get current user profile
3. Compare device timezone with `profile.timezone`
4. If different (or missing):
   ```swift
   PATCH /api/auth/profile
   {
     "timezone": "Europe/Istanbul"
   }
   ```
5. Call `GET /api/stats/summary` to check today's status
6. Update UI based on `today` field

#### On Check-in Attempt

1. User fills out daily metrics
2. Call `POST /api/age/daily-update` with metrics (no date field needed)
3. Handle responses:
   - **200 Success**: 
     - Update local state
     - Mark as completed
     - Refresh stats if needed
   - **409 Conflict**: 
     - Show error: "Daily check-in already completed"
     - Update UI to show completed state
     - Refresh stats to get today's entry
   - **Other errors**: Show appropriate error message

#### Onboarding Flow

1. During onboarding, collect timezone: `TimeZone.current.identifier`
2. Include timezone in profile creation (if supported) or send via:
   ```swift
   PATCH /api/auth/profile
   {
     "timezone": "Europe/Istanbul"
   }
   ```
3. Complete onboarding as usual

### Example Code Structure (Swift)

```swift
// Timezone detection
let deviceTimezone = TimeZone.current.identifier

// Check status
func checkDailyStatus() async {
    let response = await apiClient.get("/api/stats/summary")
    let canCheckIn = response.today == nil
    updateUI(canCheckIn: canCheckIn)
}

// Submit check-in
func submitCheckIn(metrics: DailyMetrics) async {
    do {
        let response = try await apiClient.post("/api/age/daily-update", body: metrics)
        // Success - update UI
        markAsCompleted()
    } catch APIError.statusCode(409) {
        // Already completed
        showError("Daily check-in already completed")
        await checkDailyStatus() // Refresh
    }
}
```

### Notes

- **Backend is source of truth** for daily reset logic
- Backend handles DST automatically via Luxon library
- All timestamps stored in UTC
- Daily reset happens at 00:00 in user's timezone
- One check-in per calendar day (timezone-aware)

