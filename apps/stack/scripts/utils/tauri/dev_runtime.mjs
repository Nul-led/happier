import { applyStackTauriOverrides } from './stack_overrides.mjs';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeTauriConfig(baseValue, overlayValue) {
  if (Array.isArray(overlayValue)) {
    return overlayValue.map((entry) => entry);
  }
  if (!isPlainObject(baseValue) || !isPlainObject(overlayValue)) {
    return overlayValue === undefined ? baseValue : overlayValue;
  }

  const out = { ...baseValue };
  for (const [key, value] of Object.entries(overlayValue)) {
    out[key] = mergeTauriConfig(baseValue[key], value);
  }
  return out;
}

function hasStackTauriOverride(env = {}) {
  return String(env?.HAPPIER_STACK_STACK ?? '').trim() !== ''
    || String(env?.HAPPIER_STACK_TAURI_IDENTIFIER ?? '').trim() !== ''
    || String(env?.HAPPIER_STACK_TAURI_PRODUCT_NAME ?? '').trim() !== ''
    || String(env?.HAPPIER_STACK_TAURI_CREATE_UPDATER_ARTIFACTS ?? '').trim() !== ''
    || String(env?.TAURI_SIGNING_PRIVATE_KEY ?? '').trim() !== '';
}

function applyHtml5FileDragDropWindowPolicy(config) {
  if (!Array.isArray(config?.app?.windows)) return config;
  config.app.windows = config.app.windows.map((windowConfig) => ({
    ...windowConfig,
    dragDropEnabled: false,
  }));
  return config;
}

function omitNativeReleaseEvidenceResources(resources) {
  if (!isPlainObject(resources)) return resources;
  return Object.fromEntries(
    Object.entries(resources).filter(([sourcePath]) => (
      !sourcePath.replaceAll('\\', '/').includes('/iroh-native/release-evidence/')
    )),
  );
}

export function resolveStackTauriDevUrl({ runtimeState, defaultPort = 8081, verifiedUiEndpoint = null } = {}) {
  if (verifiedUiEndpoint && typeof verifiedUiEndpoint === 'object') {
    const verifiedPort = Number(verifiedUiEndpoint.port);
    if (verifiedUiEndpoint.running === true && Number.isFinite(verifiedPort) && verifiedPort > 0) {
      return `http://localhost:${Math.floor(verifiedPort)}`;
    }
  }

  const expo = runtimeState && typeof runtimeState === 'object' ? runtimeState.expo : null;
  const expoPort = Number(expo?.webPort ?? expo?.port ?? 0);
  if (!verifiedUiEndpoint && Number.isFinite(expoPort) && expoPort > 0) {
    return `http://localhost:${Math.floor(expoPort)}`;
  }

  // When a runtime snapshot is active, the web UI is served via the stack server (no Expo/Metro).
  // Prefer the stack server port so the Tauri WebView can connect without requiring a dev server.
  const hasRuntimeSnapshot = Boolean(
    runtimeState
    && typeof runtimeState === 'object'
    && String(runtimeState.runtimeSnapshotId ?? '').trim(),
  );
  const serverPort = Number(runtimeState?.ports?.server ?? 0);
  if (hasRuntimeSnapshot && Number.isFinite(serverPort) && serverPort > 0) {
    return `http://localhost:${Math.floor(serverPort)}`;
  }

  return `http://localhost:${defaultPort}`;
}

export function buildStackTauriDevConfig({ baseConfig, overlayConfig, devUrl, env = process.env } = {}) {
  const merged = mergeTauriConfig(baseConfig ?? {}, overlayConfig ?? {});
  merged.build = {
    ...(merged.build ?? {}),
    devUrl: String(devUrl ?? '').trim() || 'http://localhost:8081',
    beforeDevCommand: '',
    beforeBuildCommand: '',
  };
  if (isPlainObject(merged.bundle)) {
    // Native notices and the SBOM are release-representation inputs generated
    // by the release/build preparation owner. Tauri validates configured
    // resource paths even for `tauri dev`, so retaining them here makes an
    // ordinary source-driven development build depend on absent release
    // evidence. Omit only those release inputs for development; release configs
    // keep the base map and `tauri:prepare:build` still generates them.
    merged.bundle = {
      ...merged.bundle,
      resources: omitNativeReleaseEvidenceResources(merged.bundle.resources),
    };
  }
  if (hasStackTauriOverride(env)) {
    applyStackTauriOverrides({ tauriConfig: merged, env, baseProductName: 'Happier' });
  }
  return applyHtml5FileDragDropWindowPolicy(merged);
}
