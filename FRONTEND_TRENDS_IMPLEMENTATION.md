# Frontend Trends Implementation Guide (iOS/SwiftUI)

You are working on my iOS frontend (SwiftUI).

Goal: Implement Weekly / Monthly / Yearly tabs in the Score screen using backend trends API.

## Backend API

**Endpoint:** `GET /api/longevity/trends`

**Authentication:** Required (Bearer token in Authorization header)

**Note:** `userId` is NOT needed in query params - backend extracts it from auth token.

**Response Format:**
```json
{
  "weekly": {
    "value": -0.32,
    "available": true,
    "points": [
      { "date": "2025-01-15", "biologicalAge": 37.77 },
      { "date": "2025-01-16", "biologicalAge": 37.75 }
    ]
  },
  "monthly": {
    "value": -1.10,
    "available": true,
    "points": [...]
  },
  "yearly": {
    "value": -4.20,
    "available": false,
    "projection": true,
    "points": [...]
  }
}
```

## UI Context (Score screen)

- Top: Chronological Age (left, gray), Biological Age (right, green)
- Badge: "Rejuvenation: -1.48y" (green pill)
- Segmented control: WEEKLY / MONTHLY / YEARLY
- Middle: Chart area + message when not enough data
- Bottom: Aging Debt, Today Δ, Streak pill, and share icons (existing layout)

## Implementation Tasks

### 1) API Client & Models

Create/update a Trends API client:

**Swift Models:**
```swift
struct TrendPoint: Decodable {
    let date: String  // YYYY-MM-DD format
    let biologicalAge: Double
}

struct TrendBucket: Decodable {
    let value: Double?  // Can be null if not available
    let available: Bool
    let projection: Bool?  // Only present for yearly when < 365 entries
    let points: [TrendPoint]?  // Optional array of chart points
}

struct TrendsResponse: Decodable {
    let weekly: TrendBucket
    let monthly: TrendBucket
    let yearly: TrendBucket
}
```

**API Call:**
```swift
func fetchTrends() async throws -> TrendsResponse {
    guard let idToken = try await Auth.auth().currentUser?.getIDToken() else {
        throw APIError.unauthorized
    }
    
    var request = URLRequest(url: URL(string: "\(baseURL)/api/longevity/trends")!)
    request.httpMethod = "GET"
    request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
    
    let (data, response) = try await URLSession.shared.data(for: request)
    
    guard let httpResponse = response as? HTTPURLResponse else {
        throw APIError.invalidResponse
    }
    
    guard httpResponse.statusCode == 200 else {
        throw APIError.httpError(httpResponse.statusCode)
    }
    
    return try JSONDecoder().decode(TrendsResponse.self, from: data)
}
```

### 2) ViewModel

```swift
enum Period: String, CaseIterable {
    case weekly = "WEEKLY"
    case monthly = "MONTHLY"
    case yearly = "YEARLY"
}

@MainActor
class TrendsViewModel: ObservableObject {
    @Published var selectedPeriod: Period = .weekly
    @Published var trendsResponse: TrendsResponse?
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    
    private let apiClient: APIClient
    
    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }
    
    // Computed property for current bucket based on selected period
    var currentBucket: TrendBucket? {
        guard let response = trendsResponse else { return nil }
        
        switch selectedPeriod {
        case .weekly:
            return response.weekly
        case .monthly:
            return response.monthly
        case .yearly:
            return response.yearly
        }
    }
    
    // Fetch trends once on appear, store it, do not refetch on tab switch
    func loadTrends() async {
        guard trendsResponse == nil else { return } // Already loaded
        
        isLoading = true
        errorMessage = nil
        
        do {
            trendsResponse = try await apiClient.fetchTrends()
        } catch {
            errorMessage = "Failed to load trends. Please try again."
            print("Trends fetch error: \(error)")
        }
        
        isLoading = false
    }
    
    // Manual retry
    func retry() async {
        trendsResponse = nil
        await loadTrends()
    }
}
```

### 3) Chart Area Behavior

**If `currentBucket.available == false`:**

Show message based on period:

- **Weekly:**
  ```swift
  "Not enough data for a weekly trend yet. Keep logging your daily check-ins."
  ```

- **Monthly:**
  ```swift
  "Not enough data for a monthly trend yet. Keep logging your daily check-ins."
  ```

- **Yearly:**
  - If `projection == true` and `value != nil`:
    ```swift
    "Not enough data for a yearly trend yet. Showing a projected yearly trend based on recent check-ins."
    ```
  - If `projection == true` and `value == nil`:
    ```swift
    "Not enough data for a yearly trend yet. Keep logging your daily check-ins."
    ```

**If `available == true` OR (`projection == true` with points):**

- Show a lightweight line chart using `points` (date vs biologicalAge)
- Keep MVP simple: use Swift Charts if available (iOS 16+), otherwise implement a simple Path line
- No heavy styling; match dark theme
- Use the same green as Biological Age for the line color

