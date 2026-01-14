# Frontend Delta Analytics Implementation Guide (iOS/SwiftUI)

## Goal

Replace the existing chart in the Score screen with a "Delta (Rejuvenation/Aging)" chart. All other UI elements (headers, text, cards, buttons, layout spacing, etc.) must remain **exactly the same**. Only the chart section changes.

## Backend API

**Endpoint:** `GET /api/analytics/delta?range=weekly|monthly|yearly`

**Authentication:** Required (Bearer token in Authorization header)

**Query Parameters:**
- `range`: `weekly`, `monthly`, or `yearly`

**Response Format:** See `ANALYTICS_DELTA_API.md` for full contract.

## ⚠️ Important Changes (Baseline Delta Integration)

**Backend now includes baseline delta from onboarding:**

1. **New Response Fields:**
   - `baselineDeltaYears`: Baseline delta calculated during onboarding (`baselineBiologicalAge - chronologicalAge`)
   - `totalDeltaYears`: Total delta including baseline + all daily deltas from onboarding to date

2. **Updated Summary Fields:**
   - `netDeltaYears`: **Total** including baseline + all daily deltas (use this for UI display)
   - `rejuvenationYears`: Sum of all positive daily deltas (rejuvenation)
   - `agingYears`: Sum of all negative daily deltas (aging, as positive value)
   - `rangeNetDeltaYears`: Only the delta sum within the selected range (for reference)
   - `checkIns`: Number of check-ins in the selected range

3. **Series Field Change:**
   - `delta` → `dailyDeltaYears` (field name changed)

**Key Point:** The UI should display `netDeltaYears` (which includes baseline) as the main "Net Delta" value. This ensures consistency with the badge showing "Rejuvenation: -2.21y" which matches `baselineDeltaYears`.

## Swift Models

```swift
// MARK: - Delta Analytics Models

struct DeltaDailyPoint: Decodable {
    let date: String  // YYYY-MM-DD format
    let dailyDeltaYears: Double?  // Daily delta for that day (null if no check-in)
}

struct DeltaMonthlyPoint: Decodable {
    let month: String  // YYYY-MM format
    let netDelta: Double  // Sum of deltas for that month
    let checkIns: Int  // Count of check-ins in that month
    let avgDeltaPerCheckIn: Double  // netDelta / checkIns
}

struct DeltaSummary: Decodable {
    let netDeltaYears: Double  // baselineDeltaYears + sum(all daily deltas from onboarding to date)
    let rejuvenationYears: Double  // Sum of positive daily deltas (rejuvenation)
    let agingYears: Double  // Sum of absolute negative daily deltas (aging, as positive)
    let checkIns: Int  // Count of check-ins in range
    let rangeNetDeltaYears: Double  // Sum of daily deltas only in selected range
}

// Weekly/Monthly Response
struct WeeklyDeltaResponse: Decodable {
    let range: String
    let timezone: String
    let baselineDeltaYears: Double  // baselineBiologicalAge - chronologicalAge
    let totalDeltaYears: Double  // baselineDeltaYears + sum(all daily deltas from onboarding)
    let start: String  // YYYY-MM-DD (Monday for weekly)
    let end: String  // YYYY-MM-DD (Sunday for weekly)
    let series: [DeltaDailyPoint]
    let summary: DeltaSummary
}

// Monthly Response (same structure as weekly)
typealias MonthlyDeltaResponse = WeeklyDeltaResponse

// Yearly Response
struct YearlyDeltaResponse: Decodable {
    let range: String
    let timezone: String
    let baselineDeltaYears: Double  // baselineBiologicalAge - chronologicalAge
    let totalDeltaYears: Double  // baselineDeltaYears + sum(all daily deltas from onboarding)
    let start: String  // YYYY-MM-DD (first day of year)
    let end: String  // YYYY-MM-DD (last day of year)
    let series: [DeltaMonthlyPoint]
    let summary: DeltaSummary
}

// Union type for response
enum DeltaAnalyticsResponse {
    case weekly(WeeklyDeltaResponse)
    case monthly(MonthlyDeltaResponse)
    case yearly(YearlyDeltaResponse)
}
```

## ViewModel

