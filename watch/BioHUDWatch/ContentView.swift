import SwiftUI

struct ContentView: View {
    @EnvironmentObject var w: WorkoutManager

    var body: some View {
        if w.running {
            // Page 1 is the ring: crown turns = next/previous track, tap = play/pause,
            // hold = menu. Page 2 keeps plain buttons for the same things.
            TabView { ring; buttons }
                .tabViewStyle(.page)
        } else {
            NavigationStack { idle }
        }
    }

    // MARK: idle

    private var idle: some View {
        // No ScrollView here: a wheel picker and a scroll view both want the
        // crown on watchOS and the screen stops responding.
        VStack(spacing: 6) {
            if w.playlists.isEmpty {
                Text("No playlists yet").font(.footnote).foregroundStyle(.secondary).frame(height: 56)
            } else {
                Picker("Playlist", selection: Binding(get: { w.playlist }, set: { w.choose($0) })) {
                    ForEach(w.playlists) { p in Text(p.name).tag(Optional(p)) }
                }
                .pickerStyle(.wheel)
                .frame(height: 56)
            }
            // A full-width row that opens a list: the old side-by-side button
            // truncated "Strength" on a 41 mm watch.
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

    // MARK: live, as the ring

    @State private var crown = 0.0
    @State private var crownBase = 0.0
    @State private var menuOpen = false

    private var ring: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(Int(w.heartRate))").font(.system(size: 44, weight: .semibold, design: .rounded)).monospacedDigit()
                Text("bpm").foregroundStyle(.secondary)
                Spacer()
                Image(systemName: "heart.fill").foregroundStyle(.red)
            }
            Text(timeString(w.shownElapsed)).font(.title3).monospacedDigit().foregroundStyle(w.paused ? .yellow : .primary)
            HStack {
                Label("\(Int(w.steps))", systemImage: "figure.walk")
                Spacer()
                Label("\(Int(w.activeKcal))", systemImage: "flame")
                Spacer()
                Text(String(format: "%.2f km", w.distanceM / 1000))
            }
            .font(.footnote).foregroundStyle(.secondary)
            Spacer(minLength: 2)
            Text(w.status).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
        }
        .padding(.horizontal)
        .contentShape(Rectangle())
        // Tap = ring tap (play/pause). Hold = ring hold (menu).
        .onTapGesture { w.toggleMusic() }
        .onLongPressGesture(minimumDuration: 0.5) { menuOpen = true }
        // Crown = ring scroll. One detent per track, debounced like the ring.
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

    // MARK: live, as buttons

    private var buttons: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Button { w.prevTrack() } label: { Image(systemName: "backward.fill").frame(maxWidth: .infinity) }
                Button { w.toggleMusic() } label: { Image(systemName: "playpause.fill").frame(maxWidth: .infinity) }
                Button { w.skipTrack() } label: { Image(systemName: "forward.fill").frame(maxWidth: .infinity) }
            }
            .buttonStyle(.bordered)
            .tint(.green)
            HStack(spacing: 8) {
                Button { w.togglePause() } label: {
                    Image(systemName: w.paused ? "play.fill" : "pause.fill").frame(maxWidth: .infinity)
                }
                .tint(.yellow)
                Button { w.resetTimer() } label: {
                    Image(systemName: "arrow.counterclockwise").frame(maxWidth: .infinity)
                }
                .tint(.orange)
                Button { w.end() } label: {
                    Image(systemName: "stop.fill").frame(maxWidth: .infinity)
                }
                .tint(.red)
            }
            .buttonStyle(.bordered)
            // Lens settings: brightness (sun grows with the level) and the face
            // (drop = glucose on top, timer = classic, no glucose).
            HStack(spacing: 8) {
                Button { w.cycleBrightness() } label: {
                    Image(systemName: w.brightness == 1 ? "sun.min" : w.brightness == 2 ? "sun.min.fill" : "sun.max.fill")
                        .frame(maxWidth: .infinity)
                }
                Button { w.toggleFace() } label: {
                    Image(systemName: w.face == "classic" ? "timer" : "drop.fill")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.bordered)
            .tint(.gray)
        }
        .padding(.horizontal)
    }

    private func timeString(_ t: TimeInterval) -> String {
        let s = Int(t)
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60) : String(format: "%02d:%02d", s / 60, s % 60)
    }
}
