import Foundation
import HealthKit
import Combine

/// Owns the HealthKit workout session. Starting here instead of Apple's Workout
/// app is what makes live heart rate available: the session is ours, so the
/// builder hands us every sample as it arrives. Rings and Fitness history fill
/// exactly as they would with Apple's app, it is the same HKWorkout.
@MainActor
final class WorkoutManager: NSObject, ObservableObject {
    enum Kind: String, CaseIterable, Identifiable {
        case run = "Run", walk = "Walk", strength = "Strength", cycle = "Cycle", hiit = "HIIT"
        var id: String { rawValue }
        var activity: HKWorkoutActivityType {
            switch self {
            case .run: return .running
            case .walk: return .walking
            case .strength: return .traditionalStrengthTraining
            case .cycle: return .cycling
            case .hiit: return .highIntensityIntervalTraining
            }
        }
        var location: HKWorkoutSessionLocationType { self == .strength || self == .hiit ? .indoor : .outdoor }
        var endpointType: String { rawValue.lowercased() }
        var symbol: String {
            switch self {
            case .run: return "figure.run"
            case .walk: return "figure.walk"
            case .strength: return "dumbbell.fill"
            case .cycle: return "figure.outdoor.cycle"
            case .hiit: return "figure.highintensity.intensitytraining"
            }
        }
    }

    @Published var kind: Kind = .strength
    @Published var playlists: [Uploader.Playlist] = []
    @Published var playlist: Uploader.Playlist?
    @Published var running = false
    @Published var paused = false
    @Published var heartRate: Double = 0
    @Published var steps: Double = 0
    @Published var activeKcal: Double = 0
    @Published var distanceM: Double = 0
    @Published var elapsed: TimeInterval = 0
    @Published var authorized = false
    @Published var status = "idle"

    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var timer: Timer?
    private var lastUpload = Date.distantPast
    private var lastZone = 0
    private func zone(_ hr: Double, max: Int) -> Int {
        let p = hr / Double(max)
        return p < 0.6 ? 1 : p < 0.7 ? 2 : p < 0.8 ? 3 : p < 0.9 ? 4 : 5
    }
    private let uploader = Uploader()

    func requestAuthorization() async {
        guard HKHealthStore.isHealthDataAvailable() else { status = "no HealthKit"; return }
        // The live builder writes every type it collects into the workout, so each
        // one needs share permission or the builder drops into an error state.
        let quantities: [HKQuantityTypeIdentifier] = [
            .heartRate, .stepCount, .activeEnergyBurned, .basalEnergyBurned,
            .distanceWalkingRunning, .distanceCycling,
        ]
        var read: Set<HKObjectType> = Set(quantities.map { HKQuantityType($0) })
        read.insert(HKObjectType.activitySummaryType())
        var share: Set<HKSampleType> = Set(quantities.map { HKQuantityType($0) })
        share.insert(HKQuantityType.workoutType())
        do {
            try await store.requestAuthorization(toShare: share, read: read)
            authorized = true
            status = permissionSummary()
        } catch {
            status = "auth failed: \(error.localizedDescription)"
        }
        recoverStaleSession()
        await loadPlaylists()
    }

    func loadPlaylists() async {
        let list = await uploader.fetchPlaylists()
        playlists = list
        let remembered = UserDefaults.standard.string(forKey: "playlist.uri")
        playlist = list.first { $0.uri == remembered } ?? list.first
    }

    func choose(_ p: Uploader.Playlist?) {
        playlist = p
        UserDefaults.standard.set(p?.uri, forKey: "playlist.uri")
    }

    func nextKind() {
        let all = Kind.allCases
        kind = all[(all.firstIndex(of: kind)! + 1) % all.count]
    }

    /// watchOS keeps a workout session alive after the app quits. A new session
    /// cannot start while one exists, so end any leftover one at launch.
    private func recoverStaleSession() {
        store.recoverActiveWorkoutSession { [weak self] session, error in
            Task { @MainActor in
                guard let self else { return }
                if let session, session.state != .ended, session.state != .notStarted {
                    self.status = "ending a leftover session…"
                    session.end()
                    let b = session.associatedWorkoutBuilder()
                    b.endCollection(withEnd: Date()) { _, _ in b.finishWorkout { _, _ in Task { @MainActor in self.status = self.permissionSummary() } } }
                } else if let error {
                    self.status = "ready (\(error.localizedDescription))"
                }
            }
        }
    }

