// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: whether this phone can run the direct link.
package sh.rambla.datachannel

import android.os.Build

object DirectLink {
  /** True from Android 13, the first release with the `java.lang.ref.Cleaner` libdatachannel-java needs. */
  fun isAvailable(): Boolean = Build.VERSION.SDK_INT >= 33
}
