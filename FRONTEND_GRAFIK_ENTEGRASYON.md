# Haftalık, Aylık ve Yıllık Grafik Entegrasyon Rehberi

## Sorun Tespiti

API dokümantasyonu (`ANALYTICS_DELTA_API.md`) güncel değildi ve backend implementasyonuyla uyuşmuyordu. Şimdi düzeltildi ve backend ile tam uyumlu hale getirildi.

## Backend API Yapısı

**Endpoint:** `GET /api/analytics/delta?range=weekly|monthly|yearly`

### Haftalık ve Aylık Response Yapısı

```json
{
  "range": "weekly",  // veya "monthly"
  "timezone": "Europe/Istanbul",
  "baselineDeltaYears": -2.21,      // Onboarding'den gelen baseline delta
  "totalDeltaYears": -2.30,          // Baseline + tüm günlük deltaların toplamı
  "start": "2026-01-05",
  "end": "2026-01-11",
  "series": [
    { "date": "2026-01-05", "dailyDeltaYears": 0.4 },
    { "date": "2026-01-06", "dailyDeltaYears": null },  // Check-in yoksa null
    { "date": "2026-01-07", "dailyDeltaYears": -0.2 }
  ],
  "summary": {
    "netDeltaYears": -2.30,          // ⚠️ BASELINE DAHİL toplam (UI'da bunu göster)
    "rejuvenationYears": 2.35,        // Pozitif deltaların toplamı
    "agingYears": 0.05,               // Negatif deltaların mutlak değer toplamı
    "checkIns": 12,                   // Seçili aralıktaki check-in sayısı
    "rangeNetDeltaYears": 1.1         // Sadece seçili aralıktaki delta toplamı (referans için)
  }
}
```

### Yıllık Response Yapısı

```json
{
  "range": "yearly",
  "timezone": "Europe/Istanbul",
  "baselineDeltaYears": -2.21,
  "totalDeltaYears": -2.30,
  "start": "2026-01-01",
  "end": "2026-12-31",
  "series": [
    { 
      "month": "2026-01", 
      "netDelta": 2.1, 
      "checkIns": 18, 
      "avgDeltaPerCheckIn": 0.12 
    },
    { 
      "month": "2026-02", 
      "netDelta": 1.8, 
      "checkIns": 20, 
      "avgDeltaPerCheckIn": 0.09 
    }
    // ... 12 ay
  ],
  "summary": {
    "netDeltaYears": -2.30,          // ⚠️ BASELINE DAHİL toplam (UI'da bunu göster)
    "rejuvenationYears": 19.0,
    "agingYears": 10.4,
    "checkIns": 210,
    "rangeNetDeltaYears": 8.6         // Sadece yıl içindeki delta toplamı
  }
}
```

## Önyüz Entegrasyon Adımları

### 1. Model Tanımları (Swift)

```swift
// Haftalık/Aylık için günlük noktalar
struct DeltaDailyPoint: Decodable {
    let date: String              // "YYYY-MM-DD" formatında
    let dailyDeltaYears: Double?  // null ise check-in yok
}

// Yıllık için aylık noktalar
struct DeltaMonthlyPoint: Decodable {
    let month: String             // "YYYY-MM" formatında
    let netDelta: Double          // O ayın net delta toplamı
    let checkIns: Int             // O ayın check-in sayısı
    let avgDeltaPerCheckIn: Double // Ortalama delta per check-in
}

// Summary (tüm range'ler için aynı)
struct DeltaSummary: Decodable {
    let netDeltaYears: Double      // ⚠️ BASELINE DAHİL - UI'da bunu göster
    let rejuvenationYears: Double
    let agingYears: Double
    let checkIns: Int
    let rangeNetDeltaYears: Double  // Sadece seçili aralık için (referans)
}

// Haftalık/Aylık Response
struct WeeklyDeltaResponse: Decodable {
    let range: String
    let timezone: String
    let baselineDeltaYears: Double
    let totalDeltaYears: Double
    let start: String
    let end: String
    let series: [DeltaDailyPoint]
    let summary: DeltaSummary
}

// Yıllık Response
struct YearlyDeltaResponse: Decodable {
    let range: String
    let timezone: String
    let baselineDeltaYears: Double
    let totalDeltaYears: Double
    let start: String
    let end: String
    let series: [DeltaMonthlyPoint]  // ⚠️ Farklı: MonthlyPoint array
    let summary: DeltaSummary
}
```