```swift
// MARK: - Delta Analytics ViewModel

@MainActor
class DeltaAnalyticsViewModel: ObservableObject {
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    
    // Weekly/Monthly state
    @Published var dailyPoints: [DeltaDailyPoint] = []
    @Published var dailySummary: DeltaSummary?
    
    // Yearly state
    @Published var monthlyPoints: [DeltaMonthlyPoint] = []
    @Published var yearlySummary: DeltaSummary?
    
    // Current range
    @Published var currentRange: String = "weekly" {
        didSet {
            loadData(range: currentRange)
        }
    }
    
    private let apiClient: APIClient
    
    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }
    
    func loadData(range: String) {
        guard ["weekly", "monthly", "yearly"].contains(range) else { return }
        
        Task {
            await fetchDeltaAnalytics(range: range)
        }
    }
    
    private func fetchDeltaAnalytics(range: String) async {
        isLoading = true
        errorMessage = nil
        
        do {
            let response = try await apiClient.getDeltaAnalytics(range: range)
            
            switch response {
            case .weekly(let data):
                self.dailyPoints = data.series
                self.dailySummary = data.summary
                self.monthlyPoints = []
                self.yearlySummary = nil
                
            case .monthly(let data):
                self.dailyPoints = data.series
                self.dailySummary = data.summary
                self.monthlyPoints = []
                self.yearlySummary = nil
                
            case .yearly(let data):
                self.monthlyPoints = data.series
                self.yearlySummary = data.summary
                self.dailyPoints = []
                self.dailySummary = nil
            }
            
            isLoading = false
        } catch {
            errorMessage = "Couldn't load delta chart"
            isLoading = false
            print("Error fetching delta analytics: \(error)")
        }
    }
}
```

## API Client Extension

```swift
// MARK: - API Client Extension for Delta Analytics

extension APIClient {
    func getDeltaAnalytics(range: String) async throws -> DeltaAnalyticsResponse {
        guard let url = URL(string: "\(baseURL)/api/analytics/delta?range=\(range)") else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        
        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.httpError(httpResponse.statusCode)
        }
        
        let decoder = JSONDecoder()
        
        // Determine response type based on range
        if range == "yearly" {
            let yearlyResponse = try decoder.decode(YearlyDeltaResponse.self, from: data)
            return .yearly(yearlyResponse)
        } else {
            let dailyResponse = try decoder.decode(WeeklyDeltaResponse.self, from: data)
            if range == "weekly" {
                return .weekly(dailyResponse)
            } else {
                return .monthly(dailyResponse)
            }
        }
    }
}
```

## Chart View Component

