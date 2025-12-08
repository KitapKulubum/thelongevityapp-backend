import SwiftUI

// MARK: - Request / Response Models

struct DailyUpdateRequest: Encodable {
    let userId: String
    let chronologicalAgeYears: Double
    let metrics: Metrics

    struct Metrics: Encodable {
        let date: String
        let sleepHours: Double
        let steps: Int
        let vigorousMinutes: Int
        let processedFoodScore: Int
        let alcoholUnits: Int
        let stressLevel: Int
        let lateCaffeine: Bool
        let screenLate: Bool
        let bedtimeHour: Double
    }
}

struct DailyUpdateResponse: Decodable {
    let state: BiologicalAgeState
    let today: TodayEntry
}

struct BiologicalAgeState: Decodable {
    let chronologicalAgeYears: Double
    let baselineBiologicalAgeYears: Double
    let currentBiologicalAgeYears: Double
    let agingDebtYears: Double
    let rejuvenationStreakDays: Int
    let accelerationStreakDays: Int
    let totalRejuvenationDays: Int
    let totalAccelerationDays: Int
}

struct TodayEntry: Decodable {
    let date: String
    let score: Int
    let deltaYears: Double
    let reasons: [String]
}

// MARK: - Main View

struct DailyCheckInView: View {
    // Form state
    @State private var sleepHours: Double = 7.5
    @State private var stepsText: String = ""
    @State private var vigorousMinutesText: String = ""
    @State private var stressLevel: Double = 5
    @State private var lateCaffeine: Bool = false
    @State private var lateScreenUsage: Bool = false
    @State private var bedtimeHour: Double = 22.5

    // Networking state
    @State private var isSaving: Bool = false
    @State private var showAlert: Bool = false
    @State private var alertMessage: String = ""

    // Result state
    @State private var hasResult: Bool = false
    @State private var currentBiologicalAge: Double?
    @State private var agingDebt: Double?
    @State private var rejuvenationStreak: Int?
    @State private var todayScore: Int?
    @State private var todayDeltaYears: Double?

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("Today's Longevity Check-In")
                        .font(.largeTitle.bold())
                        .padding(.top, 8)

                    formSection
                    submitButton
                    resultCard

