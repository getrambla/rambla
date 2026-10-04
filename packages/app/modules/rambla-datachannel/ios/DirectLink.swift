// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: whether this phone can run the direct link.
enum DirectLink {
  /// True on every iOS the app supports: the libdatachannel pod runs from iOS 13.
  static func isAvailable() -> Bool { true }
}
