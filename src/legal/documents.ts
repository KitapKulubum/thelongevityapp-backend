/**
 * Legal documents content (Privacy Policy and Terms of Service)
 * Versioned for compliance tracking
 */

export interface LegalDocument {
  version: string;
  lastUpdated: string;
  content: string;
}

// Current versions
export const PRIVACY_POLICY_VERSION = '1.0';
export const TERMS_OF_SERVICE_VERSION = '1.0';

const PRIVACY_POLICY_LAST_UPDATED = '2024-01-15';
const TERMS_OF_SERVICE_LAST_UPDATED = '2024-01-15';

/**
 * Privacy Policy (English with Turkish KVKK section)
 */
export const PRIVACY_POLICY: LegalDocument = {
  version: PRIVACY_POLICY_VERSION,
  lastUpdated: PRIVACY_POLICY_LAST_UPDATED,
  content: `# Privacy Policy

**Last Updated: ${PRIVACY_POLICY_LAST_UPDATED}**

## 1. Introduction

The Longevity App ("we", "us", "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, store, and protect your personal information when you use our mobile application.

## 2. Information We Collect

We collect the following types of personal information:

### 2.1 Account Information
- **Email address**: Required for account creation and authentication
- **First name**: Optional, for personalization
- **Date of birth**: Required for biological age calculations

### 2.2 Usage Data
- Daily check-in data (sleep, steps, exercise, nutrition, stress levels)
- Biological age metrics and calculations
- Streak information (rejuvenation and acceleration streaks)
- App usage patterns

### 2.3 Technical Data
- Device information
- Timezone settings
- App version and platform information

## 3. How We Use Your Information

We use your personal information for the following purposes:

- **Account Management**: To create and manage your account, authenticate your identity
- **Biological Age Calculation**: To calculate and track your biological age based on your inputs
- **App Functionality**: To provide personalized features, track streaks, and display your progress
- **Service Improvement**: To analyze usage patterns and improve our services (anonymized where possible)
- **Communication**: To send you important updates about the service (you can opt out)

## 4. Data Storage and Retention

- Your data is stored securely using Firebase (Google Cloud Platform)
- We retain your personal data for as long as your account is active
- Upon account deletion, we will delete your personal data within 30 days, except where we are required to retain it for legal purposes
- Aggregated, anonymized data may be retained for analytical purposes

## 5. Data Sharing

We share your data only in the following circumstances:

### 5.1 Service Providers
- **Firebase/Google Cloud**: For hosting, authentication, and data storage
- **Apple**: For subscription management and payment processing (if applicable)

### 5.2 Legal Requirements
We may disclose your information if required by law or to protect our rights and safety.

### 5.3 Business Transfers
In the event of a merger, acquisition, or sale, your data may be transferred to the new entity.

**We do NOT sell your personal data to third parties.**

## 6. Your Rights

You have the following rights regarding your personal data:

- **Access**: Request a copy of your personal data
- **Correction**: Update or correct inaccurate information
- **Deletion**: Request deletion of your account and personal data
- **Objection**: Object to certain processing activities
- **Data Portability**: Request your data in a portable format

To exercise these rights, please contact us at: privacy@thelongevityapp.com

## 7. Data Security

We implement appropriate technical and organizational measures to protect your personal data, including:
- Encryption in transit and at rest
- Secure authentication mechanisms
- Regular security assessments

## 8. Children's Privacy

Our service is not intended for users under the age of 13. We do not knowingly collect personal information from children under 13.

## 9. Changes to This Policy

We may update this Privacy Policy from time to time. We will notify you of significant changes by:
- Posting the updated policy in the app
- Sending an email notification (if you have provided an email)
- Requiring re-acceptance of the updated policy

## 10. Contact Us

If you have questions about this Privacy Policy or wish to exercise your rights, please contact us at:

**Email**: privacy@thelongevityapp.com

---

# KVKK Aydınlatma Metni

**Son Güncelleme: ${PRIVACY_POLICY_LAST_UPDATED}**

## 1. Veri Sorumlusu

**The Longevity App**  
E-posta: privacy@thelongevityapp.com

## 2. İşlenen Kişisel Veriler

6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") kapsamında aşağıdaki kişisel verileriniz işlenmektedir:

- **Kimlik Bilgileri**: Ad, soyad
- **İletişim Bilgileri**: E-posta adresi
- **Sağlık Verileri**: Doğum tarihi, günlük check-in verileri (uyku, adım, egzersiz, beslenme, stres seviyeleri)
- **İşlem Güvenliği Bilgileri**: Hesap bilgileri, kullanım verileri
- **Lokasyon Verileri**: Zaman dilimi ayarları

## 3. Kişisel Verilerin İşlenme Amaçları

Kişisel verileriniz aşağıdaki amaçlarla işlenmektedir:

- Hesap oluşturma ve yönetimi
- Biyolojik yaş hesaplama ve takibi
- Uygulama özelliklerinin sağlanması
- Kullanıcı deneyiminin iyileştirilmesi
- Yasal yükümlülüklerin yerine getirilmesi

## 4. Kişisel Verilerin İşlenmesinin Hukuki Sebepleri

Kişisel verileriniz aşağıdaki hukuki sebeplere dayanarak işlenmektedir:

- **Sözleşme**: Hizmet sözleşmesinin kurulması ve ifası (KVKK m. 5/2-c)
- **Meşru Menfaat**: Hizmetlerin iyileştirilmesi ve geliştirilmesi (KVKK m. 5/2-f)
- **Açık Rıza**: Belirli özellikler için (varsa)

## 5. Kişisel Verilerin Aktarılması

Kişisel verileriniz aşağıdaki durumlarda aktarılabilir:

- **Firebase/Google Cloud**: Veri barındırma ve depolama hizmetleri
- **Apple**: Abonelik yönetimi ve ödeme işlemleri (varsa)
- **Yasal Zorunluluklar**: Yasal yükümlülüklerin yerine getirilmesi amacıyla

## 6. KVKK Madde 11 Kapsamındaki Haklarınız

KVKK'nın 11. maddesi uyarınca aşağıdaki haklara sahipsiniz:

1. **Bilgi Talep Etme**: Kişisel verilerinizin işlenip işlenmediğini öğrenme
2. **Erişim Hakkı**: İşlenen kişisel verileriniz hakkında bilgi talep etme
3. **Düzeltme Hakkı**: Yanlış veya eksik işlenen verilerin düzeltilmesini isteme
4. **Silme Hakkı**: KVKK'da öngörülen şartlar çerçevesinde verilerin silinmesini isteme
5. **İtiraz Hakkı**: İşlenmesine itiraz etme
6. **Veri Taşınabilirliği**: Verilerinizin başka bir veri sorumlusuna aktarılmasını isteme
7. **İşleme Faaliyetine İtiraz**: Otomatik sistemlerle analiz edilmesine itiraz etme

## 7. Başvuru Yöntemi

Haklarınızı kullanmak için aşağıdaki yöntemlerle başvurabilirsiniz:

**E-posta**: privacy@thelongevityapp.com

Başvurunuzda kimliğinizi tespit edici bilgiler ve talep ettiğiniz hak kapsamındaki açıklamalarınızı içeren yazılı başvurunuzu iletebilirsiniz.

Başvurunuza ilişkin yanıt, başvurunun alındığı tarihten itibaren en geç 30 (otuz) gün içinde tarafınıza iletilecektir.

## 8. Veri Güvenliği

Kişisel verilerinizin güvenliği için teknik ve idari tedbirler alınmaktadır. Verileriniz şifreleme, güvenli kimlik doğrulama mekanizmaları ve düzenli güvenlik değerlendirmeleri ile korunmaktadır.

## 9. Değişiklikler

Bu aydınlatma metni güncellenebilir. Önemli değişiklikler uygulama içinde duyurulacak ve güncellenmiş metni kabul etmeniz istenecektir.`,
};