### 2. ViewModel Yapısı

```swift
@MainActor
class DeltaAnalyticsViewModel: ObservableObject {
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    
    // Haftalık/Aylık için
    @Published var dailyPoints: [DeltaDailyPoint] = []
    @Published var dailySummary: DeltaSummary?
    
    // Yıllık için
    @Published var monthlyPoints: [DeltaMonthlyPoint] = []
    @Published var yearlySummary: DeltaSummary?
    
    @Published var currentRange: String = "weekly" {
        didSet {
            loadData(range: currentRange)
        }
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
            errorMessage = "Grafik yüklenemedi"
            isLoading = false
        }
    }
}
```

### 3. Grafik Görünümleri

#### Haftalık/Aylık Grafik (Günlük Noktalar)

```swift
struct DailyDeltaChartView: View {
    let points: [DeltaDailyPoint]
    
    var body: some View {
        Chart {
            ForEach(points, id: \.date) { point in
                // ⚠️ ÖNEMLİ: null değerleri atla (boşluk oluşturur)
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
                // null ise hiçbir şey çizilmez (grafikte boşluk oluşur)
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
    }
    
    private func parseDate(_ dateString: String) -> Date {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: dateString) ?? Date()
    }
}
```

#### Yıllık Grafik (Aylık Bar'lar)

```swift
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
    }
}
```

### 4. Ana Chart Container

```swift
struct DeltaChartView: View {
    @ObservedObject var viewModel: DeltaAnalyticsViewModel
    let range: String  // "weekly", "monthly", veya "yearly"
    
    var body: some View {
        VStack(spacing: 0) {
            // Mini Summary (grafik container'ın içinde)
            if let summary = viewModel.dailySummary ?? viewModel.yearlySummary {
                DeltaSummaryView(summary: summary)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
            }
            
            // Grafik Alanı
            if viewModel.isLoading {
                DeltaChartLoadingView()
                    .frame(height: 200)
            } else if let error = viewModel.errorMessage {
                DeltaChartErrorView(message: error)
                    .frame(height: 200)
            } else if range == "yearly" {
                // ⚠️ Yıllık için farklı grafik
                YearlyDeltaChartView(points: viewModel.monthlyPoints)
                    .frame(height: 200)
            } else {
                // Haftalık/Aylık için günlük grafik
                DailyDeltaChartView(points: viewModel.dailyPoints)
                    .frame(height: 200)
            }
        }
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .padding(.horizontal, 16)
    }
}
```

### 5. Summary Görünümü

```swift
struct DeltaSummaryView: View {
    let summary: DeltaSummary
    
    var body: some View {
        HStack(spacing: 16) {
            // ⚠️ ÖNEMLİ: netDeltaYears kullan (baseline dahil)
            VStack(alignment: .leading, spacing: 4) {
                Text("Net Delta")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text(formatDelta(summary.netDeltaYears))
                    .font(.headline)
                    .foregroundColor(summary.netDeltaYears >= 0 ? .green : .red)
            }
            
            Spacer()
            
            VStack(alignment: .leading, spacing: 4) {
                Text("Rejuvenation")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text(formatDelta(summary.rejuvenationYears))
                    .font(.headline)
                    .foregroundColor(.green)
            }
            
            Spacer()
            
            VStack(alignment: .leading, spacing: 4) {
                Text("Aging")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text(formatDelta(summary.agingYears))
                    .font(.headline)
                    .foregroundColor(.red)
            }
            
            Spacer()
            
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
```

## Önemli Noktalar

### 1. Field İsimleri
- ✅ **Doğru:** `dailyDeltaYears` (haftalık/aylık series için)
- ❌ **Yanlış:** `delta` (eski dokümantasyonda vardı)

