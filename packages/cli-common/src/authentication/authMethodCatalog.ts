import type { AuthEntryProjectionV1, AuthEntryProviderPresentationV1 } from '@happier-dev/protocol';

export type ProjectedAuthenticationAction = Readonly<{
  id: 'login' | 'provision' | 'connect';
  mode: 'keyed' | 'keyless' | 'either';
}>;

export type ProjectedAuthenticationMethod = Readonly<{
  id: string;
  enabledActions: readonly ProjectedAuthenticationAction[];
  /**
   * The Home's projected provider presentation (teams-lane-03/01 §10.2). The
   * retained `/v1/features` method list carries only its name and icon hint.
   */
  presentation?: AuthEntryProviderPresentationV1;
}>;

export type ProjectedAuthenticationCatalog = Readonly<{
  provenance: 'auth_entry' | 'structured' | 'legacy';
  methods: readonly ProjectedAuthenticationMethod[];
}>;

export function projectAuthenticationMethodCatalogFromAuthEntry(
  projection: Extract<AuthEntryProjectionV1, { state: 'ready' | 'admission_required' }>,
): ProjectedAuthenticationCatalog {
  const methods = new Map<string, ProjectedAuthenticationMethod>();
  for (const row of projection.actions) {
    if (row.kind !== 'authenticate') continue;
    const action = { id: row.action, mode: row.mode };
    const current = methods.get(row.methodId);
    if (current) {
      if (!current.enabledActions.some((candidate) => (
        candidate.id === action.id && candidate.mode === action.mode
      ))) {
        methods.set(row.methodId, {
          ...current,
          enabledActions: [...current.enabledActions, action],
        });
      }
      continue;
    }
    methods.set(row.methodId, {
      id: row.methodId,
      enabledActions: [action],
      presentation: row.presentation,
    });
  }
  return { provenance: 'auth_entry', methods: [...methods.values()] };
}

type AuthenticationFeaturesInput = Readonly<{
  capabilities?: Readonly<{
    auth?: Readonly<{
      methods?: readonly Readonly<{
        id: string;
        actions: readonly Readonly<{
          id: 'login' | 'provision' | 'connect';
          enabled: boolean;
          mode: 'keyed' | 'keyless' | 'either';
        }>[];
        ui?: Readonly<{ displayName?: string; iconHint?: string | null }>;
      }>[];
      signup?: Readonly<{ methods?: readonly Readonly<{ id: string; enabled: boolean }>[] }>;
      login?: Readonly<{
        methods?: readonly Readonly<{ id: string; enabled: boolean }>[];
        requiredProviders?: readonly string[];
      }>;
      providers?: Readonly<Record<string, unknown>>;
    }>;
    oauth?: Readonly<{ providers?: Readonly<Record<string, unknown>> }>;
  }>;
}>;

function legacyMethodId(id: string): string {
  return id === 'anonymous' ? 'key_challenge' : id;
}

export function projectAuthenticationMethodCatalog(
  features: AuthenticationFeaturesInput,
): ProjectedAuthenticationCatalog {
  const auth = features.capabilities?.auth;
  const structuredMethods = auth?.methods;
  if (structuredMethods !== undefined) {
    return {
      provenance: 'structured',
      methods: structuredMethods.map((method) => {
        const displayName = method.ui?.displayName;
        const presentation = displayName === undefined
          ? undefined
          : {
              displayName,
              ...('iconHint' in (method.ui ?? {}) ? { iconHint: method.ui?.iconHint } : {}),
            };
        return {
          id: method.id,
          enabledActions: method.actions
            .filter((action) => action.enabled)
            .map(({ id, mode }) => ({ id, mode })),
          ...(presentation ? { presentation } : {}),
        };
      }),
    };
  }

  const methods = new Map<string, ProjectedAuthenticationAction[]>();
  const add = (rawId: string, action: ProjectedAuthenticationAction): void => {
    const id = legacyMethodId(rawId);
    const actions = methods.get(id) ?? [];
    if (!actions.some((existing) => existing.id === action.id && existing.mode === action.mode)) {
      actions.push(action);
    }
    methods.set(id, actions);
  };
  for (const method of auth?.signup?.methods ?? []) {
    if (method.enabled) add(method.id, { id: 'provision', mode: 'keyed' });
  }
  for (const method of auth?.login?.methods ?? []) {
    if (method.enabled) add(method.id, { id: 'login', mode: method.id === 'mtls' ? 'keyless' : 'keyed' });
  }
  return {
    provenance: 'legacy',
    methods: [...methods].map(([id, enabledActions]) => ({ id, enabledActions })),
  };
}
