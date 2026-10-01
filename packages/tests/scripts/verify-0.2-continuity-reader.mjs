import assert from 'node:assert/strict';

import { ApiClient } from '../../../apps/cli/src/api/api.ts';
import { readCredentials, readSettings } from '../../../apps/cli/src/persistence.ts';
import { listServerProfiles } from '../../../apps/cli/src/server/serverProfiles.ts';
import { bootstrapAccountSettingsContext } from '../../../apps/cli/src/settings/accountSettings/bootstrapAccountSettingsContext.ts';

const credentials = await readCredentials();
assert.ok(credentials, 'the copied 0.2 client credential must remain readable');

const api = await ApiClient.create(credentials);
const machine = await api.getMachine('b77c9eb9-2b91-4778-b509-f90e63c7ae44');
assert.equal(machine?.metadata?.host, 'continuity-data-host');
assert.equal(machine?.encryptionMode, 'e2ee');

const accountSettings = await bootstrapAccountSettingsContext({
  credentials,
  refresh: 'force',
});
assert.equal(accountSettings.settingsVersion, 1);
assert.equal(accountSettings.settings.notificationsSettingsV1.pushEnabled, false);
assert.equal(accountSettings.settings.notificationsSettingsV1.readyIncludeMessageText, false);

const localSettings = await readSettings();
assert.equal(localSettings.telemetryDisabled, true);
assert.equal(localSettings.machineId, machine.id);

const profiles = await listServerProfiles();
const cloud = profiles.find((profile) => profile.id === 'cloud');
assert.equal(cloud?.name, 'Happier Cloud');
assert.equal(cloud?.serverUrl, process.env.HAPPIER_CONTINUITY_HOME_URL);

console.log(JSON.stringify({
  kind: 'continuity_readers',
  machineId: machine.id,
  settingsVersion: accountSettings.settingsVersion,
  cloudProfileId: cloud.id,
}));
