import Foundation

/// Posts workout events and health samples to the HUD endpoint. One request in
/// flight at a time, latest sample wins, so a slow link never builds a backlog.
final class Uploader {
    private let session: URLSession
    private var inFlight = false
    private var pending: [String: Any]?
    private(set) var lastStatus = ""

    init() {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 8
        cfg.waitsForConnectivity = false
        session = URLSession(configuration: cfg)
    }

    func workoutStart(type: String, startedAt: Date) {
        post(path: "/workout/start", body: ["type": type, "startedAt": Int(startedAt.timeIntervalSince1970 * 1000)], force: true)
    }

    func workoutEnd() {
        post(path: "/workout/end", body: [:], force: true)
    }

    /// Called up to once per second; coalesces while a request is in flight.
    func health(hr: Double?, steps: Double?, kcal: Double?, distanceM: Double?) {
        var body: [String: Any] = [:]
        if let hr { body["hr"] = Int(hr.rounded()) }
        if let steps { body["steps"] = Int(steps.rounded()) }
        if let kcal { body["activeKcal"] = Int(kcal.rounded()) }
        if let distanceM { body["distanceM"] = Int(distanceM.rounded()) }
        guard !body.isEmpty else { return }
        post(path: "/health", body: body, force: false)
    }

    private func post(path: String, body: [String: Any], force: Bool) {
        if inFlight && !force { pending = body; return }
        inFlight = true
        var req = URLRequest(url: URL(string: Config.endpoint + path + "?token=" + Config.token)!)
        req.httpMethod = "POST"
        req.setValue("Bearer \(Config.token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        session.dataTask(with: req) { [weak self] _, resp, err in
            guard let self else { return }
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            self.lastStatus = err.map { "error: \($0.localizedDescription)" } ?? "\(path) \(code)"
            self.inFlight = false
            if let next = self.pending { self.pending = nil; self.post(path: "/health", body: next, force: false) }
        }.resume()
    }
}