    /// Plain-language HealthKit status for the screen: the workout write
    /// permission is the one that stops a session from starting.
    func permissionSummary() -> String {
        func name(_ st: HKAuthorizationStatus) -> String {
            switch st { case .sharingAuthorized: return "yes"; case .sharingDenied: return "DENIED"; default: return "not asked" }
        }
        let w = store.authorizationStatus(for: HKQuantityType.workoutType())
        let hr = store.authorizationStatus(for: HKQuantityType(.heartRate))
        let e = store.authorizationStatus(for: HKQuantityType(.activeEnergyBurned))
        return "write workouts: \(name(w)) · HR: \(name(hr)) · energy: \(name(e))"
    }

    func start() {
        guard !running else { return }
        // Make sure the write permission exists before touching a session.
        let w = store.authorizationStatus(for: HKQuantityType.workoutType())
        if w == .notDetermined { Task { await requestAuthorization(); if store.authorizationStatus(for: HKQuantityType.workoutType()) == .sharingAuthorized { start() } }; status = "asking for Health permission…"; return }
        if w == .sharingDenied { status = "Workouts write is OFF. Watch: Settings → Privacy & Security → Health → Bio HUD"; return }
        let config = HKWorkoutConfiguration()
        config.activityType = kind.activity
        config.locationType = kind.location
        do {
            let s = try HKWorkoutSession(healthStore: store, configuration: config)
            let b = s.associatedWorkoutBuilder()
            let source = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
            // The live data source only collects the types Apple deems typical for
            // the activity: a strength session gets heart rate and energy, no steps
            // and no distance. Ask for them explicitly or the lens shows 0 forever.
            for t in [HKQuantityTypeIdentifier.stepCount, .distanceWalkingRunning, .distanceCycling, .activeEnergyBurned, .heartRate] {
                source.enableCollection(for: HKQuantityType(t), predicate: nil)
            }
            b.dataSource = source
            s.delegate = self
            b.delegate = self
            session = s; builder = b
            let now = Date()
            s.startActivity(with: now)
            b.beginCollection(withStart: now) { [weak self] ok, err in
                Task { @MainActor in
                    guard let self else { return }
                    if ok { self.running = true; self.paused = false; self.status = "live"; self.uploader.workoutStart(type: self.kind.endpointType, startedAt: now, playlist: self.playlist?.uri); self.uploader.control("/display", body: ["face": self.face]); self.startTimer() }
                    else {
                        let ns = err as NSError?
                        self.status = "start failed [\(ns?.code ?? 0)]: \(ns?.localizedDescription ?? "no error given")"
                        s.end(); self.session = nil; self.builder = nil
                    }
                }
            }
        } catch {
            status = "session error: \(error.localizedDescription)"
        }
    }

    func togglePause() {
        guard let session else { return }
        if paused { session.resume() } else { session.pause() }
        paused.toggle()
        uploader.control("/pause")                  // the lens timer and Spotify follow
    }

    // Ring controls, on the wrist: the ring comes off for bars and dumbbells.
    // Each one posts to the Worker; the glasses pick it up within seconds.
    @Published var brightness = 3
    private var resetBase: TimeInterval = 0        // elapsed shown = builder elapsed - resetBase
    var shownElapsed: TimeInterval { max(0, elapsed - resetBase) }
    func skipTrack() { uploader.control("/music/next") }
    func prevTrack() { uploader.control("/music/prev") }
    /// Crown detents arrive in bursts; one track change per half second, like the ring.
    private var lastCrown = Date.distantPast
    func crownScroll(forward: Bool) {
        guard Date().timeIntervalSince(lastCrown) >= 0.5 else { return }
        lastCrown = Date()
        if forward { skipTrack() } else { prevTrack() }
    }
    var brightnessName: String { ["", "dim", "medium", "bright"][brightness] }
    var nextBrightnessName: String { ["", "dim", "medium", "bright"][brightness <= 1 ? 3 : brightness - 1] }
    func toggleMusic() { uploader.control("/music/toggle") }
    func resetTimer() {
        resetBase = elapsed
        uploader.control("/workout/reset")
    }
    func cycleBrightness() {
        brightness = brightness <= 1 ? 3 : brightness - 1
        uploader.control("/display", body: ["brightness": brightness])
    }

