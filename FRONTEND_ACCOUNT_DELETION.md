# Frontend Account Deletion & Test Bypass API Kullanımı

Bu dokümantasyon, frontend'de hesap silme API'si ve test bypass API'sinin nasıl kullanılacağını açıklar.

## 1. Delete Account API (Hesap Silme)

### Endpoint
```
DELETE /api/auth/account
```

### Özellikler
- **Kimlik Doğrulama**: Gerekli (Bearer token)
- **Email Doğrulama**: Gerekli (sensitive action)
- **Silinen Veriler**:
  - Firebase Auth'dan kullanıcı hesabı
  - Firestore'dan kullanıcı dokümanı
  - Tüm daily entries (günlük check-in verileri)
  - Tüm chat history (sohbet geçmişi)
  - Diğer tüm kullanıcı verileri

### Request

#### Headers
```swift
Authorization: Bearer <idToken>
Content-Type: application/json
```

#### Body
Bu endpoint body gerektirmez.

### Response

#### Success (200 OK)
```json
{
  "success": true,
  "message": "Account deleted successfully. All your data has been permanently removed."
}
```

#### Error Responses

**401 Unauthorized** - Token geçersiz veya eksik
```json
{
  "error": "Unauthorized"
}
```

**403 Forbidden** - Email doğrulanmamış
```json
{
  "error": "email_verification_required",
  "message": "Email verification is required for this action. Please verify your email address."
}
```

**500 Internal Server Error** - Sunucu hatası
```json
{
  "error": "Internal server error",
  "message": "Failed to delete account. Please try again or contact support."
}
```

### Swift Implementation Örneği

```swift
import Foundation
import FirebaseAuth

class AccountService {
    private let baseURL = "https://your-api-url.com"
    
    /// Delete user account permanently
    func deleteAccount() async throws {
        guard let user = Auth.auth().currentUser else {
            throw AccountError.notAuthenticated
        }
        
        // Get fresh ID token
        let idToken = try await user.getIDToken()
        
        // Check if email is verified
        guard user.isEmailVerified else {
            throw AccountError.emailNotVerified
        }
        
        // Create request
        guard let url = URL(string: "\(baseURL)/api/auth/account") else {
            throw AccountError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        // Perform request
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AccountError.invalidResponse
        }
        
        // Handle response
        switch httpResponse.statusCode {
        case 200:
            // Success - parse response
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let success = json["success"] as? Bool,
               success {
                // Account deleted successfully
                // Sign out from Firebase Auth client-side
                try Auth.auth().signOut()
                
                // Clear local app state
                clearLocalData()
                
                // Navigate to login screen
                return
            }
            throw AccountError.invalidResponse
            
        case 401:
            throw AccountError.unauthorized
            
        case 403:
            // Check if it's email verification error
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let error = json["error"] as? String,
               error == "email_verification_required" {
                throw AccountError.emailNotVerified
            }
            throw AccountError.forbidden
            
        case 500:
            throw AccountError.serverError
            
        default:
            throw AccountError.unknownError(httpResponse.statusCode)
        }
    }
    
    private func clearLocalData() {
        // Clear UserDefaults
        UserDefaults.standard.removeObject(forKey: "userData")
        
        // Clear any cached data
        // Clear any local database
        // etc.
    }
}

enum AccountError: Error, LocalizedError {
    case notAuthenticated
    case emailNotVerified
    case invalidURL
    case invalidResponse
    case unauthorized
    case forbidden
    case serverError
    case unknownError(Int)
    
    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "You must be logged in to delete your account."
        case .emailNotVerified:
            return "Please verify your email address before deleting your account."
        case .invalidURL:
            return "Invalid server URL."
        case .invalidResponse:
            return "Invalid response from server."
        case .unauthorized:
            return "Your session has expired. Please log in again."
        case .forbidden:
            return "You don't have permission to perform this action."
        case .serverError:
            return "Server error. Please try again later."
        case .unknownError(let code):
            return "Unknown error (code: \(code))."
        }
    }
}
```

### UI Implementation Örneği

```swift
import SwiftUI

struct DeleteAccountView: View {
    @StateObject private var accountService = AccountService()
    @State private var isDeleting = false
    @State private var showConfirmation = false
    @State private var errorMessage: String?
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Delete Account")
                .font(.title)
                .fontWeight(.bold)
            
            Text("This action cannot be undone. All your data will be permanently deleted.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding()
            
            if let errorMessage = errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundColor(.red)
                    .padding()
            }
            
            Button(action: {
                showConfirmation = true
            }) {
                Text("Delete My Account")
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.red)
                    .cornerRadius(10)
            }
            .disabled(isDeleting)
        }
        .padding()
        .alert("Delete Account", isPresented: $showConfirmation) {
            Button("Cancel", role: .cancel) { }
            Button("Delete", role: .destructive) {
                Task {
                    await deleteAccount()
                }
            }
        } message: {
            Text("Are you sure you want to delete your account? This action cannot be undone.")
        }
    }
    
    private func deleteAccount() async {
        isDeleting = true
        errorMessage = nil
        
        do {
            try await accountService.deleteAccount()
            // Account deleted successfully
            // Navigation will be handled by the service
            dismiss()
        } catch AccountError.emailNotVerified {
            errorMessage = "Please verify your email address before deleting your account."
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isDeleting = false
    }
}
```

