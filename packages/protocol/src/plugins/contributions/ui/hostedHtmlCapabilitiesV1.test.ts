import { describe, expect, it } from 'vitest';

import {
  UiSurfaceCapabilityRequestV1Schema,
  admitCallerAuthoredUiSurfaceCapabilitiesV1,
  normalizeUiSurfaceCapabilityRequestV1,
  resolvePluginUiHostedHtmlCapabilityRequestV1,
} from './hostedHtmlCapabilitiesV1.js';
import { PLUGIN_UI_CALLER_HOSTED_HTML_HOST_METHODS_V1 } from '../../ui/hostApiDefinition.js';

/**
 * The hosted-HTML capability request is the one declared authority grammar
 * shared by installed-plugin renderers and caller-authored Session documents
 * (Lane 08.01 §5.1). It is deliberately declaration-only: it names what a
 * document asks for, never what a host granted.
 */
describe('UiSurfaceCapabilityRequestV1Schema', () => {
  it('accepts bounded strict requests and rejects unknown fields', () => {
    expect(UiSurfaceCapabilityRequestV1Schema.safeParse({
      hostMethods: ['context'],
      resources: [{ pluginId: 'com.acme.health', localId: 'status' }],
      actions: ['session.message.send'],
      networkOrigins: ['https://api.example.com'],
    }).success).toBe(true);

    expect(UiSurfaceCapabilityRequestV1Schema.safeParse({}).success).toBe(true);
    expect(UiSurfaceCapabilityRequestV1Schema.safeParse({ pluginId: 'com.acme.health' }).success).toBe(false);
    expect(UiSurfaceCapabilityRequestV1Schema.safeParse({ sessionId: 'forged' }).success).toBe(false);
  });

  it('rejects unknown host methods, unqualified resources, and unknown host Actions', () => {
    expect(UiSurfaceCapabilityRequestV1Schema.safeParse({ hostMethods: ['sendPrompt'] }).success).toBe(false);
    expect(UiSurfaceCapabilityRequestV1Schema.safeParse({ resources: ['status'] }).success).toBe(false);
    expect(UiSurfaceCapabilityRequestV1Schema.safeParse({ actions: ['definitely.not.an.action'] }).success).toBe(false);
  });

  it('admits only exact normalized HTTPS origins with no wildcard, path, or credentials', () => {
    for (const origin of [
      'http://api.example.com',
      'https://*.example.com',
      'https://api.example.com/v1',
      'https://api.example.com/',
      'https://user:pass@api.example.com',
      'https://api.example.com?a=1',
    ]) {
      expect(UiSurfaceCapabilityRequestV1Schema.safeParse({ networkOrigins: [origin] }).success).toBe(false);
    }
    expect(UiSurfaceCapabilityRequestV1Schema.safeParse({
      networkOrigins: ['https://api.example.com:8443'],
    }).success).toBe(true);
  });

  it('does not invent capability-count or origin-length limits without a protected boundary', () => {
    const origins = Array.from(
      { length: 9 },
      (_unused, index) => `https://host-${index}.example.com`,
    );
    origins.push(`https://${Array.from({ length: 50 }, () => 'abcde').join('.')}.example.com`);
    expect(UiSurfaceCapabilityRequestV1Schema.safeParse({ networkOrigins: origins }).success).toBe(true);

    const resources = Array.from(
      { length: 33 },
      (_unused, index) => ({ pluginId: 'com.acme.health', localId: `resource-${index}` }),
    );
    expect(UiSurfaceCapabilityRequestV1Schema.safeParse({ resources }).success).toBe(true);

    const actions = Array.from(
      { length: 33 },
      (_unused, index) => ({ pluginId: 'com.acme.health', localId: `action-${index}` }),
    );
    expect(UiSurfaceCapabilityRequestV1Schema.safeParse({ actions }).success).toBe(true);
  });
});