**Chart Implementation Example:**
```swift
struct TrendChartView: View {
    let points: [TrendPoint]
    let color: Color = .green // Match Biological Age color
    
    var body: some View {
        if #available(iOS 16.0, *) {
            Chart {
                ForEach(points, id: \.date) { point in
                    LineMark(
                        x: .value("Date", parseDate(point.date)),
                        y: .value("Age", point.biologicalAge)
                    )
                    .foregroundStyle(color)
                }
            }
            .chartXAxis { /* Customize if needed */ }
            .chartYAxis { /* Customize if needed */ }
        } else {
            // Fallback: Simple Path-based line chart
            GeometryReader { geometry in
                Path { path in
                    // Draw line through points
                    // Implementation details...
                }
                .stroke(color, lineWidth: 2)
            }
        }
    }
    
    private func parseDate(_ dateString: String) -> Date {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: dateString) ?? Date()
    }
}
```

### 4) Trend Number Display

Display `value` with 2 decimals and "y" suffix:

```swift
func formatTrendValue(_ value: Double?) -> String {
    guard let value = value else { return "—" }
    return String(format: "%.2fy", value)
}

func getTrendLabel(_ bucket: TrendBucket) -> String {
    guard let value = bucket.value else { return "No data" }
    
    if bucket.projection == true {
        return "Projected"
    } else if value < 0 {
        return "Rejuvenation"
    } else if value > 0 {
        return "Aging"
    } else {
        return "Stable"
    }
}
```

**Display Example:**
```swift
if let bucket = viewModel.currentBucket, let value = bucket.value {
    VStack(alignment: .leading) {
        Text(getTrendLabel(bucket))
            .font(.caption)
            .foregroundColor(.secondary)
        Text(formatTrendValue(value))
            .font(.title2)
            .foregroundColor(value < 0 ? .green : .red)
    }
}
```

### 5) Layout Consistency

- Segmented control stays at the same position
- Ensure safe area / small devices: chart area scrolls if needed, but top numbers never overlap
- No jumping content height when switching tabs (use fixed minHeight for chart container)

**Example Layout:**
```swift
VStack(spacing: 16) {
    // Top: Age display (existing)
    
    // Segmented control
    Picker("Period", selection: $viewModel.selectedPeriod) {
        ForEach(Period.allCases, id: \.self) { period in
            Text(period.rawValue).tag(period)
        }
    }
    .pickerStyle(.segmented)
    
    // Chart area with fixed min height
    VStack {
        if viewModel.isLoading {
            ProgressView()
        } else if let error = viewModel.errorMessage {
            Text(error)
            Button("Retry") {
                Task { await viewModel.retry() }
            }
        } else if let bucket = viewModel.currentBucket {
            if bucket.available || (bucket.projection == true && bucket.points != nil) {
                // Show chart
                TrendChartView(points: bucket.points ?? [])
                    .frame(minHeight: 200)
            } else {
                // Show message
                Text(getNotEnoughDataMessage(bucket, period: viewModel.selectedPeriod))
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(minHeight: 200)
            }
        }
    }
    .frame(minHeight: 200) // Fixed height to prevent jumping
    
    // Bottom: Existing layout
}
```

### 6) Edge Cases

**If API fails:**
- Show subtle error text in chart area: "Failed to load trends. Please try again."
- Add a retry button below the error message

**If points missing but value exists:**
- Show value + placeholder chart (empty state with message)

**Null handling:**
- Use optional binding (`if let`) for all optional values
- Provide fallback UI for nil cases
- Do not crash on nulls - gracefully handle with placeholder text

**Error Handling:**
```swift
enum TrendsError: LocalizedError {
    case noData
    case apiError(String)
    case decodingError
    
    var errorDescription: String? {
        switch self {
        case .noData:
            return "No trend data available"
        case .apiError(let message):
            return "API error: \(message)"
        case .decodingError:
            return "Failed to decode response"
        }
    }
}
```

## Deliverables

- ✅ SwiftUI ViewModel + API client
- ✅ Updated Score screen to wire segmented control to selectedPeriod and display current bucket
- ✅ Reusable components:
  - `TrendChartView` - Chart component
  - `TrendValueView` - Value display with label
  - `TrendMessageView` - Not enough data message

## Testing Checklist

- [ ] Weekly tab with <7 entries shows "not enough data"
- [ ] Weekly tab with >=7 entries shows chart
- [ ] Monthly tab with <30 entries shows "not enough data"
- [ ] Monthly tab with >=30 entries shows chart
- [ ] Yearly tab with <365 entries shows projection message
- [ ] Yearly tab with >=365 entries shows actual data
- [ ] Tab switching doesn't cause refetch
- [ ] Error state shows retry button
- [ ] Chart renders correctly with points
- [ ] Values display with 2 decimals
- [ ] Negative values show "Rejuvenation" label
- [ ] Positive values show "Aging" label
- [ ] Projection shows "Projected" label

## Notes

- Backend returns values rounded to 2 decimals
- All dates are in YYYY-MM-DD format (timezone-safe)
- Points array may be empty or nil - handle gracefully
- Projection is only present for yearly when < 365 entries
- Backend handles missing days gracefully (no fabrication)