/**
 * Terms of Service
 */
export const TERMS_OF_SERVICE: LegalDocument = {
  version: TERMS_OF_SERVICE_VERSION,
  lastUpdated: TERMS_OF_SERVICE_LAST_UPDATED,
  content: `# Terms of Service

**Last Updated: ${TERMS_OF_SERVICE_LAST_UPDATED}**

## 1. Acceptance of Terms

By accessing or using The Longevity App ("the App", "the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not use the Service.

## 2. Description of Service

The Longevity App is a mobile application that:
- Calculates and tracks your biological age based on daily health metrics
- Provides personalized insights and recommendations
- Tracks your progress over time through streaks and analytics
- Offers AI-powered chat features for health-related questions

## 3. User Responsibilities

### 3.1 Account Security
- You are responsible for maintaining the confidentiality of your account credentials
- You must notify us immediately of any unauthorized use of your account
- You are responsible for all activities that occur under your account

### 3.2 Accurate Information
- You agree to provide accurate, current, and complete information during registration
- You agree to update your information to keep it accurate and current

### 3.3 Acceptable Use
You agree NOT to:
- Use the Service for any illegal purpose
- Attempt to gain unauthorized access to the Service
- Interfere with or disrupt the Service
- Use automated systems to access the Service without permission
- Share your account with others

## 4. Health Disclaimer

**IMPORTANT: The Longevity App does not provide medical advice, diagnosis, or treatment.**

- The biological age calculations and recommendations are for informational and educational purposes only
- The App is not a substitute for professional medical advice, diagnosis, or treatment
- Always seek the advice of qualified health providers with any questions you may have regarding a medical condition
- Never disregard professional medical advice or delay in seeking it because of information provided by the App
- If you think you may have a medical emergency, call your doctor or emergency services immediately

## 5. Subscription and Billing

### 5.1 Subscriptions
- The App may offer premium features through in-app subscriptions
- Subscriptions are managed through Apple's App Store
- Subscription fees are charged to your Apple ID account

### 5.2 Billing Terms
- Subscription fees are charged in advance on a recurring basis
- You can cancel your subscription at any time through your Apple ID account settings
- Cancellation will take effect at the end of the current billing period
- No refunds are provided for partial subscription periods

### 5.3 Price Changes
- We reserve the right to change subscription prices
- Price changes will be communicated in advance
- Your continued use of the Service after a price change constitutes acceptance

## 6. Intellectual Property

- The Service and its content are protected by copyright, trademark, and other intellectual property laws
- You may not copy, modify, distribute, or create derivative works based on the Service
- All rights not expressly granted are reserved

## 7. Account Termination and Deletion

### 7.1 Termination by You
- You may delete your account at any time through the App settings
- Account deletion is permanent and cannot be undone
- Upon deletion, your data will be removed within 30 days (except where required by law)

### 7.2 Termination by Us
We may suspend or terminate your account if:
- You violate these Terms
- You engage in fraudulent or illegal activity
- We are required to do so by law

## 8. Limitation of Liability

**TO THE MAXIMUM EXTENT PERMITTED BY LAW:**

- The Service is provided "AS IS" and "AS AVAILABLE" without warranties of any kind
- We do not guarantee that the Service will be uninterrupted, secure, or error-free
- We are not liable for any indirect, incidental, special, or consequential damages
- Our total liability shall not exceed the amount you paid for the Service in the 12 months preceding the claim

## 9. Indemnification

You agree to indemnify and hold harmless The Longevity App, its officers, directors, employees, and agents from any claims, damages, losses, or expenses arising from:
- Your use of the Service
- Your violation of these Terms
- Your violation of any rights of another party

## 10. Governing Law

These Terms shall be governed by and construed in accordance with the laws of [Jurisdiction], without regard to its conflict of law provisions.

## 11. Dispute Resolution

Any disputes arising from these Terms or the Service shall be resolved through:
- Good faith negotiation
- If negotiation fails, through binding arbitration or courts as applicable

## 12. Changes to Terms

We may modify these Terms at any time. We will notify you of material changes by:
- Posting the updated Terms in the App
- Requiring re-acceptance of the updated Terms

Your continued use of the Service after changes constitutes acceptance of the new Terms.

## 13. Severability

If any provision of these Terms is found to be unenforceable, the remaining provisions shall remain in full effect.

## 14. Contact Information

For questions about these Terms, please contact us at:

**Email**: legal@thelongevityapp.com

## 15. Entire Agreement

These Terms, together with our Privacy Policy, constitute the entire agreement between you and The Longevity App regarding the Service.`,
};

/**
 * Get current Privacy Policy
 */
export function getPrivacyPolicy(): LegalDocument {
  return PRIVACY_POLICY;
}

/**
 * Get current Terms of Service
 */
export function getTermsOfService(): LegalDocument {
  return TERMS_OF_SERVICE;
}