describe('normalizeUiSurfaceCapabilityRequestV1', () => {
  it('deduplicates and sorts every list so equal requests digest identically', () => {
    const first = normalizeUiSurfaceCapabilityRequestV1({
      hostMethods: ['watchContext', 'context', 'context'],
      resources: [
        { pluginId: 'com.acme.health', localId: 'status' },
        { pluginId: 'com.acme.build', localId: 'queue' },
        { pluginId: 'com.acme.health', localId: 'status' },
      ],
      networkOrigins: ['https://b.example.com', 'https://a.example.com', 'https://b.example.com'],
    });
    const second = normalizeUiSurfaceCapabilityRequestV1({
      networkOrigins: ['https://a.example.com', 'https://b.example.com'],
      resources: [
        { pluginId: 'com.acme.build', localId: 'queue' },
        { pluginId: 'com.acme.health', localId: 'status' },
      ],
      hostMethods: ['context', 'watchContext'],
    });

    expect(first).not.toBeNull();
    expect(first).toEqual(second);
    expect(first?.hostMethods).toEqual(['context', 'watchContext']);
    expect(first?.networkOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
    expect(first?.actions).toEqual([]);
  });

  it('returns null for an invalid request instead of a partially salvaged one', () => {
    expect(normalizeUiSurfaceCapabilityRequestV1({ hostMethods: ['sendPrompt'] })).toBeNull();
    expect(normalizeUiSurfaceCapabilityRequestV1(null)).toBeNull();
  });
});

describe('admitCallerAuthoredUiSurfaceCapabilitiesV1', () => {
  it('rejects any host method outside the closed caller ceiling', () => {
    expect(admitCallerAuthoredUiSurfaceCapabilitiesV1({
      request: { hostMethods: ['writeClipboard'] },
      admittedHostMethods: ['writeClipboard', 'context'],
    })).toEqual({ kind: 'rejected', code: 'host_method_outside_caller_ceiling' });

    expect(admitCallerAuthoredUiSurfaceCapabilitiesV1({
      request: { hostMethods: ['openSurface'] },
      admittedHostMethods: [...PLUGIN_UI_CALLER_HOSTED_HTML_HOST_METHODS_V1, 'openSurface'],
    })).toEqual({ kind: 'rejected', code: 'host_method_outside_caller_ceiling' });
  });

  it('advertises only the intersection of the ceiling, the request, and the currently admitted set', () => {
    const admission = admitCallerAuthoredUiSurfaceCapabilitiesV1({
      request: { hostMethods: ['executeAction', 'context', 'watchResource'] },
      admittedHostMethods: ['context', 'executeAction', 'notify'],
    });
    expect(admission.kind).toBe('admitted');
    expect(admission.kind === 'admitted' ? admission.advertisedHostMethods : null)
      .toEqual(['context', 'executeAction']);
  });

  it('never widens the advertised set beyond the request even when the host admits more', () => {
    const admission = admitCallerAuthoredUiSurfaceCapabilitiesV1({
      request: {},
      admittedHostMethods: [...PLUGIN_UI_CALLER_HOSTED_HTML_HOST_METHODS_V1],
    });
    expect(admission.kind === 'admitted' ? admission.advertisedHostMethods : null).toEqual([]);
  });

  it('reports an invalid request as a typed source failure carrying no domain meaning', () => {
    expect(admitCallerAuthoredUiSurfaceCapabilitiesV1({
      request: { networkOrigins: ['https://*.example.com'] },
      admittedHostMethods: [],
    })).toEqual({ kind: 'rejected', code: 'capability_request_invalid' });
  });
});

describe('resolvePluginUiHostedHtmlCapabilityRequestV1', () => {
  it('composes the incumbent requiredHostMethods declaration with the new capability fields', () => {
    expect(resolvePluginUiHostedHtmlCapabilityRequestV1({
      requiredHostMethods: ['watchContext', 'context'],
      requestedCapabilities: {
        resources: [{ pluginId: 'com.acme.health', localId: 'status' }],
        networkOrigins: ['https://api.example.com'],
      },
    })).toEqual({
      hostMethods: ['context', 'watchContext'],
      resources: [{ pluginId: 'com.acme.health', localId: 'status' }],
      actions: [],
      networkOrigins: ['https://api.example.com'],
    });
  });

  it('resolves a renderer that declares neither field to the empty request', () => {
    expect(resolvePluginUiHostedHtmlCapabilityRequestV1({})).toEqual({
      hostMethods: [],
      resources: [],
      actions: [],
      networkOrigins: [],
    });
  });
});