### Önemli Notlar

1. **Email Doğrulama Gereklidir**: Kullanıcının email'i doğrulanmış olmalıdır. Eğer doğrulanmamışsa, önce email doğrulama ekranına yönlendirin.

2. **Client-Side Sign Out**: API başarılı olduktan sonra, Firebase Auth'dan client-side sign out yapın:
   ```swift
   try Auth.auth().signOut()
   ```

3. **Local Data Temizleme**: Hesap silindikten sonra tüm local verileri temizleyin (UserDefaults, cache, local database, vb.).

4. **UI Feedback**: Kullanıcıya silme işleminin geri alınamaz olduğunu gösterin ve onay isteyin.

5. **Error Handling**: Tüm hata durumlarını handle edin ve kullanıcıya anlamlı mesajlar gösterin.

---

## 2. Test Bypass API (Test Ortamı İçin)

### Endpoint
```
POST /api/subscription/test-bypass
```

### Özellikler
- **Kimlik Doğrulama**: Gerekli (Bearer token)
- **Sadece Development/Test Ortamında**: Production'da çalışmaz (403 döner)
- **Amaç**: Test kullanıcılarına aktif subscription vermek için
- **Subscription Tipi**: `membership_yearly` (1 yıllık aktif subscription)

### Request

#### Headers
```swift
Authorization: Bearer <idToken>
Content-Type: application/json
```

#### Body
Bu endpoint body gerektirmez.

### Response

#### Success (200 OK)
```json
{
  "success": true,
  "subscription": {
    "status": "active",
    "plan": "membership_yearly",
    "renewalDate": "2026-01-15T10:30:00.000Z",
    "membershipDisplayName": "Longevity Premium"
  },
  "message": "Test subscription activated. User now has active yearly membership."
}
```

#### Error Responses

**401 Unauthorized** - Token geçersiz veya eksik
```json
{
  "error": "Unauthorized"
}
```

**403 Forbidden** - Production ortamında çalışmaz
```json
{
  "error": "forbidden",
  "message": "This endpoint is not available in production."
}
```

**500 Internal Server Error** - Sunucu hatası
```json
{
  "error": "Internal server error"
}
```

### Swift Implementation Örneği

```swift
import Foundation
import FirebaseAuth

class SubscriptionService {
    private let baseURL = "https://your-api-url.com"
    
    /// Activate test subscription (development/test only)
    func activateTestSubscription() async throws -> SubscriptionStatus {
        guard let user = Auth.auth().currentUser else {
            throw SubscriptionError.notAuthenticated
        }
        
        // Get fresh ID token
        let idToken = try await user.getIDToken()
        
        // Create request
        guard let url = URL(string: "\(baseURL)/api/subscription/test-bypass") else {
            throw SubscriptionError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        // Perform request
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw SubscriptionError.invalidResponse
        }
        
        // Handle response
        switch httpResponse.statusCode {
        case 200:
            // Parse response
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let success = json["success"] as? Bool,
                  success,
                  let subscriptionDict = json["subscription"] as? [String: Any] else {
                throw SubscriptionError.invalidResponse
            }
            
            // Extract subscription info
            let status = subscriptionDict["status"] as? String ?? "unknown"
            let plan = subscriptionDict["plan"] as? String ?? "unknown"
            let renewalDateString = subscriptionDict["renewalDate"] as? String
            let displayName = subscriptionDict["membershipDisplayName"] as? String ?? "Free"
            
            return SubscriptionStatus(
                status: status,
                plan: plan,
                renewalDate: renewalDateString,
                membershipDisplayName: displayName
            )
            
        case 401:
            throw SubscriptionError.unauthorized
            
        case 403:
            throw SubscriptionError.forbidden("This endpoint is only available in development/test environments.")
            
        case 500:
            throw SubscriptionError.serverError
            
        default:
            throw SubscriptionError.unknownError(httpResponse.statusCode)
        }
    }
}

struct SubscriptionStatus {
    let status: String
    let plan: String
    let renewalDate: String?
    let membershipDisplayName: String
}

enum SubscriptionError: Error, LocalizedError {
    case notAuthenticated
    case invalidURL
    case invalidResponse
    case unauthorized
    case forbidden(String)
    case serverError
    case unknownError(Int)
    
    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "You must be logged in to activate test subscription."
        case .invalidURL:
            return "Invalid server URL."
        case .invalidResponse:
            return "Invalid response from server."
        case .unauthorized:
            return "Your session has expired. Please log in again."
        case .forbidden(let message):
            return message
        case .serverError:
            return "Server error. Please try again later."
        case .unknownError(let code):
            return "Unknown error (code: \(code))."
        }
    }
}
```

