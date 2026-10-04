// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: Expo module exposing DataChannel peers to JavaScript.
import ExpoModulesCore
import Foundation

public class RamblaDataChannelModule: Module {
  private let lock = NSLock()
  private var peers: [String: DataChannelPeer] = [:]

  /// Declares the module's JavaScript functions and events.
  public func definition() -> ModuleDefinition {
    Name("RamblaDataChannel")

    Events("onLocalDescription", "onLocalCandidate", "onOpen", "onText", "onBinary", "onBufferedAmountLow", "onClosed")

    Function("isAvailable") { DirectLink.isAvailable() }

    Function("createPeer") { (id: String, iceServers: [String], initiator: Bool, bufferedAmountLowThreshold: Int) in
      let peer = try DataChannelPeer(
        iceServers: iceServers,
        initiator: initiator,
        bufferedAmountLowThreshold: bufferedAmountLowThreshold,
        events: PeerEvents(module: self, id: id)
      )
      self.withPeers { $0[id] = peer }
    }

    Function("setRemoteDescription") { (id: String, sdp: String, type: String) -> Void in
      try self.peer(id)?.setRemoteDescription(sdp: sdp, type: type)
    }

    Function("addRemoteCandidate") { (id: String, candidate: String, mid: String) -> Void in
      try self.peer(id)?.addRemoteCandidate(candidate: candidate, mid: mid)
    }

    Function("sendText") { (id: String, text: String) -> Void in
      self.peer(id)?.sendText(text)
    }

    Function("sendBinary") { (id: String, base64: String) -> Void in
      guard let data = Data(base64Encoded: base64) else { return }
      self.peer(id)?.sendBinary(data)
    }

    Function("bufferedAmount") { (id: String) -> Int in
      self.peer(id)?.bufferedAmount() ?? 0
    }

    Function("close") { (id: String) -> Void in
      self.withPeers { $0.removeValue(forKey: id) }?.close()
    }

    OnDestroy {
      self.withPeers { peers in
        let all = Array(peers.values)
        peers.removeAll()
        return all
      }.forEach { $0.close() }
    }
  }

  /// The live peer with this id, if any.
  fileprivate func peer(_ id: String) -> DataChannelPeer? {
    withPeers { $0[id] }
  }

  /// Runs `body` on the peer table under the lock.
  fileprivate func withPeers<T>(_ body: (inout [String: DataChannelPeer]) -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return body(&peers)
  }
}

/// Forwards one peer's events to JavaScript, tagged with the peer's id.
private final class PeerEvents: DataChannelPeerEvents {
  private weak var module: RamblaDataChannelModule?
  private let id: String

  init(module: RamblaDataChannelModule, id: String) {
    self.module = module
    self.id = id
  }

  func onLocalDescription(sdp: String, type: String) {
    module?.sendEvent("onLocalDescription", ["id": id, "sdp": sdp, "type": type])
  }

  func onLocalCandidate(candidate: String, mid: String) {
    module?.sendEvent("onLocalCandidate", ["id": id, "candidate": candidate, "mid": mid])
  }

  func onOpen() {
    module?.sendEvent("onOpen", ["id": id])
  }

  func onText(_ text: String) {
    module?.sendEvent("onText", ["id": id, "text": text])
  }

  func onBinary(_ data: Data) {
    module?.sendEvent("onBinary", ["id": id, "data": data.base64EncodedString()])
  }

  func onBufferedAmountLow() {
    module?.sendEvent("onBufferedAmountLow", ["id": id])
  }

  func onClosed() {
    _ = module?.withPeers { $0.removeValue(forKey: id) }
    module?.sendEvent("onClosed", ["id": id])
  }
}
