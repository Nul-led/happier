import { describe, expect, it } from 'vitest';

import {
  parseGeneratorCliArgs,
  resolveGeneratorAuthoringPreparationPolicy,
  resolvePluginAuthorRuntimeLoadScope,
  resolveSelectedBundledPluginPackageNames,
  shouldEvaluateBundledRuntimeSource,
} from './options.ts';

describe('bundled Plugin publisher options', () => {
  it('keeps noncanonical target generation read-only at canonical preparation owners', () => {
    expect(resolveGeneratorAuthoringPreparationPolicy({
      mode: 'write',
      targetsCanonicalRoot: false,
    })).toEqual({
      generatedCompilerInputMode: 'check',
      publishPluginSdkApiGovernance: false,
    });
    expect(resolveGeneratorAuthoringPreparationPolicy({
      mode: 'write',
      targetsCanonicalRoot: true,
    })).toEqual({
      generatedCompilerInputMode: 'write',
      publishPluginSdkApiGovernance: true,
    });
    expect(resolveGeneratorAuthoringPreparationPolicy({
      mode: 'check',
      targetsCanonicalRoot: true,
    })).toEqual({
      generatedCompilerInputMode: 'check',
      publishPluginSdkApiGovernance: false,
    });
  });

  it('does not evaluate executable runtime source for projection-only checks', () => {
    expect(shouldEvaluateBundledRuntimeSource('projections')).toBe(false);
    expect(shouldEvaluateBundledRuntimeSource('all')).toBe(true);
  });

  it('loads the authoring runtime only for source-based projection work', () => {
    expect(resolvePluginAuthorRuntimeLoadScope({ aggregateOnly: true, scope: 'all' })).toBe('none');
    expect(resolvePluginAuthorRuntimeLoadScope({ aggregateOnly: false, scope: 'projections' })).toBe('manifest');
    expect(resolvePluginAuthorRuntimeLoadScope({ aggregateOnly: false, scope: 'all' })).toBe('full');
  });

  it('normalizes targeted workspace names without duplicating them', () => {
    expect(parseGeneratorCliArgs([
      '--mode', 'check',
      '--scope', 'projections',
      '--workspace', '@happier-dev/plugins-codex',
      '--workspace', 'plugins-codex',
    ])).toMatchObject({
      mode: 'check',
      scope: 'projections',
      workspaceNames: ['plugins-codex'],
      aggregateOnly: false,
    });
  });

  it('rejects write-time narrowed scope and unpublished targets', () => {
    expect(() => parseGeneratorCliArgs(['--scope', 'projections'])).toThrow(/check-only scope/u);
    expect(() => resolveSelectedBundledPluginPackageNames(
      ['@happier-dev/plugins-codex'],
      ['plugins-missing'],
    )).toThrow(/not published/u);
  });
});
