# Delta Analytics API Documentation

## Endpoint

**GET** `/api/analytics/delta?range=weekly|monthly|yearly`

**Authentication:** Required (Bearer token in Authorization header)

**Query Parameters:**
- `range` (required): `weekly`, `monthly`, or `yearly`

## Response Format

### Weekly Response

```json
{
  "range": "weekly",
  "timezone": "Europe/Istanbul",
  "baselineDeltaYears": -2.21,
  "totalDeltaYears": -2.30,
  "start": "2026-01-05",
  "end": "2026-01-11",
  "series": [
    { "date": "2026-01-05", "dailyDeltaYears": 0.4 },
    { "date": "2026-01-06", "dailyDeltaYears": null },
    { "date": "2026-01-07", "dailyDeltaYears": -0.2 },
    { "date": "2026-01-08", "dailyDeltaYears": 0.3 },
    { "date": "2026-01-09", "dailyDeltaYears": null },
    { "date": "2026-01-10", "dailyDeltaYears": 0.5 },
    { "date": "2026-01-11", "dailyDeltaYears": 0.1 }
  ],
  "summary": {
    "netDeltaYears": -2.30,
    "rejuvenationYears": 2.35,
    "agingYears": 0.05,
    "checkIns": 12,
    "rangeNetDeltaYears": 1.1
  }
}
```

**Notes:**
- Week starts on Monday and ends on Sunday
- `series` contains all 7 days of the week
- Missing days (no check-in) have `dailyDeltaYears: null`
- If multiple check-ins on same day, deltas are summed
- `baselineDeltaYears`: Baseline delta from onboarding (baselineBiologicalAge - chronologicalAge)
- `totalDeltaYears`: Total delta including baseline + all daily deltas from onboarding to date
- `summary.netDeltaYears`: Total including baseline + all daily deltas (use this for UI display)
- `summary.rangeNetDeltaYears`: Only the delta sum within the selected range (for reference)

### Monthly Response

```json
{
  "range": "monthly",
  "timezone": "Europe/Istanbul",
  "baselineDeltaYears": -2.21,
  "totalDeltaYears": -2.30,
  "start": "2026-01-01",
  "end": "2026-01-31",
  "series": [
    { "date": "2026-01-01", "dailyDeltaYears": 0.4 },
    { "date": "2026-01-02", "dailyDeltaYears": null },
    { "date": "2026-01-03", "dailyDeltaYears": -0.2 },
    ...
    { "date": "2026-01-31", "dailyDeltaYears": 0.3 }
  ],
  "summary": {
    "netDeltaYears": -2.30,
    "rejuvenationYears": 12.0,
    "agingYears": 3.4,
    "checkIns": 18,
    "rangeNetDeltaYears": 8.6
  }
}
```

**Notes:**
- `series` contains all days of the month (28-31 days depending on month)
- Missing days have `dailyDeltaYears: null`
- `baselineDeltaYears`: Baseline delta from onboarding
- `totalDeltaYears`: Total delta including baseline + all daily deltas
- `summary.netDeltaYears`: Total including baseline + all daily deltas (use this for UI display)
- `summary.rangeNetDeltaYears`: Only the delta sum within the selected range (for reference)

### Yearly Response

```json
{
  "range": "yearly",
  "timezone": "Europe/Istanbul",
  "baselineDeltaYears": -2.21,
  "totalDeltaYears": -2.30,
  "start": "2026-01-01",
  "end": "2026-12-31",
  "series": [
    { "month": "2026-01", "netDelta": 2.1, "checkIns": 18, "avgDeltaPerCheckIn": 0.12 },
    { "month": "2026-02", "netDelta": 1.8, "checkIns": 20, "avgDeltaPerCheckIn": 0.09 },
    ...
    { "month": "2026-12", "netDelta": 0.5, "checkIns": 15, "avgDeltaPerCheckIn": 0.03 }
  ],
  "summary": {
    "netDeltaYears": -2.30,
    "rejuvenationYears": 19.0,
    "agingYears": 10.4,
    "checkIns": 210,
    "rangeNetDeltaYears": 8.6
  }
}
```

**Notes:**
- `series` contains all 12 months of the year
- Each month shows aggregated `netDelta`, `checkIns`, and `avgDeltaPerCheckIn`
- `baselineDeltaYears`: Baseline delta from onboarding
- `totalDeltaYears`: Total delta including baseline + all daily deltas
- `summary.netDeltaYears`: Total including baseline + all daily deltas (use this for UI display)
- `summary.rangeNetDeltaYears`: Only the delta sum within the selected range (for reference)

## Delta Value Definition

**Important:** The API uses inverted delta values from the internal system:

- **Positive delta** = Rejuvenation (biological age decreased)
- **Negative delta** = Aging (biological age increased)

This matches the user-facing definition where positive values indicate improvement.

## Summary Calculations

All summary fields are calculated as follows:

- **netDeltaYears**: `baselineDeltaYears + sum(all daily deltas from onboarding to date)` - Total including baseline (use this for UI display)
- **rejuvenationYears**: `sum(max(dailyDeltaYears, 0))` - Sum of positive daily deltas (rejuvenation days)
- **agingYears**: `sum(abs(min(dailyDeltaYears, 0)))` - Sum of absolute values of negative daily deltas (aging days)
- **checkIns**: `count(entries in range)` - Number of check-ins in the selected range
- **rangeNetDeltaYears**: `sum(dailyDeltaYears in range)` - Sum of daily deltas only within the selected range (for reference)

**Important:** The `netDeltaYears` field includes the baseline delta from onboarding, so it represents the total delta from the start. This ensures consistency with the badge showing "Rejuvenation: -2.21y" which matches `baselineDeltaYears`.

## Timezone Handling

- All date calculations use the user's timezone (from `user.timezone` field)
- Defaults to `UTC` if user timezone is not set
- Week starts on Monday (ISO 8601 standard)
- Month ranges include all days of the month
- Year ranges include all months of the year

## Data Aggregation Rules

1. **Daily aggregation**: If multiple check-ins occur on the same day, their deltas are summed
2. **Missing days**: Days without check-ins have `dailyDeltaYears: null` in the series
3. **Month aggregation**: For yearly view, all check-ins in a month are aggregated by summing deltas
4. **Baseline integration**: All responses include `baselineDeltaYears` (from onboarding) and `totalDeltaYears` (baseline + all daily deltas)

## Example Usage

```bash
# Get weekly delta analytics
curl -H "Authorization: Bearer <token>" \
  "http://localhost:4000/api/analytics/delta?range=weekly"

# Get monthly delta analytics
curl -H "Authorization: Bearer <token>" \
  "http://localhost:4000/api/analytics/delta?range=monthly"

# Get yearly delta analytics
curl -H "Authorization: Bearer <token>" \
  "http://localhost:4000/api/analytics/delta?range=yearly"
```

## Error Responses

### 400 Bad Request
```json
{
  "error": "Invalid range. Use weekly, monthly, or yearly"
}
```

### 404 Not Found
```json
{
  "error": "User not found. Complete onboarding first."
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "debug": "Error details (only in development)"
}
```

## Implementation Notes

- The endpoint uses the user's timezone for all date calculations
- Week ranges are calculated from Monday to Sunday
- Month ranges include all days (28-31 depending on month)
- Year ranges include all 12 months
- Delta values are rounded to 2 decimal places
- The API inverts internal `deltaYears` values to match user-facing definition

