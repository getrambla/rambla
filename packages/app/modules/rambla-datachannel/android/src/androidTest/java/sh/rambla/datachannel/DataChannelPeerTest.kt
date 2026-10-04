// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: native test of the phone module's direct link.
package sh.rambla.datachannel

import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DataChannelPeerTest {
  @Test fun reportsTheDirectLinkAvailableOnlyFromAndroid13() {
    assertEquals(Build.VERSION.SDK_INT >= 33, DirectLink.isAvailable())
  }

  @Test fun belowAndroid13ReportsUnavailableWithoutLoadingLibdatachannel() {
    assumeTrue(Build.VERSION.SDK_INT < 33)
    assertFalse(DirectLink.isAvailable())
    assertFalse("libdatachannel must not load below Android 13", libdatachannelLoaded())
  }

  @Test fun fromAndroid13CreatesAPeerThatProducesALocalOffer() {
    assumeTrue(Build.VERSION.SDK_INT >= 33)
    val described = CountDownLatch(1)
    var localType: String? = null
    var localSdp: String? = null
    val peer = DataChannelPeer(listOf("stun:localhost:3478"), true, 4 * 1024 * 1024, object : DataChannelPeerEvents {
      override fun onLocalDescription(sdp: String, type: String) {
        if (described.count == 0L) return
        localSdp = sdp
        localType = type
        described.countDown()
      }
      override fun onLocalCandidate(candidate: String, mid: String) {}
      override fun onOpen() {}
      override fun onText(text: String) {}
      override fun onBinary(data: ByteArray) {}
      override fun onBufferedAmountLow() {}
      override fun onClosed() {}
    })
    try {
      assertTrue("no local description within 10 s", described.await(10, TimeUnit.SECONDS))
      assertEquals("offer", localType)
      assertTrue("offer carries no data channel: $localSdp", localSdp!!.contains("m=application"))
      assertTrue(libdatachannelLoaded())
    } finally {
      peer.close()
    }
  }

  private fun libdatachannelLoaded() = File("/proc/self/maps").readText().contains("libdatachannel-java.so")
}
