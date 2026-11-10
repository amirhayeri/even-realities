import SwiftUI

/// One rule on every screen: at most one thing listens to the digital crown.
/// Paged TabViews, wheel pickers and scroll views all claim it; mixing them
/// with our own crown handler made watchOS log "grossly inefficient view
/// performance" and the app stalled. So: no TabView, no wheel, no ScrollView.
struct ContentView: View {
    @EnvironmentObject var w: WorkoutManager

    var body: some View {
        if w.running {
            live
        } else {
            NavigationStack { idle }
        }
    }

    // MARK: idle

    private var idle: some View {
        VStack(spacing: 6) {
            // Both choices open a plain list; nothing here uses the crown.
            if w.playlists.isEmpty {
                Text("No playlists yet").font(.footnote).foregroundStyle(.secondary)
            } else {
                Picker(selection: Binding(get: { w.playlist }, set: { w.choose($0) })) {
                    ForEach(w.playlists) { p in Text(p.name).tag(Optional(p)) }
                } label: {
                    Label(w.playlist?.name ?? "Playlist", systemImage: "music.note.list").lineLimit(1)
                }
                .pickerStyle(.navigationLink)
                .font(.footnote)
            }
            Picker(selection: $w.kind) {
                ForEach(WorkoutManager.Kind.allCases) { k in
                    Label(k.rawValue, systemImage: k.symbol).tag(k)
                }
            } label: {
                Label(w.kind.rawValue, systemImage: w.kind.symbol)
            }
            .pickerStyle(.navigationLink)
            .font(.footnote)
            Button { w.start() } label: {
                Label("Start", systemImage: "play.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
            .disabled(!w.authorized)
            Text(w.status).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
        }
        .padding(.horizontal)
        .task { if w.playlists.isEmpty { await w.loadPlaylists() } }
    }

    // MARK: live: one screen, the Watch is the ring

    @State private var crown = 0.0
    @State private var crownBase = 0.0
    @State private var menuOpen = false

    private var live: some View {
        VStack(spacing: 6) {
            // Stats. Tap = play/pause, hold = menu, like the ring.
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text("\(Int(w.heartRate))").font(.system(size: 40, weight: .semibold, design: .rounded)).monospacedDigit()
                    Text("bpm").foregroundStyle(.secondary)
                    Spacer()
                    Text(timeString(w.shownElapsed)).font(.title3).monospacedDigit().foregroundStyle(w.paused ? .yellow : .primary)
                }
                HStack {
                    Label("\(Int(w.steps))", systemImage: "figure.walk")
                    Spacer()
                    Label("\(Int(w.activeKcal))", systemImage: "flame")
                    Spacer()
                    Text(String(format: "%.2f km", w.distanceM / 1000))
                }
                .font(.footnote).foregroundStyle(.secondary)
            }
            .contentShape(Rectangle())
            .onTapGesture { w.toggleMusic() }
            .onLongPressGesture(minimumDuration: 0.5) { menuOpen = true }

            // Always-visible controls: previous, play/pause, next, menu.
            HStack(spacing: 6) {
                Button { w.prevTrack() } label: { Image(systemName: "backward.fill").frame(maxWidth: .infinity) }
                Button { w.toggleMusic() } label: { Image(systemName: "playpause.fill").frame(maxWidth: .infinity) }
                Button { w.skipTrack() } label: { Image(systemName: "forward.fill").frame(maxWidth: .infinity) }
                Button { menuOpen = true } label: { Image(systemName: "ellipsis").frame(maxWidth: .infinity) }
                    .tint(.gray)
            }
            .buttonStyle(.bordered)
            .tint(.green)
        }
        .padding(.horizontal)
        // Crown = ring scroll: one detent per track. The only crown user on this screen.
        .focusable(true)
        .digitalCrownRotation($crown, from: -10_000, through: 10_000, by: 1, sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
        .onChange(of: crown) { _, v in
            let d = v - crownBase
            if abs(d) >= 1 { crownBase = v; w.crownScroll(forward: d > 0) }
        }
        .confirmationDialog("Bio HUD", isPresented: $menuOpen, titleVisibility: .visible) {
            Button(w.paused ? "Resume timer" : "Pause timer") { w.togglePause() }
            Button("Reset timer") { w.resetTimer() }
            Button("Lens: \(w.brightnessName) → \(w.nextBrightnessName)") { w.cycleBrightness() }
            Button("Face: \(w.faceName) → \(w.nextFaceName)") { w.toggleFace() }
            Button("End workout", role: .destructive) { w.end() }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func timeString(_ t: TimeInterval) -> String {
        let s = Int(t)
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60) : String(format: "%02d:%02d", s / 60, s % 60)
    }
}
