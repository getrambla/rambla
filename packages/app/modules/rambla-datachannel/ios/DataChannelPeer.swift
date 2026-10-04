// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: one WebRTC peer and its DataChannel over libdatachannel's C API.
import Foundation
import libdatachannel

protocol DataChannelPeerEvents: AnyObject {
  func onLocalDescription(sdp: String, type: String)
  func onLocalCandidate(candidate: String, mid: String)
  func onOpen()
  func onText(_ text: String)
  func onBinary(_ data: Data)
  func onBufferedAmountLow()
  func onClosed()
}

struct DataChannelPeerError: Error {
  let code: Int32
}

/// Throws when libdatachannel returns one of its negative error codes.
@discardableResult
private func check(_ result: Int32) throws -> Int32 {
  if result < 0 { throw DataChannelPeerError(code: result) }
  return result
}

/// The peer a libdatachannel callback's user pointer refers to.
private func peer(_ pointer: UnsafeMutableRawPointer?) -> DataChannelPeer? {
  guard let pointer else { return nil }
  return Unmanaged<DataChannelPeer>.fromOpaque(pointer).takeUnretainedValue()
}

final class DataChannelPeer {
  private let connection: Int32
  private let bufferedAmountLowThreshold: Int32
  private let events: DataChannelPeerEvents
  private let lock = NSLock()
  private var channel: Int32 = -1
  private var closed = false
  private var finished = false

  /// Creates the peer connection; the initiator also creates the DataChannel, which starts the offer.
  init(iceServers: [String], initiator: Bool, bufferedAmountLowThreshold: Int, events: DataChannelPeerEvents) throws {
    self.bufferedAmountLowThreshold = Int32(bufferedAmountLowThreshold)
    self.events = events
    let copies = iceServers.map { strdup($0) }
    defer { copies.forEach { free($0) } }
    var servers: [UnsafePointer<CChar>?] = copies.map { UnsafePointer($0) }
    var config = rtcConfiguration()
    connection = try servers.withUnsafeMutableBufferPointer { buffer in
      config.iceServers = buffer.baseAddress
      config.iceServersCount = Int32(buffer.count)
      return try check(rtcCreatePeerConnection(&config))
    }
    rtcSetUserPointer(connection, Unmanaged.passUnretained(self).toOpaque())
    rtcSetLocalDescriptionCallback(connection) { _, sdp, type, pointer in
      guard let sdp, let type else { return }
      peer(pointer)?.events.onLocalDescription(sdp: String(cString: sdp), type: String(cString: type))
    }
    rtcSetLocalCandidateCallback(connection) { _, candidate, mid, pointer in
      guard let candidate, let mid else { return }
      peer(pointer)?.events.onLocalCandidate(candidate: String(cString: candidate), mid: String(cString: mid))
    }
    rtcSetStateChangeCallback(connection) { _, state, pointer in
      if state == RTC_FAILED || state == RTC_CLOSED { peer(pointer)?.finish() }
    }
    if initiator {
      attach(try check(rtcCreateDataChannel(connection, "rambla")))
    } else {
      rtcSetDataChannelCallback(connection) { _, dataChannel, pointer in
        peer(pointer)?.attach(dataChannel)
      }
    }
  }

  deinit {
    close()
  }

  /// Applies the remote side's session description.
  func setRemoteDescription(sdp: String, type: String) throws {
    try check(rtcSetRemoteDescription(connection, sdp, type))
  }

  /// Adds one of the remote side's ICE candidates.
  func addRemoteCandidate(candidate: String, mid: String) throws {
    try check(rtcAddRemoteCandidate(connection, candidate, mid))
  }

  /// Sends a text message on the DataChannel.
  func sendText(_ text: String) {
    let id = currentChannel()
    guard id >= 0 else { return }
    // A negative size tells libdatachannel the data is a null-terminated string.
    text.withCString { _ = rtcSendMessage(id, $0, -1) }
  }

  /// Sends a binary message on the DataChannel.
  func sendBinary(_ data: Data) {
    let id = currentChannel()
    guard id >= 0 else { return }
    data.withUnsafeBytes { bytes in
      _ = rtcSendMessage(id, bytes.bindMemory(to: CChar.self).baseAddress, Int32(bytes.count))
    }
  }

  /// Bytes queued on the DataChannel and not yet sent.
  func bufferedAmount() -> Int {
    let id = currentChannel()
    guard id >= 0 else { return 0 }
    return Int(max(0, rtcGetBufferedAmount(id)))
  }

  /// Closes the DataChannel and the peer connection.
  func close() {
    lock.lock()
    let id = channel
    let wasClosed = closed
    channel = -1
    closed = true
    lock.unlock()
    if id >= 0 { rtcDeleteDataChannel(id) }
    if !wasClosed { rtcDeletePeerConnection(connection) }
  }

  private func currentChannel() -> Int32 {
    lock.lock()
    defer { lock.unlock() }
    return channel
  }

  private func attach(_ dataChannel: Int32) {
    lock.lock()
    channel = dataChannel
    lock.unlock()
    rtcSetUserPointer(dataChannel, Unmanaged.passUnretained(self).toOpaque())
    rtcSetOpenCallback(dataChannel) { _, pointer in
      peer(pointer)?.events.onOpen()
    }
    rtcSetMessageCallback(dataChannel) { _, message, size, pointer in
      guard let message, let target = peer(pointer) else { return }
      if size < 0 {
        target.events.onText(String(cString: message))
      } else {
        target.events.onBinary(Data(bytes: message, count: Int(size)))
      }
    }
    rtcSetBufferedAmountLowThreshold(dataChannel, bufferedAmountLowThreshold)
    rtcSetBufferedAmountLowCallback(dataChannel) { _, pointer in
      peer(pointer)?.events.onBufferedAmountLow()
    }
    rtcSetClosedCallback(dataChannel) { _, pointer in
      peer(pointer)?.finish()
    }
    rtcSetErrorCallback(dataChannel) { _, _, pointer in
      peer(pointer)?.finish()
    }
    if rtcIsOpen(dataChannel) { events.onOpen() }
  }

  private func finish() {
    lock.lock()
    let first = !finished
    finished = true
    lock.unlock()
    if first { events.onClosed() }
  }
}