```swift
// MARK: - Delta Chart View

struct DeltaChartView: View {
    @ObservedObject var viewModel: DeltaAnalyticsViewModel
    let range: String  // "weekly", "monthly", or "yearly"
    
    var body: some View {
        VStack(spacing: 0) {
            // Mini Summary (inside chart container)
            if let summary = viewModel.dailySummary ?? viewModel.yearlySummary {
                DeltaSummaryView(summary: summary)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
            }
            
            // Chart Area
            if viewModel.isLoading {
                DeltaChartLoadingView()
                    .frame(height: 200)
            } else if let error = viewModel.errorMessage {
                DeltaChartErrorView(message: error)
                    .frame(height: 200)
            } else if range == "yearly" {
                YearlyDeltaChartView(points: viewModel.monthlyPoints)
                    .frame(height: 200)
            } else {
                DailyDeltaChartView(points: viewModel.dailyPoints)
                    .frame(height: 200)
            }
        }
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .padding(.horizontal, 16)
    }
}

// MARK: - Mini Summary View

struct DeltaSummaryView: View {
    let summary: DeltaSummary
    
    var body: some View {
        HStack(spacing: 16) {
            // Net Delta (Total including baseline)
            VStack(alignment: .leading, spacing: 4) {
                Text("Net Delta")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text(formatDelta(summary.netDeltaYears))
                    .font(.headline)
                    .foregroundColor(summary.netDeltaYears >= 0 ? .green : .red)
            }
            
            Spacer()
            
            // Rejuvenation
            VStack(alignment: .leading, spacing: 4) {
                Text("Rejuvenation")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text(formatDelta(summary.rejuvenationYears))
                    .font(.headline)
                    .foregroundColor(.green)
            }
            
            Spacer()
            
            // Aging
            VStack(alignment: .leading, spacing: 4) {
                Text("Aging")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text(formatDelta(summary.agingYears))
                    .font(.headline)
                    .foregroundColor(.red)
            }
            
            Spacer()
            
            // Check-ins
            VStack(alignment: .leading, spacing: 4) {
                Text("Check-ins")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text("\(summary.checkIns)")
                    .font(.headline)
                    .foregroundColor(.primary)
            }
        }
        .padding(.vertical, 8)
    }
    
    private func formatDelta(_ value: Double) -> String {
        let sign = value >= 0 ? "+" : ""
        return String(format: "\(sign)%.2fy", value)
    }
}

// MARK: - Daily Chart View (Weekly/Monthly)

struct DailyDeltaChartView: View {
    let points: [DeltaDailyPoint]
    
    var body: some View {
        // Use your existing chart library (Charts, SwiftUICharts, etc.)
        // Example with Swift Charts:
        Chart {
            ForEach(points, id: \.date) { point in
                if let dailyDeltaYears = point.dailyDeltaYears {
                    LineMark(
                        x: .value("Date", parseDate(point.date)),
                        y: .value("Delta", dailyDeltaYears)
                    )
                    .foregroundStyle(dailyDeltaYears >= 0 ? .green : .red)
                    
                    PointMark(
                        x: .value("Date", parseDate(point.date)),
                        y: .value("Delta", dailyDeltaYears)
                    )
                    .foregroundStyle(dailyDeltaYears >= 0 ? .green : .red)
                }
                // If dailyDeltaYears is nil, no mark is drawn (creates gap)
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic) { value in
                AxisGridLine()
                AxisValueLabel(format: .dateTime.month().day())
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine()
                AxisValueLabel()
            }
        }
        .padding()
    }
    
    private func parseDate(_ dateString: String) -> Date {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: dateString) ?? Date()
    }
}

// MARK: - Yearly Chart View

struct YearlyDeltaChartView: View {
    let points: [DeltaMonthlyPoint]
    
    var body: some View {
        Chart {
            ForEach(points, id: \.month) { point in
                BarMark(
                    x: .value("Month", point.month),
                    y: .value("Net Delta", point.netDelta)
                )
                .foregroundStyle(point.netDelta >= 0 ? .green : .red)
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic) { value in
                AxisGridLine()
                AxisValueLabel(format: .dateTime.month(.abbreviated))
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine()
                AxisValueLabel()
            }
        }
        .chartPlotStyle { plotArea in
            plotArea
                .background(Color(.systemGray6))
        }
        .padding()
    }
}

// MARK: - Loading View

struct DeltaChartLoadingView: View {
    var body: some View {
        VStack {
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle())
            Text("Loading chart...")
                .font(.caption)
                .foregroundColor(.secondary)
                .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Error View

struct DeltaChartErrorView: View {
    let message: String
    
    var body: some View {
        VStack {
            Image(systemName: "exclamationmark.triangle")
                .font(.title2)
                .foregroundColor(.secondary)
            Text(message)
                .font(.caption)
                .foregroundColor(.secondary)
                .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
```

## Score Screen Integration

```swift
// MARK: - Score Screen (Partial - Only Chart Section)

struct ScoreView: View {
    // ... existing properties ...
    
    @StateObject private var deltaViewModel = DeltaAnalyticsViewModel(apiClient: apiClient)
    @State private var selectedRange: String = "weekly"
    
    var body: some View {
        VStack(spacing: 0) {
            // ... existing UI elements (unchanged) ...
            
            // Existing segmented control (if exists, keep it)
            Picker("Range", selection: $selectedRange) {
                Text("Weekly").tag("weekly")
                Text("Monthly").tag("monthly")
                Text("Yearly").tag("yearly")
            }
            .pickerStyle(SegmentedPickerStyle())
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .onChange(of: selectedRange) { newValue in
                deltaViewModel.currentRange = newValue
            }
            
            // REPLACE ONLY THIS SECTION - Chart Container
            DeltaChartView(viewModel: deltaViewModel, range: selectedRange)
                .padding(.top, 16)
            
            // ... existing UI elements below (unchanged) ...
        }
        .onAppear {
            deltaViewModel.loadData(range: selectedRange)
        }
    }
}
```