### UI Implementation Örneği (Test/Debug Ekranı)

```swift
import SwiftUI

struct TestSubscriptionView: View {
    @StateObject private var subscriptionService = SubscriptionService()
    @State private var isActivating = false
    @State private var subscriptionStatus: SubscriptionStatus?
    @State private var errorMessage: String?
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Test Subscription")
                .font(.title)
                .fontWeight(.bold)
            
            Text("This feature is only available in development/test environments.")
                .font(.caption)
                .foregroundColor(.orange)
                .multilineTextAlignment(.center)
                .padding()
            
            if let status = subscriptionStatus {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Subscription Status")
                        .font(.headline)
                    Text("Status: \(status.status)")
                    Text("Plan: \(status.plan)")
                    if let renewalDate = status.renewalDate {
                        Text("Renewal: \(renewalDate)")
                    }
                    Text("Display: \(status.membershipDisplayName)")
                }
                .padding()
                .background(Color.green.opacity(0.1))
                .cornerRadius(10)
            }
            
            if let errorMessage = errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundColor(.red)
                    .padding()
            }
            
            Button(action: {
                Task {
                    await activateTestSubscription()
                }
            }) {
                Text("Activate Test Subscription")
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.blue)
                    .cornerRadius(10)
            }
            .disabled(isActivating)
        }
        .padding()
    }
    
    private func activateTestSubscription() async {
        isActivating = true
        errorMessage = nil
        
        do {
            let status = try await subscriptionService.activateTestSubscription()
            subscriptionStatus = status
        } catch SubscriptionError.forbidden(let message) {
            errorMessage = message
        } catch {
            errorMessage = error.localizedDescription
        }
        
        isActivating = false
    }
}
```

### Önemli Notlar

1. **Sadece Development/Test**: Bu endpoint sadece development veya test ortamlarında çalışır. Production'da 403 döner.

2. **Otomatik Subscription**: Bu endpoint çağrıldığında, kullanıcıya otomatik olarak 1 yıllık aktif subscription verilir.

3. **Subscription Status Güncelleme**: Subscription aktif olduktan sonra, uygulama içinde subscription status'u kontrol etmek için `POST /api/auth/me` endpoint'ini çağırın.

4. **Test Amaçlı**: Bu endpoint sadece test ve development amaçlıdır. Production'da kullanılmamalıdır.

5. **UI Gizleme**: Production build'lerinde bu butonu/ekranı gizleyin:
   ```swift
   #if DEBUG
   // Test subscription button
   #endif
   ```

---

## Genel Kullanım Senaryoları

### Senaryo 1: Kullanıcı Hesabını Silmek İstiyor

1. Kullanıcı Settings/Profile ekranından "Delete Account" butonuna tıklar
2. Email doğrulama kontrolü yapılır
3. Eğer email doğrulanmamışsa, email doğrulama ekranına yönlendirilir
4. Email doğrulanmışsa, onay dialog'u gösterilir
5. Kullanıcı onaylarsa, `DELETE /api/auth/account` çağrılır
6. Başarılı olursa:
   - Firebase Auth'dan sign out yapılır
   - Local data temizlenir
   - Login ekranına yönlendirilir

### Senaryo 2: Test Kullanıcısı Subscription Aktif Etmek İstiyor

1. Test/Debug ekranından "Activate Test Subscription" butonuna tıklar
2. `POST /api/subscription/test-bypass` çağrılır
3. Başarılı olursa, subscription status gösterilir
4. Uygulama içinde artık premium özelliklere erişilebilir

---

## Hata Yönetimi

Her iki API için de aşağıdaki hata durumlarını handle edin:

1. **Network Errors**: İnternet bağlantısı yoksa kullanıcıya bilgi verin
2. **401 Unauthorized**: Token süresi dolmuş, yeniden login isteyin
3. **403 Forbidden**: 
   - Delete Account: Email doğrulanmamış
   - Test Bypass: Production ortamında çalışmaz
4. **500 Server Error**: Sunucu hatası, tekrar deneme önerin

---

## Güvenlik Notları

1. **Delete Account**: Çok hassas bir işlem olduğu için email doğrulama zorunludur
2. **Test Bypass**: Production'da çalışmaz, sadece development/test ortamlarında kullanılmalıdır
3. **Token Güvenliği**: Token'ları güvenli bir şekilde saklayın ve expire olduğunda yenileyin
4. **HTTPS**: Tüm API çağrıları HTTPS üzerinden yapılmalıdır

