import { ConnectedServicesBindingsIngressSchema } from './parseConnectedServicesBindings';

export function shouldResolveConnectedServiceAuthForSpawn(
  options: Readonly<{ connectedServices?: unknown }>,
): boolean {
  const admitted = ConnectedServicesBindingsIngressSchema.safeParse(options.connectedServices);
  // Invalid explicit input still requires admission; it must not bypass resolution as native.
  if (!admitted.success) return true;
  return Object.values(admitted.data?.bindingsByServiceId ?? {})
    .some((binding) => binding.source === 'connected' || binding.source === 'team_resource');
}
