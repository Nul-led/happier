import { describe, expect, it } from 'vitest';

import {
  createPersonalHomeRuntimeSpec,
  parsePersonalHomeRuntimePurpose,
  renderPersonalHomeRuntimeEnv,
  resolvePersonalHomeRuntimeSpec,
} from './personalHomeRuntimeSpec.js';
import { resolvePersonalHomeRuntimeLayout } from './layout.js';
import { parseRelayRuntimeTaskParams } from '../../systemTasks/kinds/relayRuntimeKinds.js';

describe('Personal Home runtime purpose', () => {
  it('renders the fixed loopback/plaintext bootstrap environment', () => {
    const spec = createPersonalHomeRuntimeSpec({
      canonicalServerUrl: 'http://127.0.0.1:43123',
    });

    expect(spec).toEqual({
      purpose: 'personal-home',
      bindAddress: '127.0.0.1',
      canonicalServerUrl: 'http://127.0.0.1:43123',
      encryptionStoragePolicy: 'plaintext_only',
      defaultAccountMode: 'plain',
      anonymousSignupPhase: 'loopback-bootstrap-then-disabled',
    });
    expect(renderPersonalHomeRuntimeEnv({ spec, port: 43123 })).toEqual({
      HAPPIER_SERVER_HOST: '127.0.0.1',
      PORT: '43123',
      HAPPIER_PUBLIC_SERVER_URL: 'http://127.0.0.1:43123',
      HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'plaintext_only',
      HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',
      AUTH_ANONYMOUS_SIGNUP_ENABLED: '1',
    });
  });

  it('renders signup closure without changing the canonical origin', () => {
    const spec = resolvePersonalHomeRuntimeSpec({
      canonicalServerUrl: 'http://127.0.0.1:43123',
    });

    expect(renderPersonalHomeRuntimeEnv({
      spec,
      port: 43123,
      anonymousSignupEnabled: false,
    }).AUTH_ANONYMOUS_SIGNUP_ENABLED).toBe('0');
    expect(renderPersonalHomeRuntimeEnv({
      spec,
      port: 43123,
      anonymousSignupEnabled: false,
    }).HAPPIER_PUBLIC_SERVER_URL).toBe('http://127.0.0.1:43123');
  });

  it('rejects arbitrary environment injection and malformed purposes', () => {
    const spec = createPersonalHomeRuntimeSpec({
      canonicalServerUrl: 'http://127.0.0.1:43123',
    });

    expect(() => renderPersonalHomeRuntimeEnv({
      spec,
      port: 43123,
      overrides: { HANDY_MASTER_SECRET: 'must-not-be-user-injected' },
    })).toThrow(/unsupported Personal Home environment key/u);
    expect(() => parsePersonalHomeRuntimePurpose({
      kind: 'personal-home',
      canonicalServerUrl: 'http://127.0.0.1:43123',
      env: { arbitrary: 'value' },
    })).toThrow(/unsupported Personal Home environment key/u);
    expect(() => parseRelayRuntimeTaskParams({
      target: { kind: 'local' },
      purpose: {
        kind: 'personal-home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
      },
      env: { HANDY_MASTER_SECRET: 'must-not-be-user-injected' },
    })).toThrow(/unsupported Personal Home environment key/u);
  });

  it('rejects non-loopback or non-origin Personal Home URLs', () => {
    expect(() => createPersonalHomeRuntimeSpec({ canonicalServerUrl: 'https://home.example.test:43123' }))
      .toThrow(/loopback/i);
    expect(() => createPersonalHomeRuntimeSpec({ canonicalServerUrl: 'http://127.0.0.1' }))
      .toThrow(/port/i);
    expect(() => createPersonalHomeRuntimeSpec({ canonicalServerUrl: 'http://127.0.0.1:43123/home' }))
      .toThrow(/origin|path/i);
  });

    it('resolves the Personal Home data paths beneath the managed runtime root', () => {
    const layout = resolvePersonalHomeRuntimeLayout({
      homeDir: '/tmp/personal-home-layout-test',
      platform: 'linux',
      mode: 'user',
    });

    expect(layout.installRoot).toBe('/tmp/personal-home-layout-test/.happier/self-host');
    expect(layout.configDir).toBe(`${layout.installRoot}/config`);
    expect(layout.logsDir).toBe(`${layout.installRoot}/logs`);
    expect(layout.dataDir).toBe(`${layout.installRoot}/data`);
    expect(layout.databasePath).toBe(`${layout.dataDir}/happier-server-light.sqlite`);
    expect(layout.publicFilesDir).toBe(`${layout.dataDir}/files`);
        expect(layout.privateFilesDir).toBe(`${layout.dataDir}/private-files`);
    expect(layout.masterSecretPath).toBe(`${layout.dataDir}/handy-master-secret.txt`);
    expect(layout.backupsDir).toBe(`${layout.dataDir}/backups`);
        expect(layout.derivedDataDir).toBe(`${layout.dataDir}/derived`);
    });

    it('uses the server-owned private-files override and expands the home alias', () => {
        const layout = resolvePersonalHomeRuntimeLayout({
            homeDir: '/tmp/personal-home-layout-test',
            platform: 'linux',
            mode: 'user',
            env: {
                HAPPIER_SELF_HOST_INSTALL_ROOT: '~/runtime',
                HAPPIER_SERVER_LIGHT_DATA_DIR: '~/runtime/data',
                HAPPY_SERVER_LIGHT_PRIVATE_FILES_DIR: '~/runtime/private-files',
            },
        });

        expect(layout.installRoot).toBe('/tmp/personal-home-layout-test/runtime');
        expect(layout.dataDir).toBe('/tmp/personal-home-layout-test/runtime/data');
        expect(layout.privateFilesDir).toBe('/tmp/personal-home-layout-test/runtime/private-files');
    });

    it('prefers current managed path variables when current and legacy values conflict', () => {
      const layout = resolvePersonalHomeRuntimeLayout({
        homeDir: '/tmp/personal-home-layout-test',
        platform: 'linux',
        mode: 'user',
        env: {
          HAPPIER_SERVER_LIGHT_DATA_DIR: '/tmp/current/data',
          HAPPY_SERVER_LIGHT_DATA_DIR: '/tmp/legacy/data',
          HAPPIER_SERVER_LIGHT_FILES_DIR: '/tmp/current/public',
          HAPPY_SERVER_LIGHT_FILES_DIR: '/tmp/legacy/public',
          HAPPIER_SERVER_LIGHT_PRIVATE_FILES_DIR: '/tmp/current/private',
          HAPPY_SERVER_LIGHT_PRIVATE_FILES_DIR: '/tmp/legacy/private',
        },
      });

      expect(layout.dataDir).toBe('/tmp/current/data');
      expect(layout.publicFilesDir).toBe('/tmp/current/public');
      expect(layout.privateFilesDir).toBe('/tmp/current/private');
    });

    it('uses persisted DATABASE_URL and ignores database-path aliases the server never consumes', () => {
      const layout = resolvePersonalHomeRuntimeLayout({
        homeDir: '/tmp/personal-home-layout-test',
        platform: 'linux',
        env: {
          HAPPIER_SERVER_LIGHT_DATA_DIR: '/tmp/personal-home-layout-test/data',
          HAPPIER_SERVER_LIGHT_DATABASE_PATH: '/tmp/invented.sqlite',
          DATABASE_URL: 'file:/tmp/authoritative%20home.sqlite?socket_timeout=30&connection_limit=4',
        },
      });
      expect(layout.databasePath).toBe('/tmp/authoritative home.sqlite');
    });

    it('matches Prisma Windows file URL path semantics with query parameters', () => {
      const layout = resolvePersonalHomeRuntimeLayout({
        homeDir: 'C:\\Users\\me',
        platform: 'win32',
        env: { DATABASE_URL: 'file:C:/Users/me/Happier%20QA/home.sqlite?socket_timeout=30' },
      });
      expect(layout.databasePath).toBe('C:\\Users\\me\\Happier QA\\home.sqlite');
    });
});