## Key Implementation Notes

### 1. Null Handling (Gaps)
```swift
// In DailyDeltaChartView, only draw marks when dailyDeltaYears is not nil
ForEach(points, id: \.date) { point in
    if let dailyDeltaYears = point.dailyDeltaYears {
        // Draw mark
    }
    // If nil, skip (creates gap in chart)
}
```

### 2. Date Parsing
```swift
// Parse YYYY-MM-DD strings to Date objects for chart
private func parseDate(_ dateString: String) -> Date {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.timeZone = TimeZone(identifier: "UTC") // Or user's timezone
    return formatter.date(from: dateString) ?? Date()
}
```

### 3. Yearly Tooltip
```swift
// For yearly chart, show tooltip with all data
.chartAngleSelection(value: $selectedMonth)
.onChange(of: selectedMonth) { month in
    if let point = monthlyPoints.first(where: { $0.month == month }) {
        // Show tooltip with:
        // - netDelta
        // - checkIns
        // - avgDeltaPerCheckIn
    }
}
```

### 4. Color Coding
- **Positive delta** (rejuvenation): Green
- **Negative delta** (aging): Red
- **Zero line**: Gray (optional)

### 5. Chart Library
Use your existing chart library:
- **Swift Charts** (iOS 16+): Recommended
- **Charts** (DGCharts): Alternative
- **SwiftUICharts**: Lightweight option

## Acceptance Criteria Checklist

- ✅ Score screen's other areas unchanged (pixel-perfect)
- ✅ Weekly/Monthly shows daily deltas with gaps for null values
- ✅ Yearly shows monthly netDelta bars
- ✅ Toggle changes trigger correct API call with range parameter
- ✅ Loading skeleton only in chart container
- ✅ Error message only in chart container, other UI visible
- ✅ Mini summary inside chart container
- ✅ Null values create gaps (not drawn as 0)

## Testing

1. **Weekly View**: Verify 7 days shown, null days create gaps
2. **Monthly View**: Verify all days of month shown, null days create gaps
3. **Yearly View**: Verify 12 months shown with netDelta bars
4. **Toggle**: Verify API called with correct range parameter
5. **Loading**: Verify skeleton only in chart area
6. **Error**: Verify error message only in chart area
7. **Summary**: Verify all summary values displayed correctly

## Example API Response Mapping

**Weekly Response:**
```json
{
  "range": "weekly",
  "timezone": "Europe/Istanbul",
  "baselineDeltaYears": -2.21,
  "totalDeltaYears": -2.30,
  "start": "2026-01-05",
  "end": "2026-01-11",
  "series": [
    { "date": "2026-01-05", "dailyDeltaYears": null },
    { "date": "2026-01-06", "dailyDeltaYears": -0.09 },
    { "date": "2026-01-07", "dailyDeltaYears": 0.15 }
  ],
  "summary": {
    "netDeltaYears": -2.30,
    "rejuvenationYears": 2.35,
    "agingYears": 0.05,
    "checkIns": 12,
    "rangeNetDeltaYears": -0.09
  }
}
```

**Maps to:**
- `dailyPoints`: Array of `DeltaDailyPoint` (date + dailyDeltaYears)
- `dailySummary`: `DeltaSummary` object
- `baselineDeltaYears`: Baseline delta from onboarding
- `totalDeltaYears`: Total delta including baseline + all daily deltas
- Chart shows line/bar for non-null dailyDeltaYears, gaps for null
- Summary shows `netDeltaYears` (total including baseline) and `rangeNetDeltaYears` (only range)

## Important Reminders

1. **DO NOT** modify any UI outside the chart container
2. **DO NOT** change spacing, padding, or layout of other elements
3. **DO** handle null values as gaps (not as 0)
4. **DO** show loading/error only in chart container
5. **DO** update chart when range toggle changes
6. **DO** format delta values with +/- signs appropriately

