#!/usr/bin/env node
// Typed lifecycle smoke for source and packaged hosts. The same script runs in
// Node, Bun, and a Bun-compiled executable; --package-root points Node/Bun at
// an extracted release payload while a compiled smoke beside node_modules
// exercises the loader's production default discovery.
import { loadIrohNodeNative } from "../dist/nodeNative.js";

const packageRootFlag = process.argv.indexOf("--package-root");
const packageRoot = packageRootFlag >= 0
  ? String(process.argv[packageRootFlag + 1] ?? "").trim()
  : undefined;
if (packageRootFlag >= 0 && !packageRoot) {
  throw new Error("--package-root requires a value");
}
const loaded = loadIrohNodeNative(packageRoot);
if (!loaded.available) {
  throw new Error(loaded.message);
}
const native = loaded.native;

// Real loopback endpoint lifecycle (relay disabled: no external traffic).
const created = await native.createEndpoint({ relayPolicy: "disabled" });
const status = await native.getEndpointStatus(created.endpointHandle);
if (!status?.endpointId || !Array.isArray(status.directAddresses)) {
  throw new Error(`endpoint status missing identity/addresses: ${JSON.stringify(status)}`);
}
await native.shutdownEndpoint({ endpointHandle: created.endpointHandle });
const afterShutdown = await native.getEndpointStatus(created.endpointHandle);
if (afterShutdown !== null) throw new Error("endpoint remained active after shutdown");

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;
process.stdout.write(`loaded ${loaded.addonPath} in ${runtime} (endpoint ${status.endpointId})\n`);
