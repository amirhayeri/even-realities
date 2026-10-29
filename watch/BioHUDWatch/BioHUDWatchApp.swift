import SwiftUI

@main
struct BioHUDWatchApp: App {
    @StateObject private var workout = WorkoutManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(workout)
                .task { await workout.requestAuthorization() }
        }
    }
}
