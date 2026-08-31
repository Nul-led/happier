import type { PluginUiEphemeralSharedScope } from '@happier-dev/plugin-ui';

type SharedValueEntry = {
  value: unknown;
  dispose(): void;
  onExecutionOriginChange?: () => void;
  readonly leases: Set<Readonly<{ executionOriginKey: string }>>;
};

/**
 * One Account/plugin/generation fixture with independently mounted transport
 * origins. Each returned scope is a distinct host facade, while their opaque
 * values remain generation-shared exactly like the product registry.
 */
export function createTriageEphemeralSharedScopeOriginFixture(): Readonly<{
  forExecutionOrigin(executionOriginKey: string): PluginUiEphemeralSharedScope;
}> {
  const values = new Map<string, SharedValueEntry>();

  return Object.freeze({
    forExecutionOrigin(executionOriginKey: string): PluginUiEphemeralSharedScope {
      return Object.freeze({
        acquire<T>(key: string, create: () => Readonly<{
          value: T;
          dispose(): void;
          onExecutionOriginChange?(): void;
        }>) {
          let entry = values.get(key);
          if (entry === undefined) {
            const created = create();
            entry = {
              value: created.value,
              dispose: created.dispose,
              ...(created.onExecutionOriginChange === undefined
                ? {}
                : { onExecutionOriginChange: created.onExecutionOriginChange }),
              leases: new Set(),
            };
            values.set(key, entry);
          }
          const leaseRecord = Object.freeze({ executionOriginKey });
          entry.leases.add(leaseRecord);
          let released = false;
          return Object.freeze({
            value: entry.value as T,
            release() {
              if (released) return;
              released = true;
              const activeBeforeRelease = entry!.leases.values().next().value as
                | Readonly<{ executionOriginKey: string }>
                | undefined;
              entry!.leases.delete(leaseRecord);
              if (entry!.leases.size === 0) {
                if (values.get(key) !== entry) return;
                values.delete(key);
                entry!.dispose();
                return;
              }
              const activeAfterRelease = entry!.leases.values().next().value as
                | Readonly<{ executionOriginKey: string }>
                | undefined;
              if (
                activeBeforeRelease === leaseRecord
                && activeAfterRelease?.executionOriginKey !== executionOriginKey
              ) {
                entry!.onExecutionOriginChange?.();
              }
            },
          });
        },
      });
    },
  });
}

/**
 * Host-owned Account/plugin/generation scope for mounted Triage surface tests.
 *
 * Tests keep one fixture for every artifact mount that is meant to share the
 * live list window. The final released lease disposes the opaque plugin value,
 * matching the host lifetime contract without teaching the fixture anything
 * about Triage's value shape.
 */
export function createTriageEphemeralSharedScopeFixture(): PluginUiEphemeralSharedScope {
  return createTriageEphemeralSharedScopeOriginFixture().forExecutionOrigin('fixture');
}
