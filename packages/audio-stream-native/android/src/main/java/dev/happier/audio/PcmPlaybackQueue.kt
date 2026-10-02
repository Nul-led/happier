package dev.happier.audio

/** Ordered response PCM waiting for AudioTrack's platform-owned output buffer.
 * Access is serialized by the enclosing player's playbackLock.
 */
internal class PcmPlaybackQueue {
  private val chunks = java.util.ArrayDeque<ByteArray>()
  private var offset = 0

  fun enqueue(data: ByteArray) {
    chunks.addLast(data)
  }

  fun isEmpty(): Boolean = chunks.isEmpty()

  fun write(writer: (ByteArray, Int, Int) -> Int): Int {
    val data = chunks.peekFirst() ?: return 0
    val remaining = data.size - offset
    val written = writer(data, offset, remaining)
    check(written <= remaining) { "invalid_playback_write_result" }
    if (written > 0) {
      offset += written
      if (offset == data.size) {
        chunks.removeFirst()
        offset = 0
      }
    }
    return written
  }

  fun clear() {
    chunks.clear()
    offset = 0
  }
}
