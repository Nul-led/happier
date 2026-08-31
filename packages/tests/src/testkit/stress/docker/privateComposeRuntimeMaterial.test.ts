import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createPrivateComposeRuntimeMaterial,
  deletePrivateComposeRuntimeMaterial,
  isPrivateComposeRuntimePath,
} from './privateComposeRuntimeMaterial';

const isPosix = process.platform !== 'win32';

describe('privateComposeRuntimeMaterial', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      if (existsSync(dir)) {
        deletePrivateComposeRuntimeMaterial(join(dir, 'docker-compose.yml'));
      }
    }
  });

  it('writes the runtime compose file with restrictive owner-only permissions outside retained run dirs', () => {
    const material = createPrivateComposeRuntimeMaterial({
      composeProjectName: 'happier-stress-run-abc',
      composeYaml: 'services:\n  api:\n    image: test\n',
      secretValues: ['sentinel-runtime-sidecar-secret-0123456789abcdef'],
    });
    createdDirs.push(material.dir);

    expect(material.composeFile).toContain('happier-stress-compose-runtime');
    expect(existsSync(material.composeFile)).toBe(true);
    expect(readFileSync(material.composeFile, 'utf8')).toContain('image: test');
    expect(readFileSync(material.secretValuesFile, 'utf8')).toContain(
      'sentinel-runtime-sidecar-secret-0123456789abcdef',
    );
    expect(material.dir.startsWith(tmpdir())).toBe(true);

    if (isPosix) {
      expect(statSync(material.composeFile).mode & 0o777).toBe(0o600);
      expect(statSync(material.secretValuesFile).mode & 0o777).toBe(0o600);
      expect(statSync(material.dir).mode & 0o777).toBe(0o700);
    }
  });

  it('recognizes only private runtime compose paths', () => {
    const material = createPrivateComposeRuntimeMaterial({
      composeProjectName: 'happier-stress-run-abc',
      composeYaml: 'services: {}\n',
    });
    createdDirs.push(material.dir);

    expect(isPrivateComposeRuntimePath(material.composeFile)).toBe(true);
    expect(isPrivateComposeRuntimePath(join(tmpdir(), 'somewhere-else', 'docker-compose.yml'))).toBe(false);
    expect(isPrivateComposeRuntimePath(undefined)).toBe(false);
    expect(isPrivateComposeRuntimePath(material.dir)).toBe(false);
  });

  it('deletes the whole private material directory on cleanup and ignores unrelated paths', () => {
    const material = createPrivateComposeRuntimeMaterial({
      composeProjectName: 'happier-stress-run-abc',
      composeYaml: 'services: {}\n',
    });
    createdDirs.push(material.dir);

    const unrelatedDir = mkdtempSync(join(tmpdir(), 'happier-unrelated-'));
    const unrelatedFile = join(unrelatedDir, 'docker-compose.yml');
    writeFileSync(unrelatedFile, 'services: {}\n', 'utf8');

    deletePrivateComposeRuntimeMaterial(material.composeFile);
    expect(existsSync(material.dir)).toBe(false);

    deletePrivateComposeRuntimeMaterial(unrelatedFile);
    expect(existsSync(unrelatedDir)).toBe(true);

    mkdirSync(join(unrelatedDir, 'nested'), { recursive: true });
    deletePrivateComposeRuntimeMaterial(undefined);
    expect(existsSync(unrelatedDir)).toBe(true);
    expect(dirname(material.dir)).toContain('happier-stress-compose-runtime');
  });
});
