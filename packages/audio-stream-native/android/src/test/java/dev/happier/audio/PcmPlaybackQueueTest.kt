package dev.happier.audio

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PcmPlaybackQueueTest {
  @Test
  fun preservesAnEntireFastGeneratedBurstAcrossPartialPlatformWrites() {
    val queue = PcmPlaybackQueue()
    val first = ByteArray(24_000 * 2 * 4) { 1 }
    val second = ByteArray(24_000 * 2 * 4) { 2 }
    val third = ByteArray(24_000 * 2 * 4) { 3 }
    queue.enqueue(first)
    queue.enqueue(second)
    queue.enqueue(third)
    val rendered = java.io.ByteArrayOutputStream()
    while (!queue.isEmpty()) {
      queue.write { data, offset, length ->
        val accepted = minOf(length, 480)
        rendered.write(data, offset, accepted)
        accepted
      }
    }
    assertArrayEquals(first + second + third, rendered.toByteArray())
  }

  @Test
  fun preservesPlatformBackpressureAndDropsTheEntirePendingTailOnClear() {
    val queue = PcmPlaybackQueue()
    queue.enqueue(byteArrayOf(1, 2, 3, 4))
    assertEquals(0, queue.write { _, _, _ -> 0 })
    assertFalse(queue.isEmpty())
    assertEquals(2, queue.write { data, offset, _ ->
      assertEquals(0, offset)
      assertArrayEquals(byteArrayOf(1, 2, 3, 4), data)
      2
    })
    queue.clear()
    assertTrue(queue.isEmpty())
    queue.enqueue(byteArrayOf(5, 6))
    assertEquals(2, queue.write { data, offset, length ->
      assertEquals(0, offset)
      assertArrayEquals(byteArrayOf(5, 6), data)
      length
    })
    assertTrue(queue.isEmpty())
  }

  @Test
  fun keepsPendingBytesOnATerminalWriteFailureUntilTheOwnerReleasesThem() {
    val queue = PcmPlaybackQueue()
    queue.enqueue(byteArrayOf(1, 2))
    assertEquals(-6, queue.write { _, _, _ -> -6 })
    assertFalse(queue.isEmpty())
    queue.clear()
    assertTrue(queue.isEmpty())
  }
}
