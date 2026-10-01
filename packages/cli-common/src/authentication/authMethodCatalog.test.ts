import { describe, expect, it } from 'vitest';

import {
  projectAuthenticationMethodCatalog,
  projectAuthenticationMethodCatalogFromAuthEntry,
} from './authMethodCatalog.js';

describe('projectAuthenticationMethodCatalog', () => {
  it('preserves structured order, actions, modes, and presentation without provider-map cross-joining', () => {
    const result = projectAuthenticationMethodCatalog({
      capabilities: {
        auth: {
          methods: [
            {
              id: 'oidc-work',
              actions: [
                { id: 'login', enabled: true, mode: 'keyless' },
                { id: 'provision', enabled: true, mode: 'keyed' },
                { id: 'connect', enabled: false, mode: 'either' },
              ],
              ui: { displayName: 'Work SSO', iconHint: 'briefcase' },
            },
            {
              id: 'key_challenge',
              actions: [{ id: 'login', enabled: true, mode: 'keyed' }],
            },
          ],
          signup: { methods: [{ id: 'github', enabled: true }] },
          login: { methods: [{ id: 'github', enabled: true }], requiredProviders: [] },
          providers: { github: { enabled: true } },
        },
        oauth: { providers: { github: { configured: true } } },
      },
    });

    expect(result).toEqual({
      provenance: 'structured',
      methods: [
        {
          id: 'oidc-work',
          enabledActions: [
            { id: 'login', mode: 'keyless' },
            { id: 'provision', mode: 'keyed' },
          ],
          presentation: { displayName: 'Work SSO', iconHint: 'briefcase' },
        },
        {
          id: 'key_challenge',
          enabledActions: [{ id: 'login', mode: 'keyed' }],
        },
      ],
    });
  });

  it('treats an explicitly empty structured catalog as authoritative', () => {
    const result = projectAuthenticationMethodCatalog({
      capabilities: {
        auth: {
          methods: [],
          signup: { methods: [{ id: 'anonymous', enabled: true }] },
          login: { methods: [{ id: 'key_challenge', enabled: true }], requiredProviders: [] },
          providers: {},
        },
        oauth: { providers: {} },
      },
    });

    expect(result).toEqual({
      provenance: 'structured',
      methods: [],
    });
  });

  it('uses legacy fields only when the structured catalog is absent', () => {
    const result = projectAuthenticationMethodCatalog({
      capabilities: {
        auth: {
          signup: { methods: [{ id: 'anonymous', enabled: true }] },
          login: { methods: [{ id: 'key_challenge', enabled: true }], requiredProviders: [] },
          providers: {},
        },
        oauth: { providers: {} },
      },
    });

    expect(result).toEqual({
      provenance: 'legacy',
      methods: [{
        id: 'key_challenge',
        enabledActions: [
          { id: 'provision', mode: 'keyed' },
          { id: 'login', mode: 'keyed' },
        ],
      }],
    });
  });
});

describe('projectAuthenticationMethodCatalogFromAuthEntry', () => {
  it('preserves contextual action order and coalesces actions for the same method', () => {
    expect(projectAuthenticationMethodCatalogFromAuthEntry({
      v: 1,
      scope: { kind: 'home' },
      state: 'ready',
      actions: [
        {
          kind: 'authenticate',
          methodId: 'work-oidc',
          action: 'login',
          mode: 'keyless',
          origin: 'home',
          presentation: { displayName: 'Work SSO' },
        },
        {
          kind: 'authenticate',
          methodId: 'work-oidc',
          action: 'provision',
          mode: 'keyed',
          origin: 'home',
          presentation: { displayName: 'Work SSO' },
        },
      ],
      autoRedirect: null,
    })).toEqual({
      provenance: 'auth_entry',
      methods: [{
        id: 'work-oidc',
        enabledActions: [
          { id: 'login', mode: 'keyless' },
          { id: 'provision', mode: 'keyed' },
        ],
        presentation: { displayName: 'Work SSO' },
      }],
    });
  });

  it('projects invitation-scoped admission methods without treating control actions as methods', () => {
    expect(projectAuthenticationMethodCatalogFromAuthEntry({
      v: 1,
      scope: { kind: 'invitation' },
      state: 'admission_required',
      home: {
        serverId: 'home-1',
        displayName: 'Example Home',
        storageMode: 'encrypted',
        hosting: 'shared',
      },
      team: { teamId: 'team-1', name: 'Example Team', logo: null },
      actions: [
        { kind: 'switch_account' },
        {
          kind: 'authenticate',
          methodId: 'email_password',
          action: 'provision',
          mode: 'either',
          origin: 'team',
          presentation: { displayName: 'Email and password' },
        },
      ],
      invitationEmailVerificationRequired: true,
      autoRedirect: null,
    })).toEqual({
      provenance: 'auth_entry',
      methods: [{
        id: 'email_password',
        enabledActions: [{ id: 'provision', mode: 'either' }],
        presentation: { displayName: 'Email and password' },
      }],
    });
  });

});
