/**
 * Testkit boundary for the canonical Iroh test controller.
 *
 * The single adapter implementation is package-owned by
 * `@happier-dev/iroh-native` (subpath `./test-controller`), next to the raw
 * `test-relay-fixture` addon surface it adapts; app-level real-integration
 * tests that cannot reach this workspace import the package subpath directly.
 * This re-export keeps the historical testkit import path for suites in this
 * workspace without owning a second implementation.
 */
export {
  createIrohTestController,
  createIrohTestControllerFromNativeAddon,
  IrohTestController,
  type IrohTestControllerNative,
} from '@happier-dev/iroh-native/test-controller';
