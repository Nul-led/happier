package dev.happier.iroh

import android.content.Context
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [35])
class IrohEndpointIdentityStoreTest {
  private lateinit var context: Context
  private lateinit var key: SecretKey

  @Before
  fun setUp() {
    context = RuntimeEnvironment.getApplication()
    key = SecretKeySpec(ByteArray(32) { index -> index.toByte() }, "AES")
  }

  @Test
  fun survivingAliasWithoutWrappedSeedFailsClosedInsteadOfProvisioning() {
    val preferences = freshPreferences("missing-wrapped-seed")
    var provisioned = false
    val store = IrohEndpointIdentityStore(
      preferences = preferences,
      loadExistingKey = { key },
      createKey = { provisioned = true; key },
      createSeed = { ByteArray(32) { 9 } },
    )

    val error = assertThrows(EndpointIdentityException::class.java) { store.loadOrCreate() }

    assertEquals("endpoint_key_unavailable", error.code)
    assertFalse(provisioned)
    assertFalse(preferences.contains("ciphertext"))
    assertFalse(preferences.contains("iv"))
  }

  @Test
  fun firstProvisionRequiresNeitherAliasNorWrappedMaterial() {
    val preferences = freshPreferences("first-provision")
    val seed = ByteArray(32) { index -> (index + 1).toByte() }
    var provisionCount = 0
    val store = IrohEndpointIdentityStore(
      preferences = preferences,
      loadExistingKey = { null },
      createKey = { provisionCount += 1; key },
      createSeed = { seed.copyOf() },
    )

    assertArrayEquals(seed, store.loadOrCreate())
    assertEquals(1, provisionCount)
    assertTrue(preferences.contains("ciphertext"))
    assertTrue(preferences.contains("iv"))
  }

  @Test
  fun partialWrappedMaterialFailsClosedWithoutProvisioning() {
    val preferences = freshPreferences("partial-material")
    preferences.edit().putString("ciphertext", "present-without-iv").commit()
    var provisioned = false
    val store = IrohEndpointIdentityStore(
      preferences = preferences,
      loadExistingKey = { null },
      createKey = { provisioned = true; key },
    )

    val error = assertThrows(EndpointIdentityException::class.java) { store.loadOrCreate() }

    assertEquals("endpoint_key_unavailable", error.code)
    assertFalse(provisioned)
  }

  @Test
  fun retainedWrappedSeedDecryptsUnchangedWithoutGeneratingAgain() {
    val preferences = freshPreferences("retained-seed")
    val originalSeed = ByteArray(32) { index -> (index + 11).toByte() }
    var provisionCount = 0
    var generationCount = 0
    val first = IrohEndpointIdentityStore(
      preferences = preferences,
      loadExistingKey = { null },
      createKey = { provisionCount += 1; key },
      createSeed = { generationCount += 1; originalSeed.copyOf() },
    ).loadOrCreate()

    val retained = IrohEndpointIdentityStore(
      preferences = preferences,
      loadExistingKey = { key },
      createKey = { throw AssertionError("retained identity must not provision another key") },
      createSeed = { throw AssertionError("retained identity must not generate another seed") },
    ).loadOrCreate()

    assertArrayEquals(originalSeed, first)
    assertArrayEquals(originalSeed, retained)
    assertEquals(1, provisionCount)
    assertEquals(1, generationCount)
  }

  private fun freshPreferences(suffix: String) = context
    .getSharedPreferences("iroh-endpoint-identity-test-$suffix", Context.MODE_PRIVATE)
    .also { it.edit().clear().commit() }
}
