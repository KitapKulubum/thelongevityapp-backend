# Aging Debt vs Net Delta Farkı Açıklaması

## Sorun

Ekranda görünen değerler:
- **Aging Debt: -2.26y**
- **Net Delta: -2.22y**

Bu iki değer arasında **0.04 yıl** fark var. Neden?

## Hesaplama Farkları

### 1. Aging Debt (`currentAgingDebtYears`)

**Hesaplama:**
```typescript
currentAgingDebtYears = currentBiologicalAgeYears - chronologicalAgeYears
```

**Güncelleme Mekanizması:**
- Her günlük check-in'de `currentBiologicalAgeYears` güncellenir
- `currentBiologicalAgeYears = prevBiologicalAge + deltaYears`
- Sistemde: `deltaYears` **negatif** = rejuvenation, **pozitif** = aging

**Örnek:**
- Chronological age: 37
- Baseline biological age: 34.74
- Aging Debt (başlangıç): 34.74 - 37 = **-2.26y**
- İlk gün: deltaYears = -0.05 (rejuvenation)
  - `currentBiologicalAgeYears = 34.74 + (-0.05) = 34.69`
  - `agingDebtYears = 34.69 - 37 = -2.31y`

### 2. Net Delta (`summary.netDeltaYears`)

**Hesaplama:**
```typescript
baselineDeltaYears = baselineBiologicalAgeYears - chronologicalAgeYears
totalDailyDelta = sum(-(entry.deltaYears || 0))  // ⚠️ INVERTED
netDeltaYears = baselineDeltaYears + totalDailyDelta
```

**Önemli Fark:**
- Delta'lar **inverted** ediliyor (analytics için)
- Sistemdeki negatif delta (rejuvenation) → pozitif oluyor
- Sistemdeki pozitif delta (aging) → negatif oluyor

**Örnek:**
- Baseline delta: 34.74 - 37 = -2.26
- İlk gün: deltaYears = -0.05 (sistemde negatif = rejuvenation)
  - Inverted: -(-0.05) = +0.05
  - `netDeltaYears = -2.26 + 0.05 = -2.21y`

## Neden Fark Var?

### Senaryo 1: Rounding Farkları

Backend'de `roundTo2Decimals()` kullanılıyor. Her hesaplamada yuvarlama yapılırsa, toplam farklı olabilir:

```typescript
// Aging Debt: Her gün güncellenir, her seferinde yuvarlanır
currentBiologicalAgeYears = roundTo2Decimals(prevBiologicalAge + deltaYears)
agingDebtYears = roundTo2Decimals(currentBiologicalAgeYears - chronologicalAgeYears)

// Net Delta: Tüm delta'lar toplanır, sonra yuvarlanır
totalDailyDelta = sum(-deltaYears)  // Önce topla
netDeltaYears = roundTo2Decimals(baselineDeltaYears + totalDailyDelta)  // Sonra yuvarla
```

**Örnek:**
- Gün 1: deltaYears = -0.033 → rounded = -0.03
- Gün 2: deltaYears = -0.007 → rounded = -0.01
- **Aging Debt:** Her gün yuvarlanır: -2.26 → -2.29 → -2.30
- **Net Delta:** Toplam yuvarlanır: -2.26 + 0.04 = -2.22

### Senaryo 2: Entry'lerde `currentBiologicalAgeYears` Farkı

Eğer bazı entry'lerde `currentBiologicalAgeYears` field'ı yoksa veya farklıysa:

```typescript
// Daily entry'de kaydedilen
entry.currentBiologicalAgeYears  // Bu değer kullanılıyor

// Ama analytics'te
entry.deltaYears  // Bu değer kullanılıyor ve inverted ediliyor
```

Eğer `currentBiologicalAgeYears` her zaman `baseline + sum(deltaYears)` ile eşleşmiyorsa fark oluşur.

### Senaryo 3: İlk Entry'de Delta = 0

Backend kodunda ilk entry için `actualDeltaYears = 0` set ediliyor:

```typescript
if (allEntries.length === 0) {
  actualDeltaYears = 0;  // İlk entry için delta = 0
}
```

Ama analytics'te bu entry'nin `deltaYears` değeri kullanılıyor olabilir.

## Çözüm Önerileri

### 1. Tutarlılık İçin: Aging Debt'i Net Delta'dan Hesapla

```typescript
// Mevcut (tutarsız)
agingDebtYears = currentBiologicalAgeYears - chronologicalAgeYears

// Önerilen (tutarlı)
agingDebtYears = netDeltaYears  // Aynı hesaplama
```

### 2. Veya Net Delta'yı Aging Debt'ten Hesapla

```typescript
// Mevcut (tutarsız)
netDeltaYears = baselineDeltaYears + sum(-deltaYears)

// Önerilen (tutarlı)
netDeltaYears = currentBiologicalAgeYears - chronologicalAgeYears
```

### 3. Her İkisini de Aynı Kaynaktan Hesapla

```typescript
// Tek kaynak: currentBiologicalAgeYears
const currentAgingDebtYears = currentBiologicalAgeYears - chronologicalAgeYears;
const netDeltaYears = currentAgingDebtYears;  // Aynı değer
```

## Mevcut Backend Kod Analizi

### Aging Debt Hesaplama (daily-update endpoint)

```typescript
// src/index.ts:349-350
const currentBiologicalAgeYears = prevBiologicalAge + deltaYears;
const currentAgingDebtYears = currentBiologicalAgeYears - chronologicalAgeYears;
```

### Net Delta Hesaplama (analytics endpoint)

```typescript
// src/index.ts:1195-1196
const netDeltaYears = baselineDeltaYears + totalDailyDelta;
// totalDailyDelta = sum(-(entry.deltaYears || 0))
```

## Uygulanan Düzeltme ✅

**Çözüm: Net Delta'yı Aging Debt ile eşitle**

Backend'de `analytics/delta` endpoint'i artık `currentAgingDebtYears` değerini kullanıyor:

```typescript
// analytics/delta endpoint'inde (src/index.ts:1436-1440)
const currentAgingDebtYears = user.currentAgingDebtYears ?? baselineDeltaYears;
const totalDeltaYears = roundTo2Decimals(currentAgingDebtYears);

const summary: DeltaSummary = {
  netDeltaYears: totalDeltaYears,  // Aging Debt ile eşit
  // ...
};
```

Bu sayede:
- **Aging Debt** ve **Net Delta** artık **aynı değeri** gösteriyor
- Tutarlılık sağlandı
- `currentAgingDebtYears` gerçek zamanlı güncellenen değer olduğu için doğru kaynak

## Frontend İçin Not ✅

**Düzeltme Sonrası:**

Frontend'de artık:
- **Aging Debt:** `user.currentAgingDebtYears` field'ından geliyor
- **Net Delta:** `summary.netDeltaYears` field'ından geliyor
- **İkisi de aynı değeri gösteriyor** ✅

**Kullanım:**
- Her iki değer de `user.currentAgingDebtYears` kaynağından geliyor
- Backend'de tutarlılık sağlandı
- Artık fark görünmeyecek