    /// Lens face: "glucose" puts the CGM number on top of the workout tile,
    /// "classic" keeps the timer there and hides glucose everywhere. Remembered
    /// on the Watch and re-sent at each workout start so the lens always matches.
    @Published var face: String = UserDefaults.standard.string(forKey: "lens.face") ?? "glucose"
    var faceName: String { face == "classic" ? "Classic" : "Glucose" }
    var nextFaceName: String { face == "classic" ? "Glucose" : "Classic" }
    func toggleFace() {
        face = face == "classic" ? "glucose" : "classic"
        UserDefaults.standard.set(face, forKey: "lens.face")
        uploader.control("/display", body: ["face": face])
    }

    func end() {
        guard let session, let builder else { return }
        timer?.invalidate(); timer = nil
        session.end()
        builder.endCollection(withEnd: Date()) { [weak self] _, _ in
            builder.finishWorkout { _, _ in
                Task { @MainActor in
                    guard let self else { return }
                    self.running = false; self.paused = false; self.status = "saved"; self.resetBase = 0
                    self.uploader.workoutEnd()
                    self.session = nil; self.builder = nil
                }
            }
        }
    }

    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let b = self.builder else { return }
                self.elapsed = b.elapsedTime
                self.readStats()
                // Cadence comes from the Worker's last reply (Z1 60 s, Z2 30 s, Z3+ 15 s);
                // a zone change posts immediately so the lens can wake for it.
                let z = self.zone(self.heartRate, max: self.uploader.hrMax)
                let zoneChanged = z != self.lastZone && self.heartRate > 0
                if zoneChanged { self.lastZone = z }
                if zoneChanged || Date().timeIntervalSince(self.lastUpload) >= Double(self.uploader.nextMs) / 1000 {
                    self.lastUpload = Date()
                    self.uploader.health(hr: self.heartRate > 0 ? self.heartRate : nil, steps: self.steps, kcal: self.activeKcal, distanceM: self.distanceM)
                    self.status = self.uploader.lastStatus.isEmpty ? "live" : self.uploader.lastStatus
                }
            }
        }
    }

    private func readStats() {
        guard let b = builder else { return }
        if let hr = b.statistics(for: HKQuantityType(.heartRate))?.mostRecentQuantity()?.doubleValue(for: .count().unitDivided(by: .minute())) { heartRate = hr }
        if let kcal = b.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie()) { activeKcal = kcal }
        let distType: HKQuantityType = kind == .cycle ? HKQuantityType(.distanceCycling) : HKQuantityType(.distanceWalkingRunning)
        if let d = b.statistics(for: distType)?.sumQuantity()?.doubleValue(for: .meter()) { distanceM = d }
        if let st = b.statistics(for: HKQuantityType(.stepCount))?.sumQuantity()?.doubleValue(for: .count()) { steps = st }
    }
}

extension WorkoutManager: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(_ s: HKWorkoutSession, didChangeTo to: HKWorkoutSessionState, from: HKWorkoutSessionState, date: Date) {
        Task { @MainActor in
            switch to {
            case .running: self.paused = false
            case .paused: self.paused = true
            default: break
            }
        }
    }
    nonisolated func workoutSession(_ s: HKWorkoutSession, didFailWithError error: Error) {
        let ns = error as NSError
        Task { @MainActor in self.status = "session failed [\(ns.domain) \(ns.code)]: \(ns.localizedDescription)" }
    }
}

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilder(_ b: HKLiveWorkoutBuilder, didCollectDataOf types: Set<HKSampleType>) {
        Task { @MainActor in self.readStats() }
    }
    nonisolated func workoutBuilderDidCollectEvent(_ b: HKLiveWorkoutBuilder) {}
}
