import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const PERSONAL_HOME_SERVER_ARTIFACT_CAPABILITY_FILE = 'happier-personal-home-capabilities.json';

const EXACT_CAPABILITIES = Object.freeze({
  v: 1,
  component: 'happier-server',
  capabilities: Object.freeze({
    personalHomeBootstrap: 1,
    homeConnectionDescriptor: 1,
    irohHomeAcceptor: 1,
  }),
});

export class PersonalHomeArtifactAdmissionError extends Error {
  readonly code = 'personal_home_artifact_update_required';

  constructor() {
    super('The selected Happier server artifact does not support local Personal Home creation. Update Happier and try again.');
  }
}

function hasExactCapabilityContract(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const capabilities = record.capabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return false;
  const capabilityRecord = capabilities as Record<string, unknown>;
  return record.v === EXACT_CAPABILITIES.v
    && record.component === EXACT_CAPABILITIES.component
    && capabilityRecord.personalHomeBootstrap === 1
    && capabilityRecord.homeConnectionDescriptor === 1
    && capabilityRecord.irohHomeAcceptor === 1
    && Object.keys(capabilityRecord).length === 3
    && Object.keys(record).length === 3;
}

export async function writePersonalHomeServerArtifactCapability(payloadRoot: string): Promise<void> {
  await writeFile(
    join(payloadRoot, PERSONAL_HOME_SERVER_ARTIFACT_CAPABILITY_FILE),
    `${JSON.stringify(EXACT_CAPABILITIES)}\n`,
    'utf8',
  );
}

export async function assertPersonalHomeServerArtifactCapability<TProvenance>(params: Readonly<{
  payloadRoot: string;
  provenance: TProvenance;
}>): Promise<TProvenance> {
  try {
    const raw = await readFile(join(params.payloadRoot, PERSONAL_HOME_SERVER_ARTIFACT_CAPABILITY_FILE), 'utf8');
    if (!hasExactCapabilityContract(JSON.parse(raw))) throw new PersonalHomeArtifactAdmissionError();
    return params.provenance;
  } catch (error) {
    if (error instanceof PersonalHomeArtifactAdmissionError) throw error;
    throw new PersonalHomeArtifactAdmissionError();
  }
}
