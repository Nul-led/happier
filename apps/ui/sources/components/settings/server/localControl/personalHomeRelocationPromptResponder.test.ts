import { describe, expect, it, vi } from 'vitest';

import {
    createPersonalHomeRelocationPromptResponder,
    createPersonalHomeRelocationPromptResponderWithPublication,
} from './personalHomeRelocationPromptResponder';

const descriptor = {
    v: 1 as const,
    homeServerIdentityId: 'home-1',
    canonicalServerUrl: 'https://destination.example.test',
    revision: 8,
    endpoints: [{ kind: 'https' as const, url: 'https://destination.example.test' }],
};

function createResponder() {
    const session = {
        publishHomeDescriptor: vi.fn(async () => ({ kind: 'published' as const, entry: { connectionDescriptor: descriptor } })),
        readHomeDescriptor: vi.fn(async () => ({ connectionDescriptor: descriptor })),
    };
    return {
        session,
        responder: createPersonalHomeRelocationPromptResponder({
            operationId: 'relocation-1',
            homeServerIdentityId: 'home-1',
            homeLabel: 'Personal Home',
            session,
        }),
    };
}

describe('createPersonalHomeRelocationPromptResponder', () => {
    it('publishes only a task-bound destination descriptor through the canonical Directory session', async () => {
        const { responder, session } = createResponder();

        await expect(responder({
            kind: 'personal_home.publish_relocation_descriptor.v1',
            message: '',
            data: {
                operationId: 'relocation-1',
                homeServerIdentityId: 'home-1',
                canonicalServerUrl: 'https://destination.example.test',
                minimumOuterRevisionExclusive: 7,
                endpoints: descriptor.endpoints,
            },
        })).resolves.toEqual({ descriptor });
        expect(session.publishHomeDescriptor).toHaveBeenCalledWith({
            homeServerIdentityId: 'home-1',
            label: 'Personal Home',
            minimumOuterRevisionExclusive: 7,
            canonicalServerUrl: 'https://destination.example.test',
            endpoints: descriptor.endpoints,
        });
    });

    it('rejects a prompt for another operation before reading or publishing location data', async () => {
        const { responder, session } = createResponder();

        await expect(responder({
            kind: 'personal_home.read_relocation_descriptor.v1',
            message: '',
            data: { operationId: 'another-operation', homeServerIdentityId: 'home-1' },
        })).rejects.toThrow('did not match');
        expect(session.publishHomeDescriptor).not.toHaveBeenCalled();
        expect(session.readHomeDescriptor).not.toHaveBeenCalled();
    });

    it('uses an injected canonical current-client publication owner when Account Directory is unavailable', async () => {
        const publication = {
            publish: vi.fn(async () => descriptor),
            read: vi.fn(async () => descriptor),
        };
        const responder = createPersonalHomeRelocationPromptResponderWithPublication({
            operationId: 'relocation-1',
            homeServerIdentityId: 'home-1',
            homeLabel: 'Personal Home',
            publication,
        });

        await expect(responder({
            kind: 'personal_home.publish_relocation_descriptor.v1',
            message: '',
            data: {
                operationId: 'relocation-1',
                homeServerIdentityId: 'home-1',
                canonicalServerUrl: 'https://destination.example.test',
                minimumOuterRevisionExclusive: 7,
                endpoints: descriptor.endpoints,
            },
        })).resolves.toEqual({ descriptor });
        await expect(responder({
            kind: 'personal_home.read_relocation_descriptor.v1',
            message: '',
            data: { operationId: 'relocation-1', homeServerIdentityId: 'home-1' },
        })).resolves.toEqual({ descriptor });
        expect(publication.publish).toHaveBeenCalledWith({
            homeServerIdentityId: 'home-1',
            homeLabel: 'Personal Home',
            minimumOuterRevisionExclusive: 7,
            canonicalServerUrl: 'https://destination.example.test',
            endpoints: descriptor.endpoints,
        });
        expect(publication.read).toHaveBeenCalledWith('home-1');
    });
});
