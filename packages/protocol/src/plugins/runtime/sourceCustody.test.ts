import { describe, expect, it } from 'vitest';

import {
  pluginSourceCustodyV1Equal,
  PluginSourceCustodyV1Schema,
  PluginSourceCustodyV1ProtocolSchema,
  normalizePluginSourceCustodyV1,
} from './sourceCustody';

describe('PluginSourceCustodyV1', () => {
  it.each([
    { kind: 'managed', immutableGenerationId: 'generation-a', installSource: 'npm' },
    {
      kind: 'bundled_first_party',
      packagedRuntime: { kind: 'cli_version_root', versionRootId: 'versions/0.3.0' },
    },
    {
      kind: 'bundled_first_party',
      packagedRuntime: { kind: 'pinned_runner_snapshot', snapshotId: 'snapshot-a' },
    },
    { kind: 'development', registeredRootId: 'root-a' },
  ] as const)('normalizes strict $kind custody', (custody) => {
    expect(normalizePluginSourceCustodyV1(custody)).toEqual(custody);
    expect(PluginSourceCustodyV1Schema.parse(custody)).toEqual(custody);
    expect(PluginSourceCustodyV1ProtocolSchema.parse(custody)).toEqual(custody);
  });

  it('rejects managed generation fields on bundled and development custody', () => {
    expect(() => normalizePluginSourceCustodyV1({
      kind: 'bundled_first_party',
      packagedRuntime: { kind: 'cli_version_root', versionRootId: 'versions/0.3.0' },
      immutableGenerationId: 'forbidden',
    })).toThrow();
    expect(() => normalizePluginSourceCustodyV1({
      kind: 'development',
      registeredRootId: 'root-a',
      immutableGenerationId: 'forbidden',
    })).toThrow();
  });

  it('never admits process-local occurrence identity into durable custody', () => {
    const invalid = {
      kind: 'development',
      registeredRootId: 'root-a',
      occurrenceId: 'process-local-occurrence',
    } as const;
    expect(() => normalizePluginSourceCustodyV1(invalid)).toThrow();
    expect(PluginSourceCustodyV1ProtocolSchema.safeParse(invalid).success).toBe(false);
  });

  it('keeps the Zod and composable schemas equivalent while normalization trims identities', () => {
    const padded = {
      kind: 'development',
      registeredRootId: '  root-a  ',
    } as const;
    expect(PluginSourceCustodyV1Schema.parse(padded)).toEqual(padded);
    expect(PluginSourceCustodyV1ProtocolSchema.parse(padded)).toEqual(padded);
    expect(normalizePluginSourceCustodyV1(padded)).toEqual({
      kind: 'development',
      registeredRootId: 'root-a',
    });

    const blank = { kind: 'development', registeredRootId: '   ' } as const;
    expect(PluginSourceCustodyV1Schema.safeParse(blank).success).toBe(false);
    expect(PluginSourceCustodyV1ProtocolSchema.safeParse(blank).success).toBe(false);
  });

  it('compares normalized custody structurally by source arm', () => {
    const managed = normalizePluginSourceCustodyV1({
      kind: 'managed',
      immutableGenerationId: 'generation-a',
      installSource: 'archive',
    });
    expect(pluginSourceCustodyV1Equal(managed, { ...managed })).toBe(true);
    expect(pluginSourceCustodyV1Equal(managed, {
      ...managed,
      immutableGenerationId: 'generation-b',
    })).toBe(false);
    expect(pluginSourceCustodyV1Equal(
      normalizePluginSourceCustodyV1({
        kind: 'bundled_first_party',
        packagedRuntime: { kind: 'cli_version_root', versionRootId: 'version-a' },
      }),
      normalizePluginSourceCustodyV1({
        kind: 'bundled_first_party',
        packagedRuntime: { kind: 'pinned_runner_snapshot', snapshotId: 'version-a' },
      }),
    )).toBe(false);
  });
});
