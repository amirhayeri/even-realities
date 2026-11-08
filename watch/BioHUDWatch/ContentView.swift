import SwiftUI

struct ContentView: View {
    @EnvironmentObject var w: WorkoutManager

    var body: some View {
        if w.running {
            // Page 1: the numbers. Page 2: the ring's controls, for when the ring is off.
            TabView { live; controls }
                .tabViewStyle(.page)
        } else { idle }
    }

    private var controls: some View {
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
                    Label(w.paused ? "Resume" : "Pause", systemImage: w.paused ? "play.fill" : "pause.fill").frame(maxWidth: .infinity)
                }
                .tint(.yellow)
                Button(role: .destructive) { w.resetTimer() } label: {
                    Label("Reset", systemImage: "arrow.counterclockwise").frame(maxWidth: .infinity)
                }
                .tint(.orange)
            }
            .buttonStyle(.bordered)
            .font(.footnote)
            Button { w.cycleBrightness() } label: {
                Label("Lens \(["", "dim", "medium", "bright"][w.brightness])", systemImage: w.brightness == 1 ? "sun.min" : w.brightness == 2 ? "sun.min.fill" : "sun.max.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(.gray)
            .font(.footnote)
        }
        .padding(.horizontal)
    }

    private var idle: some View {
        VStack(spacing: 6) {
            if w.playlists.isEmpty {
                Text("No playlists yet").font(.footnote).foregroundStyle(.secondary).frame(height: 70)
            } else {
                Picker("Playlist", selection: Binding(get: { w.playlist }, set: { w.choose($0) })) {
                    ForEach(w.playlists) { p in Text(p.name).tag(Optional(p)) }
                }
                .pickerStyle(.wheel)
                .frame(height: 70)
            }
            HStack {
                Button { w.nextKind() } label: {
                    Label(w.kind.rawValue, systemImage: "figure.run").font(.footnote)
                }
                .buttonStyle(.bordered)
                .tint(.gray)
                Button { w.start() } label: {
                    Label("Start", systemImage: "play.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .disabled(!w.authorized)
            }
            Text(w.status).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(2)
        }
        .padding(.horizontal)
        .task { if w.playlists.isEmpty { await w.loadPlaylists() } }
    }

    private var live: some View {
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
            HStack {
                Button { w.togglePause() } label: { Image(systemName: w.paused ? "play.fill" : "pause.fill") }
                    .tint(.yellow)
                Button { w.end() } label: { Image(systemName: "stop.fill") }
                    .tint(.red)
            }
            .buttonStyle(.bordered)
            Text(w.status).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
        }
        .padding(.horizontal)
    }

    private func timeString(_ t: TimeInterval) -> String {
        let s = Int(t)
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60) : String(format: "%02d:%02d", s / 60, s % 60)
    }
}
