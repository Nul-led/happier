import { code, glyph, sectionHeader, severity } from '@/ui/format/styles';
import type { AuthProfileSnapshot } from '@/diagnostics/doctorRepair';

const SECTION_HEADER = 'Authentication';

/**
 * `Authentication` section.
 *
 * Principle: the active profile is what 99% of `doctor repair` runs care about;
 * everything else is noise until a finding touches it. So we render the active
 * profile in detail, collapse signed-in inactive profiles into a summary
 * counter, and promote "needs action" inactive profiles (expired, not signed
 * in, machine not registered) back to visible cards — because those CAN block
 * a user who switches profiles soon.
 *
 * Line anatomy per profile:
 *   [glyph] [name] [active/inactive marker]  —  on <url>  —  <status>
 *     → <one-line remedy, only when action is needed>
 */
export function renderAuthentication(
  profiles: readonly AuthProfileSnapshot[],
  hasAny: boolean,
  invoker: string = 'happier',
): string[] {
  if (!hasAny) {
    return [
      sectionHeader(SECTION_HEADER),
      `  ${glyph.info()} ${severity.info('No server profiles configured.')}`,
      `    ${glyph.arrow()} sign in: ${code(`${invoker} auth login`)}`,
    ];
  }
  if (profiles.length === 0) return [];

  const active = profiles.find((p) => p.isActive) ?? null;
  const others = profiles.filter((p) => !p.isActive);
  const othersNeedingAction = others.filter((p) => {
    const status = statusFor(p);
    return status !== 'signed-in' && status !== 'stored-unverified';
  });
  const othersSignedIn = others.filter((p) => statusFor(p) === 'signed-in').length;
  const othersStoredUnverified = others.filter((p) => statusFor(p) === 'stored-unverified').length;

  // Collect rows as blocks (multi-line when a remedy/sub-line is included,
  // single-line otherwise). Only separate with a blank line when at least
  // one of the two neighbouring blocks is multi-line — stacking single
  // lines keeps the list feeling cohesive.
  const blocks: string[][] = [];
  if (active) blocks.push(renderProfileBlock(active, invoker));
  for (const p of othersNeedingAction) blocks.push(renderProfileBlock(p, invoker));
  if (othersSignedIn > 0) {
    const word = othersSignedIn === 1 ? 'profile' : 'profiles';
    blocks.push([`  ${glyph.info()} ${severity.info(`${othersSignedIn} other ${word} signed in · run ${code(`${invoker} server list`)} to see all`)}`]);
  }
  if (othersStoredUnverified > 0) {
    const word = othersStoredUnverified === 1 ? 'profile has' : 'profiles have';
    blocks.push([`  ${glyph.info()} ${severity.info(`${othersStoredUnverified} other ${word} a stored sign-in · not checked`)}`]);
  }
  const lines: string[] = [sectionHeader(SECTION_HEADER)];
  for (let i = 0; i < blocks.length; i += 1) {
    const prev = blocks[i - 1];
    const curr = blocks[i];
    if (i > 0 && ((prev?.length ?? 0) > 1 || curr.length > 1)) {
      lines.push('');
    }
    lines.push(...curr);
  }
  return lines;
}

function renderProfileBlock(p: AuthProfileSnapshot, invoker: string): string[] {
  const status = statusFor(p);
  const g = glyphForStatus(status);
  const marker = p.isActive ? ' (active)' : '';
  const nameDisplay = p.isActive ? severity.action(p.serverName + marker) : p.serverName;
  const statusWord = statusWordFor(status);
  const statusRendered = status === 'signed-in'
    ? severity.success(statusWord)
    : severity.info(statusWord);
  const primary = `  ${g} ${nameDisplay}  ${severity.info('—')}  ${severity.info(`on ${p.serverUrl}`)}  ${severity.info('—')}  ${statusRendered}`;

  const remedy = remedyFor(p, status, invoker);
  if (!remedy) return [primary];
  return [primary, `    ${glyph.arrow()} ${remedy}`];
}

type ProfileStatus = 'signed-in' | 'expired' | 'not-registered' | 'not-signed-in' | 'unreachable' | 'stored-unverified';

function statusFor(p: AuthProfileSnapshot): ProfileStatus {
  switch (p.credentialState) {
    case 'missing': return 'not-signed-in';
    case 'invalid': return 'expired';
    case 'unknown': return 'unreachable';
    case 'stored-unverified': return 'stored-unverified';
    case 'valid': return p.machineRegistered ? 'signed-in' : 'not-registered';
  }
}

function glyphForStatus(status: ProfileStatus): string {
  if (status === 'signed-in') return glyph.success();
  if (status === 'expired') return glyph.action();
  if (status === 'not-registered') return glyph.action();
  return glyph.info();
}

function statusWordFor(status: ProfileStatus): string {
  switch (status) {
    case 'signed-in': return 'signed in';
    case 'expired': return 'session expired';
    case 'not-registered': return 'machine not registered';
    case 'not-signed-in': return 'no stored sign-in';
    case 'unreachable': return 'stored sign-in · server unreachable';
    case 'stored-unverified': return 'stored sign-in · not checked';
  }
}

function remedyFor(p: AuthProfileSnapshot, status: ProfileStatus, invoker: string): string | null {
  if (status === 'unreachable') {
    return severity.info('server didn’t respond — credential state couldn’t be verified');
  }
  switch (status) {
    case 'signed-in': return null;
    case 'stored-unverified': return null;
    case 'expired': return `re-sign in: ${code(`${invoker} auth login --server ${p.serverId}`)}`;
    case 'not-registered': return `register: ${code(`${invoker} --server ${p.serverId} daemon start`)}`;
    case 'not-signed-in': return `sign in: ${code(`${invoker} auth login --server ${p.serverId}`)}`;
  }
}