                    Spacer(minLength: 16)
                }
                .padding()
            }
            .navigationBarHidden(true)
        }
        .alert(isPresented: $showAlert) {
            Alert(
                title: Text("Longevity Check-In"),
                message: Text(alertMessage),
                dismissButton: .default(Text("OK"))
            )
        }
    }

    // MARK: - Form Section

    private var formSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Sleep
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Sleep Hours")
                    Spacer()
                    Text(String(format: "%.1f h", sleepHours))
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                Slider(value: $sleepHours, in: 4...10, step: 0.5)
            }

            // Steps
            VStack(alignment: .leading, spacing: 8) {
                Text("Steps")
                TextField("e.g. 8000", text: $stepsText)
                    .keyboardType(.numberPad)
                    .padding(10)
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
            }

            // Vigorous minutes
            VStack(alignment: .leading, spacing: 8) {
                Text("Vigorous Minutes")
                TextField("e.g. 20", text: $vigorousMinutesText)
                    .keyboardType(.numberPad)
                    .padding(10)
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
            }

            // Stress
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Stress Level")
                    Spacer()
                    Text("\(Int(stressLevel))/10")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                Slider(value: $stressLevel, in: 1...10, step: 1)
            }

            // Toggles
            Toggle("Had caffeine after 15:00", isOn: $lateCaffeine)
            Toggle("Heavy screen use before bed", isOn: $lateScreenUsage)

            // Bedtime
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Bedtime")
                    Spacer()
                    Text("\(bedtimeLabel(for: bedtimeHour))")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                Slider(value: $bedtimeHour, in: 20...24, step: 0.5)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(16)
    }

    // MARK: - Submit Button

    private var submitButton: some View {
        Button(action: {
            submit()
        }) {
            HStack {
                if isSaving {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle())
                } else {
                    Text("Save & See My Biological Age")
                        .fontWeight(.semibold)
                }
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding()
            .background(LinearGradient(
                gradient: Gradient(colors: [Color.blue, Color.green]),
                startPoint: .leading,
                endPoint: .trailing
            ))
            .cornerRadius(16)
        }
        .disabled(isSaving)
    }

    // MARK: - Result Card

    private var resultCard: some View {
        Group {
            if hasResult,
               let bioAge = currentBiologicalAge,
               let debt = agingDebt,
               let streak = rejuvenationStreak,
               let score = todayScore,
               let delta = todayDeltaYears {

                VStack(alignment: .leading, spacing: 8) {
                    Text("Today's Result")
                        .font(.title3.bold())

                    Text(String(format: "Biological Age: %.2f years", bioAge))
                        .font(.headline)

                    Text(String(format: "Aging Debt: %.2f years", debt))
                        .foregroundColor(debt > 0 ? .red : .green)

                    Text("Rejuvenation Streak: \(streak) day\(streak == 1 ? "" : "s")")
                        .foregroundColor(streak > 0 ? .green : .secondary)

                    Text("Today's Score: \(score)")
                        .foregroundColor(score >= 0 ? .green : .red)

                    Text(String(format: "Today's Δ Age: %.3f years", delta))
                        .font(.footnote)
                        .foregroundColor(delta < 0 ? .green : .red)
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(16)
                .padding(.top, 16)
            }
        }
    }

    // MARK: - Helpers

    private func bedtimeLabel(for value: Double) -> String {
        let hour = Int(value)
        let half = value - Double(hour) > 0
        if half {
            return String(format: "%02d:30", hour)
        } else {
            return String(format: "%02d:00", hour)
        }
    }

    private func submit() {
        guard let steps = Int(stepsText),
              let vigorous = Int(vigorousMinutesText) else {
            alertMessage = "Please enter valid numbers for steps and vigorous minutes."
            showAlert = true
            return
        }

        isSaving = true

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let today = formatter.string(from: Date())

        let metrics = DailyUpdateRequest.Metrics(
            date: today,
            sleepHours: sleepHours,
            steps: steps,
            vigorousMinutes: vigorous,
            processedFoodScore: 3,
            alcoholUnits: 0,
            stressLevel: Int(stressLevel),
            lateCaffeine: lateCaffeine,
            screenLate: lateScreenUsage,
            bedtimeHour: bedtimeHour
        )

        let body = DailyUpdateRequest(
            userId: "gizem-demo",
            chronologicalAgeYears: 32,
            metrics: metrics
        )

        guard let url = URL(string: "http://localhost:4000/api/age/daily-update") else {
            alertMessage = "Invalid backend URL."
            showAlert = true
            isSaving = false
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            let encoder = JSONEncoder()
            request.httpBody = try encoder.encode(body)
        } catch {
            alertMessage = "Failed to encode request."
            showAlert = true
            isSaving = false
            return
        }

        URLSession.shared.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                self.isSaving = false
            }

            if let error = error {
                print("Request error:", error)
                DispatchQueue.main.async {
                    self.alertMessage = "Network error: \(error.localizedDescription)"
                    self.showAlert = true
                }
                return
            }

            guard let data = data else {
                DispatchQueue.main.async {
                    self.alertMessage = "No data from server."
                    self.showAlert = true
                }
                return
            }

            if let raw = String(data: data, encoding: .utf8) {
                print("Age update response:", raw)
            }

            do {
                let decoder = JSONDecoder()
                let response = try decoder.decode(DailyUpdateResponse.self, from: data)

                DispatchQueue.main.async {
                    self.currentBiologicalAge = response.state.currentBiologicalAgeYears
                    self.agingDebt = response.state.agingDebtYears
                    self.rejuvenationStreak = response.state.rejuvenationStreakDays
                    self.todayScore = response.today.score
                    self.todayDeltaYears = response.today.deltaYears
                    self.hasResult = true

                    self.alertMessage = "Today's data saved. Your biological age is updated."
                    self.showAlert = true
                }
            } catch {
                print("Decode error:", error)
                DispatchQueue.main.async {
                    self.alertMessage = "Saved, but could not read age result."
                    self.showAlert = true
                }
            }
        }.resume()
    }
}

struct DailyCheckInView_Previews: PreviewProvider {
    static var previews: some View {
        DailyCheckInView()
    }
}

