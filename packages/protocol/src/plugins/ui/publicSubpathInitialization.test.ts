import { describe, expect, expectTypeOf, it } from 'vitest';

import { PluginSessionHeaderActionDescriptorV1Schema } from '../../index.js';
import {
  isPluginUiAuthoredViewInlineSurfaceRoleV1,
  PluginUiResolvedSemanticCommandV1Schema,
  PluginUiSemanticCommandV1Schema,
  type PluginUiInlineSurfaceMountV1,
} from './index.js';

describe('plugin-UI public subpath initialization', () => {
  it('initializes the root contribution descriptor and the public UI semantic-action schema together', () => {
    expectTypeOf<PluginUiInlineSurfaceMountV1>().toMatchTypeOf<
      | Readonly<{ role: 'widget'; presentation: 'content' | 'fill' }>
      | Readonly<{ role: 'sessionInline'; presentation: 'content' }>
    >();
    expect(isPluginUiAuthoredViewInlineSurfaceRoleV1('widget')).toBe(true);
    expect(PluginSessionHeaderActionDescriptorV1Schema.parse({
      id: 'open-activity',
      title: 'Open activity',
      command: {
        kind: 'openSurface',
        destination: 'activity',
      },
    })).toMatchObject({
      command: {
        kind: 'openSurface',
        destination: 'activity',
      },
    });
    expect(PluginUiSemanticCommandV1Schema.parse({
      kind: 'executeAction',
      action: 'refresh',
    })).toEqual({
      kind: 'executeAction',
      action: 'refresh',
    });
    expect(PluginUiResolvedSemanticCommandV1Schema.parse({
      kind: 'executeAction',
      action: { pluginId: 'acme.navigation', localId: 'refresh' },
    })).toEqual({
      kind: 'executeAction',
      action: { pluginId: 'acme.navigation', localId: 'refresh' },
    });
  });
});
