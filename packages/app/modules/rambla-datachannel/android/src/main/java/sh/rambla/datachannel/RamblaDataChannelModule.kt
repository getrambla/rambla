// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: Expo module exposing DataChannel peers to JavaScript.
package sh.rambla.datachannel

import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ConcurrentHashMap

class RamblaDataChannelModule : Module() {
  private val peers = ConcurrentHashMap<String, DataChannelPeer>()

  override fun definition() = ModuleDefinition {
    Name("RamblaDataChannel")

    Events("onLocalDescription", "onLocalCandidate", "onOpen", "onText", "onBinary", "onBufferedAmountLow", "onClosed")

    Function("isAvailable") { DirectLink.isAvailable() }

    Function("createPeer") { id: String, iceServers: List<String>, initiator: Boolean, bufferedAmountLowThreshold: Int ->
      peers[id] = DataChannelPeer(iceServers, initiator, bufferedAmountLowThreshold, eventsFor(id))
    }

    Function("setRemoteDescription") { id: String, sdp: String, type: String ->
      peers[id]?.setRemoteDescription(sdp, type)
    }

    Function("addRemoteCandidate") { id: String, candidate: String, mid: String ->
      peers[id]?.addRemoteCandidate(candidate, mid)
    }

    Function("sendText") { id: String, text: String ->
      peers[id]?.sendText(text)
    }

    Function("sendBinary") { id: String, base64: String ->
      peers[id]?.sendBinary(Base64.decode(base64, Base64.NO_WRAP))
    }

    Function("bufferedAmount") { id: String -> peers[id]?.bufferedAmount() ?: 0 }

    Function("close") { id: String ->
      peers.remove(id)?.close()
    }

    OnDestroy {
      peers.values.forEach { it.close() }
      peers.clear()
    }
  }

  private fun eventsFor(id: String) = object : DataChannelPeerEvents {
    override fun onLocalDescription(sdp: String, type: String) =
      sendEvent("onLocalDescription", mapOf("id" to id, "sdp" to sdp, "type" to type))
    override fun onLocalCandidate(candidate: String, mid: String) =
      sendEvent("onLocalCandidate", mapOf("id" to id, "candidate" to candidate, "mid" to mid))
    override fun onOpen() = sendEvent("onOpen", mapOf("id" to id))
    override fun onText(text: String) = sendEvent("onText", mapOf("id" to id, "text" to text))
    override fun onBinary(data: ByteArray) =
      sendEvent("onBinary", mapOf("id" to id, "data" to Base64.encodeToString(data, Base64.NO_WRAP)))
    override fun onBufferedAmountLow() = sendEvent("onBufferedAmountLow", mapOf("id" to id))
    override fun onClosed() {
      peers.remove(id)
      sendEvent("onClosed", mapOf("id" to id))
    }
  }
}
