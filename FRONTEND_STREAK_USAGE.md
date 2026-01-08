# Frontend Streak Kullanım Kılavuzu

Backend'de streak hesaplaması artık **date-based ve consecutive** olarak çalışıyor. Frontend'in streak değerlerini nasıl kullanacağına dair rehber.

## Önemli Kurallar

✅ **Backend'den gelen streak değerlerini direkt kullanın** - Frontend'de hesaplama yapmayın  
✅ **Streak değeri backend'den hesaplanmış olarak gelir** - UI sadece gösterir  
✅ **Streak ardışık günlere bağlıdır** - Check-in sayısına değil

## Streak Hesaplama Mantığı (Backend)

Backend şu kurallara göre streak hesaplar:

- **today = lastCheckInDate + 1 day** → streak + 1 (ardışık gün)
- **today = lastCheckInDate** → streak değişmez (aynı gün tekrar check-in - zaten engellenir)
- **today > lastCheckInDate + 1 day** → streak = 1 (reset - gap var)

## API Endpoint'leri

### 1. Daily Check-in Sonrası Streak

**Endpoint:** `POST /api/age/daily-update`

**Response:**
```json
{
  "state": {
    "rejuvenationStreakDays": 5,
    "accelerationStreakDays": 0,
    "totalRejuvenationDays": 12,
    "totalAccelerationDays": 3,
    ...
  },
  "today": { ... }
}
```

**Kullanım:**
```swift
struct DailyUpdateResponse: Decodable {
    let state: BiologicalAgeState
    let today: TodayEntry
}

struct BiologicalAgeState: Decodable {
    let rejuvenationStreakDays: Int
    let accelerationStreakDays: Int
    // ... diğer alanlar
}

// Response'u decode ettikten sonra:
let streak = response.state.rejuvenationStreakDays
```

### 2. Stats Summary'den Streak

**Endpoint:** `GET /api/stats/summary`

**Response:**
```json
{
  "state": {
    "rejuvenationStreakDays": 5,
    "accelerationStreakDays": 0,
    ...
  },
  "today": { ... },
  "history": [ ... ]
}
```

**Kullanım:**
```swift
struct StatsSummaryResponse: Decodable {
    let state: BiologicalAgeState
    let today: TodayEntry?
    let history: [HistoryPoint]
}

// App açılışında veya stats ekranında:
let streak = response.state.rejuvenationStreakDays
```

## Frontend Implementation Örnekleri

### 1. Streak Gösterimi (UI)

```swift
// Rejuvenation Streak gösterimi
if let streak = state.rejuvenationStreakDays, streak > 0 {
    HStack {
        Image(systemName: "flame.fill")
            .foregroundColor(.orange)
        Text("\(streak) day streak")
            .font(.headline)
            .foregroundColor(.green)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 6)
    .background(Color.green.opacity(0.1))
    .cornerRadius(20)
}

// Acceleration Streak gösterimi (negatif durum)
if let streak = state.accelerationStreakDays, streak > 0 {
    HStack {
        Image(systemName: "exclamationmark.triangle.fill")
            .foregroundColor(.red)
        Text("\(streak) day acceleration")
            .font(.headline)
            .foregroundColor(.red)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 6)
    .background(Color.red.opacity(0.1))
    .cornerRadius(20)
}
```

### 2. Streak State Management

```swift
class LongevityViewModel: ObservableObject {
    @Published var rejuvenationStreak: Int = 0
    @Published var accelerationStreak: Int = 0
    
    func fetchStats() async {
        // GET /api/stats/summary çağrısı
        let response = try await apiClient.getStatsSummary()
        
        // Backend'den gelen değerleri direkt kullan
        self.rejuvenationStreak = response.state.rejuvenationStreakDays
        self.accelerationStreak = response.state.accelerationStreakDays
    }
    
    func submitDailyCheckIn(metrics: DailyMetrics) async {
        // POST /api/age/daily-update çağrısı
        let response = try await apiClient.submitDailyUpdate(metrics)
        
        // Backend'den gelen güncel streak değerlerini kullan
        self.rejuvenationStreak = response.state.rejuvenationStreakDays
        self.accelerationStreak = response.state.accelerationStreakDays
    }
}
```

### 3. Mevcut DailyCheckInView.swift Güncellemesi

Mevcut kodunuz zaten doğru çalışıyor! Sadece şunu unutmayın:

```swift
// ✅ DOĞRU: Backend'den gelen değeri direkt kullan
self.rejuvenationStreak = response.state.rejuvenationStreakDays

// ❌ YANLIŞ: Frontend'de hesaplama yapma
// self.rejuvenationStreak = calculateStreak() // YAPMA!
```

## Streak Değerlerinin Anlamı

### Rejuvenation Streak (`rejuvenationStreakDays`)

- **Pozitif değer**: Ardışık günlerde biological age düşüşü (rejuvenation)
- **0**: Rejuvenation streak yok
- **Backend hesaplar**: Son check-in'den bugüne kadar ardışık mı kontrol eder

### Acceleration Streak (`accelerationStreakDays`)

- **Pozitif değer**: Ardışık günlerde biological age artışı (acceleration)
- **0**: Acceleration streak yok
- **Backend hesaplar**: Son check-in'den bugüne kadar ardışık mı kontrol eder

## Örnek Senaryolar

### Senaryo 1: İlk Check-in
- **Durum**: Kullanıcı ilk kez check-in yapıyor
- **Backend**: `rejuvenationStreakDays = 1` (eğer delta negatifse) veya `0`
- **Frontend**: Gelen değeri göster

### Senaryo 2: Ardışık 2 Gün
- **Durum**: Dün check-in yaptı, bugün tekrar yapıyor
- **Backend**: `rejuvenationStreakDays = 2` (eğer her iki gün de negatif delta varsa)
- **Frontend**: "2 day streak" göster

### Senaryo 3: 1 Gün Ara
- **Durum**: 2 gün önce check-in yaptı, bugün tekrar yapıyor (1 gün gap)
- **Backend**: `rejuvenationStreakDays = 1` (reset - gap var)
- **Frontend**: "1 day streak" göster (yeni başlangıç)

### Senaryo 4: 5 Gün Ara
- **Durum**: 5 gün önce check-in yaptı, bugün tekrar yapıyor
- **Backend**: `rejuvenationStreakDays = 1` (reset - gap var)
- **Frontend**: "1 day streak" göster (yeni başlangıç)

### Senaryo 5: Aynı Gün 2 Check-in
- **Durum**: Kullanıcı aynı gün tekrar check-in yapmaya çalışıyor
- **Backend**: `409 Conflict` hatası döner
- **Frontend**: Hata mesajı göster, streak değişmez

## Test Senaryoları

Frontend test ederken şu durumları kontrol edin:

1. ✅ İlk check-in sonrası streak = 1 veya 0
2. ✅ Ardışık 2 gün check-in → streak = 2
3. ✅ 1 gün ara → streak = 1 (reset)
4. ✅ 5 gün ara → streak = 1 (reset, 2 değil)
5. ✅ Aynı gün 2 check-in → 409 hatası, streak değişmez

## Önemli Notlar

⚠️ **Frontend'de tarih karşılaştırması yapmayın** - Backend zaten yapıyor  
⚠️ **Frontend'de streak hesaplaması yapmayın** - Backend'den gelen değeri kullanın  
⚠️ **Timezone işlemleri backend'de yapılıyor** - Frontend sadece gösterir  
⚠️ **Streak değeri her check-in sonrası güncellenir** - Backend otomatik hesaplar

## API Response Örnekleri

### Başarılı Daily Update Response
```json
{
  "state": {
    "chronologicalAgeYears": 32.0,
    "baselineBiologicalAgeYears": 35.0,
    "currentBiologicalAgeYears": 34.5,
    "agingDebtYears": 2.5,
    "rejuvenationStreakDays": 3,
    "accelerationStreakDays": 0,
    "totalRejuvenationDays": 10,
    "totalAccelerationDays": 2
  },
  "today": {
    "date": "2025-01-20",
    "score": 85,
    "deltaYears": -0.5,
    "reasons": ["Good sleep", "Exercise"]
  }
}
```

### Stats Summary Response
```json
{
  "state": {
    "rejuvenationStreakDays": 3,
    "accelerationStreakDays": 0,
    ...
  },
  "today": {
    "date": "2025-01-20",
    "score": 85,
    "deltaYears": -0.5
  },
  "history": [...]
}
```

## Sonuç

Frontend'in yapması gereken tek şey:
1. ✅ Backend'den gelen `rejuvenationStreakDays` ve `accelerationStreakDays` değerlerini almak
2. ✅ Bu değerleri UI'da göstermek
3. ✅ Hesaplama yapmamak - backend zaten yapıyor!

Streak hesaplaması tamamen backend'de yapılıyor ve timezone-safe. Frontend sadece gösterim yapıyor.

