// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: native test of the phone module's direct link.
import XCTest
@testable import RamblaDataChannel

private final class RecordingEvents: DataChannelPeerEvents {
  let described: XCTestExpectation
  var sdp: String?
  var type: String?

  init(described: XCTestExpectation) {
    self.described = described
  }

  func onLocalDescription(sdp: String, type: String) {
    guard self.sdp == nil else { return }
    self.sdp = sdp
    self.type = type
    described.fulfill()
  }
  func onLocalCandidate(candidate: String, mid: String) {}
  func onOpen() {}
  func onText(_ text: String) {}
  func onBinary(_ data: Data) {}
  func onBufferedAmountLow() {}
  func onClosed() {}
}

final class DataChannelPeerTests: XCTestCase {
  func testReportsTheDirectLinkAvailable() {
    XCTAssertTrue(DirectLink.isAvailable())
  }

  func testCreatesAPeerThatProducesALocalOffer() throws {
    let events = RecordingEvents(described: expectation(description: "local description"))
    let peer = try DataChannelPeer(
      iceServers: ["stun:localhost:3478"],
      initiator: true,
      bufferedAmountLowThreshold: 4 * 1024 * 1024,
      events: events
    )
    defer { peer.close() }
    wait(for: [events.described], timeout: 10)
    XCTAssertEqual(events.type, "offer")
    XCTAssertTrue(events.sdp?.contains("m=application") ?? false, "offer carries no data channel: \(events.sdp ?? "")")
  }
}