### 2. Summary Field İsimleri
- ✅ **Doğru:** `netDeltaYears`, `rejuvenationYears`, `agingYears`, `rangeNetDeltaYears`
- ❌ **Yanlış:** `netDelta`, `rejuvenation`, `aging` (eski dokümantasyonda vardı)

### 3. Null Değer İşleme
- ⚠️ **Kritik:** `dailyDeltaYears: null` olan günleri **0 olarak gösterme**
- ✅ **Doğru:** null değerleri atla, grafikte boşluk oluştur
- ❌ **Yanlış:** null değerleri 0 olarak çiz

### 4. netDeltaYears Kullanımı
- ⚠️ **Kritik:** UI'da `summary.netDeltaYears` kullan (baseline dahil)
- Bu değer onboarding'den bugüne kadar olan **tüm** deltaları içerir
- Badge'deki "Rejuvenation: -2.21y" değeri ile tutarlı olması için gerekli

### 5. Range Değişimi
- Kullanıcı "Weekly" → "Monthly" → "Yearly" değiştirdiğinde:
  1. `currentRange` değişir
  2. ViewModel otomatik olarak `loadData()` çağırır
  3. API'ye yeni `range` parametresi ile istek gönderilir
  4. Response tipine göre (`weekly/monthly` vs `yearly`) farklı grafik gösterilir

### 6. Yıllık Grafik Farkı
- Yıllık grafikte `series` array'i `DeltaMonthlyPoint[]` tipinde
- Her nokta bir **ay**'ı temsil eder (gün değil)
- `BarMark` kullanılır (line değil)
- X ekseni ay isimleri gösterir (gün değil)

## Test Senaryoları

1. **Haftalık Görünüm:**
   - 7 gün gösterilmeli
   - null günler boşluk oluşturmalı
   - `dailyDeltaYears` değerleri çizilmeli

2. **Aylık Görünüm:**
   - Ayın tüm günleri gösterilmeli (28-31 gün)
   - null günler boşluk oluşturmalı
   - `dailyDeltaYears` değerleri çizilmeli

3. **Yıllık Görünüm:**
   - 12 ay gösterilmeli
   - Her ay için `netDelta` bar'ı çizilmeli
   - X ekseni ay isimleri göstermeli

4. **Range Değişimi:**
   - Toggle değiştiğinde API çağrısı yapılmalı
   - Doğru `range` parametresi gönderilmeli
   - Response tipine göre doğru grafik gösterilmeli

5. **Summary Değerleri:**
   - `netDeltaYears` gösterilmeli (baseline dahil)
   - Pozitif değerler yeşil, negatif değerler kırmızı
   - Check-in sayısı doğru gösterilmeli

## Özet

1. **Backend:** `dailyDeltaYears` field'ı kullanıyor (eski `delta` değil)
2. **Backend:** `netDeltaYears`, `rejuvenationYears`, `agingYears` field'ları kullanıyor
3. **Backend:** `baselineDeltaYears` ve `totalDeltaYears` top-level field'ları ekliyor
4. **Frontend:** Null değerleri **atlamalı** (0 olarak göstermemeli)
5. **Frontend:** `summary.netDeltaYears` kullanmalı (baseline dahil)
6. **Frontend:** Yıllık grafik için farklı model (`DeltaMonthlyPoint`) kullanmalı
7. **✅ Düzeltme:** `netDeltaYears` artık `currentAgingDebtYears` ile eşit (tutarlılık sağlandı)

Bu değişikliklerle backend ve frontend tam uyumlu çalışacaktır.

## Aging Debt vs Net Delta Tutarlılığı ✅

**Sorun:** Ekranda "Aging Debt: -2.26y" ve "Net Delta: -2.22y" farklı görünüyordu.

**Çözüm:** Backend'de `netDeltaYears` artık `currentAgingDebtYears` değerini kullanıyor. Bu sayede:
- **Aging Debt** ve **Net Delta** artık **aynı değeri** gösteriyor
- Tutarlılık sağlandı
- `currentAgingDebtYears` gerçek zamanlı güncellenen değer olduğu için doğru kaynak

Detaylar için `AGING_DEBT_VS_NET_DELTA.md` dosyasına bakabilirsiniz.

