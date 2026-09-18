const { withAndroidManifest, withMainApplication } = require('@expo/config-plugins');

const SERVICE = 'dev.happier.activitynotifications.ActivityFirebaseMessagingService';
const TOKEN_BRIDGE = 'dev.happier.activitynotifications.ActivityNotificationTokenBridge';
const EXPO_SERVICE = 'expo.modules.notifications.service.ExpoFirebaseMessagingService';
const PROCESS_CHECK = 'dev.happier.activitynotifications.ActivityNotificationProcess.isCurrent(this)';

function configureManifest(manifest, storageScope) {
  const application = manifest.manifest.application?.[0];
  if (!application) throw new Error('Activity notifications require an Android application.');
  manifest.manifest.$ = { ...manifest.manifest.$, 'xmlns:tools': 'http://schemas.android.com/tools' };
  application.service = (application.service || []).filter((row) => ![SERVICE, EXPO_SERVICE].includes(row.$['android:name']));
  application.service.push(
    { $: { 'android:name': EXPO_SERVICE, 'tools:node': 'remove' } },
    {
      $: { 'android:name': SERVICE, 'android:exported': 'false', 'android:process': ':happier_activity_notifications' },
      'intent-filter': [{ action: [{ $: { 'android:name': 'com.google.firebase.MESSAGING_EVENT' } }] }],
    },
  );
  // Firebase token refresh is delivered to the isolated messaging process; this
  // app-process receiver hands it back to the incumbent Expo token owner. It is
  // reached only by explicit component, so it stays unexported.
  application.receiver = (application.receiver || []).filter((row) => row.$['android:name'] !== TOKEN_BRIDGE);
  application.receiver.push({ $: { 'android:name': TOKEN_BRIDGE, 'android:exported': 'false' } });
  const name = 'dev.happier.activitynotifications.STORAGE_SCOPE';
  application['meta-data'] = (application['meta-data'] || []).filter((row) => row.$['android:name'] !== name);
  if (storageScope) application['meta-data'].push({ $: { 'android:name': name, 'android:value': storageScope } });
  return manifest;
}

function configureApplication(contents, language) {
  if (contents.includes(PROCESS_CHECK)) return contents;
  const pattern = language === 'java'
    ? /(public\s+void\s+onCreate\s*\(\s*\)\s*\{\s*super\.onCreate\(\);)/
    : /(override\s+fun\s+onCreate\s*\(\s*\)\s*\{\s*super\.onCreate\(\))/;
  if (!pattern.test(contents)) throw new Error('Cannot guard MainApplication initialization for native Activity notifications.');
  return contents.replace(pattern, `$1\n    if (${PROCESS_CHECK}) return${language === 'java' ? ';' : ''}`);
}

function withActivityNotificationsAndroid(config, { storageScope } = {}) {
  config = withAndroidManifest(config, (mod) => {
    configureManifest(mod.modResults, storageScope);
    return mod;
  });
  return withMainApplication(config, (mod) => {
    mod.modResults.contents = configureApplication(mod.modResults.contents, mod.modResults.language);
    return mod;
  });
}
module.exports = withActivityNotificationsAndroid;
module.exports.configureManifest = configureManifest;
module.exports.configureApplication = configureApplication;
