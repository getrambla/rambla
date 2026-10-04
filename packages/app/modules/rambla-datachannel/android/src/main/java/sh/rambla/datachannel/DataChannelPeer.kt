// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: one WebRTC peer and its DataChannel over libdatachannel-java.
package sh.rambla.datachannel

import java.net.URI
import java.util.concurrent.atomic.AtomicBoolean
import tel.schich.libdatachannel.DataChannel
import tel.schich.libdatachannel.DataChannelCallback
import tel.schich.libdatachannel.PeerConnection
import tel.schich.libdatachannel.PeerConnectionConfiguration
import tel.schich.libdatachannel.PeerState
import tel.schich.libdatachannel.SessionDescriptionType

interface DataChannelPeerEvents {
  fun onLocalDescription(sdp: String, type: String)
  fun onLocalCandidate(candidate: String, mid: String)
  fun onOpen()
  fun onText(text: String)
  fun onBinary(data: ByteArray)
  fun onBufferedAmountLow()
  fun onClosed()
}

private val descriptionTypes = mapOf(
  "offer" to SessionDescriptionType.OFFER,
  "answer" to SessionDescriptionType.ANSWER,
  "pranswer" to SessionDescriptionType.PROVISIONAL_ANSWER,
  "rollback" to SessionDescriptionType.ROLLBACK,
)

/** Only construct when `DirectLink.isAvailable()`: constructing it loads libdatachannel. */
class DataChannelPeer(
  iceServers: List<String>,
  initiator: Boolean,
  private val bufferedAmountLowThreshold: Int,
  private val events: DataChannelPeerEvents,
) {
  private val connection = PeerConnection.createPeer(
    PeerConnectionConfiguration.DEFAULT.withIceServers(iceServers.map(URI::create)),
  )
  @Volatile private var channel: DataChannel? = null
  private val closed = AtomicBoolean(false)

  init {
    connection.onLocalDescription.register { _, sdp, type ->
      events.onLocalDescription(sdp, descriptionTypes.entries.first { it.value == type }.key)
    }
    connection.onLocalCandidate.register { _, candidate, mid -> events.onLocalCandidate(candidate, mid) }
    connection.onStateChange.register { _, state ->
      if (state == PeerState.RTC_FAILED || state == PeerState.RTC_CLOSED) finish()
    }
    if (initiator) attach(connection.createDataChannel("rambla"))
    else connection.onDataChannel.register { _, dataChannel -> attach(dataChannel) }
  }

  /** Applies the remote side's session description. */
  fun setRemoteDescription(sdp: String, type: String) {
    connection.setRemoteDescription(sdp, descriptionTypes.getValue(type))
  }

  /** Adds one of the remote side's ICE candidates. */
  fun addRemoteCandidate(candidate: String, mid: String) {
    connection.addRemoteCandidate(candidate, mid)
  }

  /** Sends a text message on the DataChannel. */
  fun sendText(text: String) {
    channel?.sendMessage(text)
  }

  /** Sends a binary message on the DataChannel. */
  fun sendBinary(data: ByteArray) {
    val buffer = java.nio.ByteBuffer.allocateDirect(data.size)
    buffer.put(data).flip()
    channel?.sendMessage(buffer)
  }

  /** Bytes queued on the DataChannel and not yet sent. */
  fun bufferedAmount(): Int = channel?.bufferedAmount() ?: 0

  /** Closes the DataChannel and the peer connection. */
  fun close() {
    channel?.close()
    connection.close()
    finish()
  }

  private fun attach(dataChannel: DataChannel) {
    channel = dataChannel
    dataChannel.onOpen.register { _ -> events.onOpen() }
    dataChannel.onMessage.register(object : DataChannelCallback.Message {
      override fun onText(channel: DataChannel, text: String) = events.onText(text)
      override fun onBinary(channel: DataChannel, buffer: java.nio.ByteBuffer) {
        val bytes = ByteArray(buffer.remaining())
        buffer.get(bytes)
        events.onBinary(bytes)
      }
    })
    dataChannel.bufferedAmountLowThreshold(bufferedAmountLowThreshold)
    dataChannel.onBufferedAmountLow.register { _ -> events.onBufferedAmountLow() }
    dataChannel.onClosed.register { _ -> finish() }
    dataChannel.onError.register { _, _ -> finish() }
    if (dataChannel.isOpen) events.onOpen()
  }

  private fun finish() {
    if (closed.compareAndSet(false, true)) events.onClosed()
  }
}
