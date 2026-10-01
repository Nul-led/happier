import { describe, expect, it, vi } from 'vitest';
import {
    defineProtocolJsonValue,
    defineProtocolLiteral,
    defineProtocolObject,
} from '@happier-dev/plugin-sdk/protocol';

import {
    createAdmittedTargetedOperationExecutionHandle,
    createPluginInvocationActionsService,
    type InvokeContributedAction,
} from './actions';
import { createPluginActionCallerMaterializationFixture } from './actionCaller.testkit';
import { createManagedPluginSourceCustody } from '@/plugins/runtime/lifecycle/contributions/runtimeIdentity.testkit';

function permissiveTargetProtocol(role: string) {
    return Object.freeze({
        role,
        input: Object.freeze({ kind: 'contributorDefined' as const }),
        resultSchema: defineProtocolJsonValue(),
    });
}

describe('admitted targeted-operation execution', () => {
    it('forwards the opaque target protocol binding and raw input to the canonical dispatcher for normal and execution-origin calls', async () => {
        const targetInputSchema = defineProtocolObject({
            kind: defineProtocolLiteral('expected'),
        }, { policy: 'additive-open/drop' });
        const targetResultSchema = defineProtocolObject({
            kind: defineProtocolLiteral('expected'),
        }, { policy: 'additive-open/drop' });
        const invokeContributedAction = vi.fn<InvokeContributedAction>(async () => ({
            status: 'executed' as const,
            value: { kind: 'expected' },
            executionOrigin: {
                serverIdentityId: 'srv-target',
                materializationRef: {
                    pluginId: 'acme.contributor',
                    machineId: 'machine-target',
                    materializationId: 'immutable-contributor-a',
                },
            },
        }));
        const callerMaterialization = createPluginActionCallerMaterializationFixture('acme.target');
        const service = createPluginInvocationActionsService({
            seed: {
                plugin: { id: 'acme.target', version: '1.0.0' },
                contribution: { id: 'request', qualifiedId: 'acme.target/actions/request' },
                occurrenceId: 'target-occurrence-a',
                sourceCustody: { kind: 'managed', immutableGenerationId: 'immutable-target-a', installSource: 'archive' },
                surface: 'plugin',
                resolveCurrentPluginMaterializationRef: callerMaterialization.resolveCurrentPluginMaterializationRef,
                signal: new AbortController().signal,
                isOccurrenceCurrent: () => true,
            },
            actionExecutor: { execute: vi.fn() },
            invokeContributedAction,
        });
        const admitted = createAdmittedTargetedOperationExecutionHandle({
            action: { pluginId: 'acme.contributor', localId: 'publish' },
            targetOccurrenceId: 'target-occurrence-a',
            identity: {
                target: { pluginId: 'acme.target' },
                point: { pointId: 'providers', protocol: { id: 'acme.providers/provider', version: 1 } },
                contributor: {
                    pluginId: 'acme.contributor',
                    contributionId: 'primary',
                    occurrenceId: 'contributor-occurrence-a',
                    sourceCustody: { kind: 'managed', immutableGenerationId: 'immutable-contributor-a', installSource: 'archive' },
                },
                role: 'publish',
            },
            targetProtocol: {
                role: 'publish',
                input: { kind: 'protocolDefined', schema: targetInputSchema },
                resultSchema: targetResultSchema,
            },
        });

        await expect(service.executeAdmittedTargetedOperation(
            admitted,
            { kind: 'expected', targetOnly: true },
        )).resolves.toEqual({ kind: 'expected' });
        expect(invokeContributedAction).toHaveBeenLastCalledWith(expect.objectContaining({
            input: { kind: 'expected', targetOnly: true },
            admittedTargetedOperation: expect.objectContaining({
                action: { pluginId: 'acme.contributor', localId: 'publish' },
                target: {
                    pluginId: 'acme.target',
                    occurrenceId: 'target-occurrence-a',
                },
                contributorOccurrenceId: 'contributor-occurrence-a',
                targetProtocol: expect.objectContaining({
                    input: { kind: 'protocolDefined', schema: targetInputSchema },
                    resultSchema: targetResultSchema,
                }),
            }),
        }));

        await expect(service.executeAdmittedTargetedOperationWithExecutionOrigin(
            admitted,
            { kind: 'expected', targetOnly: true },
        )).resolves.toMatchObject({
            result: { kind: 'expected' },
            executionOrigin: expect.objectContaining({
                materializationRef: expect.objectContaining({
                    pluginId: 'acme.contributor',
                }),
            }),
        });
        expect(invokeContributedAction).toHaveBeenCalledTimes(2);
    });

    it('reconstructs only an exact current selected settlement before invoking its admitted provider Action', async () => {
        const account = {
            service: { pluginId: 'acme.github', localId: 'github' },
            accountId: 'account-a',
        } as const;
        const operation = {
            point: { pointId: 'providers', protocol: { id: 'acme.providers/provider', version: 1 } },
            contributor: {
                pluginId: 'acme.provider',
                contributionId: 'github',
                occurrenceId: 'provider-occurrence-a',
                sourceCustody: { kind: 'managed', immutableGenerationId: 'provider-occurrenceId-a', installSource: 'archive' },
            },
            role: 'setup',
            action: { pluginId: 'acme.provider', localId: 'connection/setup' },
        } as const;
        const selectedActionInputCarrier = {
            operation,
            result: {
                kind: 'submitted' as const,
                action: operation.action,
                input: { repository: 'happier-dev/happier' },
                selection: {
                    target: {
                        pluginId: 'happier.channels',
                        sourceCustody: { kind: 'managed', immutableGenerationId: 'channels-occurrenceId-a', installSource: 'archive' },
                    },
                    point: operation.point,
                    contributor: {
                        pluginId: operation.contributor.pluginId,
                        contributionId: operation.contributor.contributionId,
                        sourceCustody: { kind: 'managed', immutableGenerationId: 'provider-occurrenceId-a', installSource: 'archive' },
                    },
                },
                connectedAccount: {
                    kind: 'selected' as const,
                    fieldPath: 'credentialRef',
                    ref: account,
                },
                presentation: {
                    connectedAccountLabel: 'Work account',
                    machineDisplayName: 'Development Mac',
                },
            },
        } as const;
        const invokeContributedAction = vi.fn<InvokeContributedAction>(async () => ({
            status: 'executed' as const,
            value: { accepted: true },
        }));
        const callerMaterialization = createPluginActionCallerMaterializationFixture('happier.channels');
        const service = createPluginInvocationActionsService({
            seed: {
                plugin: { id: 'happier.channels', version: '1.0.0' },
                contribution: { id: 'connection-create', qualifiedId: 'happier.channels/actions/connection-create' },
                occurrenceId: 'channels-occurrence-a',
                sourceCustody: { kind: 'managed', immutableGenerationId: 'channels-occurrenceId-a', installSource: 'archive' },
                surface: 'plugin',
                resolveCurrentPluginMaterializationRef: callerMaterialization.resolveCurrentPluginMaterializationRef,
                selectedActionInputCarrier,
                isMountedCallerCurrent: async () => true,
                signal: new AbortController().signal,
                isOccurrenceCurrent: () => true,
            },
            actionExecutor: { execute: vi.fn() },
            invokeContributedAction,
        });
        const admitted = createAdmittedTargetedOperationExecutionHandle({
            action: operation.action,
            targetOccurrenceId: 'channels-occurrence-a',
            identity: {
                target: { pluginId: 'happier.channels' },
                point: operation.point,
                contributor: operation.contributor,
                role: operation.role,
            },
            selectedActionInput: {
                kind: 'connectedAccount',
                fieldPath: 'credentialRef',
            },
            targetProtocol: permissiveTargetProtocol(operation.role),
        });

        await expect(service.executeAdmittedTargetedOperation(
            admitted,
            selectedActionInputCarrier.result.input,
            { expectedSelectedConnectedAccountRef: account },
        )).resolves.toEqual({ accepted: true });
        expect(invokeContributedAction).toHaveBeenLastCalledWith(expect.objectContaining({
            action: operation.action,
            input: {
                repository: 'happier-dev/happier',
                credentialRef: account,
            },
        }));

        await expect(service.executeAdmittedTargetedOperation(
            admitted,
            { repository: 'tampered' },
            { expectedSelectedConnectedAccountRef: account },
        )).rejects.toMatchObject({
            code: 'plugin_selected_action_input_invalid',
            actionHandlerInvocation: 'notStarted',
        });
        await expect(service.executeAdmittedTargetedOperation(
            admitted,
            selectedActionInputCarrier.result.input,
            {
                expectedSelectedConnectedAccountRef: {
                    service: { pluginId: 'acme.github', localId: 'github' },
                    accountId: 'account-b',
                },
            },
        )).rejects.toMatchObject({ code: 'plugin_selected_action_input_invalid' });
        // A carrier-bound target invocation cannot fall back to the ordinary
        // admitted-operation path by omitting the outer Account correspondence.
        await expect(service.executeAdmittedTargetedOperation(
            admitted,
            selectedActionInputCarrier.result.input,
        )).rejects.toMatchObject({ code: 'plugin_selected_action_input_invalid' });
        const wrongRole = createAdmittedTargetedOperationExecutionHandle({
            action: operation.action,
            targetOccurrenceId: 'channels-occurrence-a',
            identity: {
                target: { pluginId: 'happier.channels' },
                point: operation.point,
                contributor: operation.contributor,
                role: 'verify',
            },
            selectedActionInput: {
                kind: 'connectedAccount',
                fieldPath: 'credentialRef',
            },
            targetProtocol: permissiveTargetProtocol('verify'),
        });
        await expect(service.executeAdmittedTargetedOperation(
            wrongRole,
            selectedActionInputCarrier.result.input,
            { expectedSelectedConnectedAccountRef: account },
        )).rejects.toMatchObject({ code: 'plugin_selected_action_input_invalid' });
        expect(invokeContributedAction).toHaveBeenCalledOnce();
    });

    it('atomically consumes one selected setup settlement while allowing its later non-selected connection test', async () => {
        const account = {
            service: { pluginId: 'acme.github', localId: 'github' },
            accountId: 'account-a',
        } as const;
        const setupOperation = {
            point: { pointId: 'providers', protocol: { id: 'acme.providers/provider', version: 1 } },
            contributor: {
                pluginId: 'acme.provider',
                contributionId: 'github',
                occurrenceId: 'provider-occurrence-a',
                sourceCustody: { kind: 'managed', immutableGenerationId: 'provider-occurrenceId-a', installSource: 'archive' },
            },
            role: 'setup',
            action: { pluginId: 'acme.provider', localId: 'connection/setup' },
        } as const;
        const connectionTestOperation = {
            ...setupOperation,
            role: 'connectionTest',
            action: { pluginId: 'acme.provider', localId: 'connection/test' },
        } as const;
        const selectedActionInputCarrier = {
            operation: setupOperation,
            result: {
                kind: 'submitted' as const,
                action: setupOperation.action,
                input: { repository: 'happier-dev/happier' },
                selection: {
                    target: {
                        pluginId: 'happier.channels',
                        sourceCustody: { kind: 'managed', immutableGenerationId: 'channels-occurrenceId-a', installSource: 'archive' },
                    },
                    point: setupOperation.point,
                    contributor: {
                        pluginId: setupOperation.contributor.pluginId,
                        contributionId: setupOperation.contributor.contributionId,
                        sourceCustody: { kind: 'managed', immutableGenerationId: 'provider-occurrenceId-a', installSource: 'archive' },
                    },
                },
                connectedAccount: {
                    kind: 'selected' as const,
                    fieldPath: 'credentialRef',
                    ref: account,
                },
                presentation: {
                    connectedAccountLabel: 'Work account',
                    machineDisplayName: 'Development Mac',
                },
            },
        } as const;
        let releaseMountedCallerCurrent: ((value: boolean) => void) | undefined;
        const mountedCallerCurrent = new Promise<boolean>((resolve) => {
            releaseMountedCallerCurrent = resolve;
        });
        const invokeContributedAction = vi.fn<InvokeContributedAction>(async () => ({
            status: 'executed' as const,
            value: { accepted: true },
        }));
        const callerMaterialization = createPluginActionCallerMaterializationFixture('happier.channels');
        const service = createPluginInvocationActionsService({
            seed: {
                plugin: { id: 'happier.channels', version: '1.0.0' },
                contribution: { id: 'connection-create', qualifiedId: 'happier.channels/actions/connection-create' },
                occurrenceId: 'channels-occurrence-a',
                sourceCustody: { kind: 'managed', immutableGenerationId: 'channels-occurrenceId-a', installSource: 'archive' },
                surface: 'plugin',
                resolveCurrentPluginMaterializationRef: callerMaterialization.resolveCurrentPluginMaterializationRef,
                selectedActionInputCarrier,
                isMountedCallerCurrent: async () => await mountedCallerCurrent,
                signal: new AbortController().signal,
                isOccurrenceCurrent: () => true,
            },
            actionExecutor: { execute: vi.fn() },
            invokeContributedAction,
        });
        const setup = createAdmittedTargetedOperationExecutionHandle({
            action: setupOperation.action,
            targetOccurrenceId: 'channels-occurrence-a',
            identity: {
                target: { pluginId: 'happier.channels' },
                point: setupOperation.point,
                contributor: setupOperation.contributor,
                role: setupOperation.role,
            },
            selectedActionInput: { kind: 'connectedAccount', fieldPath: 'credentialRef' },
            targetProtocol: permissiveTargetProtocol(setupOperation.role),
        });
        const connectionTest = createAdmittedTargetedOperationExecutionHandle({
            action: connectionTestOperation.action,
            targetOccurrenceId: 'channels-occurrence-a',
            identity: {
                target: { pluginId: 'happier.channels' },
                point: connectionTestOperation.point,
                contributor: connectionTestOperation.contributor,
                role: connectionTestOperation.role,
            },
            targetProtocol: permissiveTargetProtocol(connectionTestOperation.role),
        });

        const firstSetup = service.executeAdmittedTargetedOperation(
            setup,
            selectedActionInputCarrier.result.input,
            { expectedSelectedConnectedAccountRef: account },
        );
        const secondSetup = service.executeAdmittedTargetedOperation(
            setup,
            selectedActionInputCarrier.result.input,
            { expectedSelectedConnectedAccountRef: account },
        );
        await Promise.resolve();
        expect(invokeContributedAction).not.toHaveBeenCalled();
        releaseMountedCallerCurrent?.(true);
        const setupResults = await Promise.allSettled([firstSetup, secondSetup]);
        expect(setupResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(setupResults.filter((result) => result.status === 'rejected')).toHaveLength(1);
        const rejectedSetup = setupResults.find((result) => result.status === 'rejected');
        expect(rejectedSetup).toMatchObject({ reason: { code: 'plugin_selected_action_input_invalid' } });
        expect(invokeContributedAction).toHaveBeenCalledOnce();
        expect(invokeContributedAction).toHaveBeenLastCalledWith(expect.objectContaining({
            action: setupOperation.action,
            input: {
                repository: 'happier-dev/happier',
                credentialRef: account,
            },
        }));

        await expect(service.executeAdmittedTargetedOperation(
            connectionTest,
            { connectionId: 'connection-1' },
        )).resolves.toEqual({ accepted: true });
        expect(invokeContributedAction).toHaveBeenCalledTimes(2);
        expect(invokeContributedAction).toHaveBeenLastCalledWith(expect.objectContaining({
            action: connectionTestOperation.action,
            input: { connectionId: 'connection-1' },
        }));
    });

    it('forwards G only from its original handle and lets the canonical owner reject it after H replaces it', async () => {
        let currentContributorOccurrenceId = 'contributor-occurrence-g';
        const invokeContributedAction = vi.fn<InvokeContributedAction>(async (request) => {
            if (
                request.admittedTargetedOperation?.contributorOccurrenceId
                !== currentContributorOccurrenceId
            ) {
                return {
                    status: 'failed' as const,
                    code: 'plugin_action_generation_retired',
                    message: 'The admitted contributor occurrence is no longer current',
                };
            }
            return {
                status: 'executed' as const,
                value: { accepted: true },
                executionOrigin: {
                    serverIdentityId: 'srv-target',
                    materializationRef: {
                        pluginId: 'acme.contributor',
                        machineId: 'machine-target',
                        materializationId: currentContributorOccurrenceId,
                    },
                },
            };
        });
        const signal = new AbortController().signal;
        const callerMaterialization = createPluginActionCallerMaterializationFixture('acme.caller');
        const service = createPluginInvocationActionsService({
            seed: {
                plugin: { id: 'acme.caller', version: '1.0.0' },
                contribution: { id: 'caller', qualifiedId: 'acme.caller/actions/caller' },
                occurrenceId: 'caller-occurrence-g',
                sourceCustody: { kind: 'managed', immutableGenerationId: 'immutable-caller', installSource: 'archive' },
                surface: 'agent',
                resolveCurrentPluginMaterializationRef: callerMaterialization.resolveCurrentPluginMaterializationRef,
                signal,
                isOccurrenceCurrent: () => true,
            },
            actionExecutor: { execute: vi.fn() },
            invokeContributedAction,
        });
        const identity = Object.freeze({
            target: Object.freeze({ pluginId: 'acme.caller' }),
            point: Object.freeze({
                pointId: 'providers',
                protocol: Object.freeze({ id: 'acme.providers/provider', version: 1 }),
            }),
            contributor: Object.freeze({
                pluginId: 'acme.contributor',
                contributionId: 'primary',
                occurrenceId: 'contributor-occurrence-g',
                sourceCustody: createManagedPluginSourceCustody('immutable-contributor-g'),
            }),
            role: 'publish',
        });
        const admitted = createAdmittedTargetedOperationExecutionHandle({
            action: { pluginId: 'acme.contributor', localId: 'publish' },
            targetOccurrenceId: 'caller-occurrence-g',
            identity,
            targetProtocol: permissiveTargetProtocol(identity.role),
        });

        expect(admitted).toEqual({ identity, typeProjection: undefined });
        expect(Object.isFrozen(admitted)).toBe(true);
        expect(Object.isFrozen(admitted.identity)).toBe(true);

        await expect(service.executeAdmittedTargetedOperation(
            admitted,
            { title: 'Ready' },
        )).resolves.toEqual({ accepted: true });
        await expect(service.executeAdmittedTargetedOperationWithExecutionOrigin(
            admitted,
            { title: 'Ready' },
        )).resolves.toMatchObject({
            result: { accepted: true },
            executionOrigin: expect.objectContaining({
                materializationRef: expect.objectContaining({
                    materializationId: 'contributor-occurrence-g',
                }),
            }),
        });
        expect(invokeContributedAction).toHaveBeenCalledTimes(2);
        expect(invokeContributedAction).toHaveBeenLastCalledWith(expect.objectContaining({
            action: { pluginId: 'acme.contributor', localId: 'publish' },
            admittedTargetedOperation: expect.objectContaining({
                contributorOccurrenceId: 'contributor-occurrence-g',
            }),
        }));
        expect(invokeContributedAction.mock.calls[0]?.[0]).not.toHaveProperty(
            'expectedContributorOccurrenceId',
        );
        expect(invokeContributedAction.mock.calls[0]?.[0]).not.toHaveProperty(
            'expectedContributorMaterializationId',
        );

        // H is now current. Neither copied public description can recover G's
        // host-private binding or invoke either occurrence.
        currentContributorOccurrenceId = 'contributor-occurrence-h';
        invokeContributedAction.mockClear();
        const copiedIdentityHandle = Object.freeze({ identity: admitted.identity });
        const reconstructed = Object.freeze({
            identity: Object.freeze({
                target: Object.freeze({ ...admitted.identity.target }),
                point: Object.freeze({
                    pointId: admitted.identity.point.pointId,
                    protocol: Object.freeze({ ...admitted.identity.point.protocol }),
                }),
                contributor: Object.freeze({ ...admitted.identity.contributor }),
                role: admitted.identity.role,
            }),
        });
        await expect(service.executeAdmittedTargetedOperation(
            copiedIdentityHandle as never,
            { title: 'Ready' },
        )).rejects.toMatchObject({
            code: 'plugin_admitted_targeted_operation_handle_invalid',
            actionHandlerInvocation: 'notStarted',
        });
        await expect(service.executeAdmittedTargetedOperationWithExecutionOrigin(
            reconstructed as never,
            { title: 'Ready' },
        )).rejects.toMatchObject({
            code: 'plugin_admitted_targeted_operation_handle_invalid',
        });
        expect(invokeContributedAction).not.toHaveBeenCalled();

        await expect(service.executeAdmittedTargetedOperation(
            admitted,
            { title: 'Ready' },
        )).rejects.toMatchObject({ code: 'plugin_action_generation_retired' });
        expect(invokeContributedAction).toHaveBeenCalledOnce();
        expect(invokeContributedAction).toHaveBeenCalledWith(expect.objectContaining({
            admittedTargetedOperation: expect.objectContaining({
                contributorOccurrenceId: 'contributor-occurrence-g',
            }),
        }));
    });

    it('refuses an original handle when its target occurrence has been replaced before dispatch', async () => {
        const invokeContributedAction = vi.fn<InvokeContributedAction>(async () => ({
            status: 'executed' as const,
            value: { accepted: true },
        }));
        const callerMaterialization = createPluginActionCallerMaterializationFixture('acme.target');
        const service = createPluginInvocationActionsService({
            seed: {
                plugin: { id: 'acme.target', version: '1.0.0' },
                contribution: { id: 'request', qualifiedId: 'acme.target/actions/request' },
                occurrenceId: 'target-occurrence-h',
                sourceCustody: { kind: 'managed', immutableGenerationId: 'immutable-target-h', installSource: 'archive' },
                surface: 'plugin',
                resolveCurrentPluginMaterializationRef: callerMaterialization.resolveCurrentPluginMaterializationRef,
                signal: new AbortController().signal,
                isOccurrenceCurrent: () => true,
            },
            actionExecutor: { execute: vi.fn() },
            invokeContributedAction,
        });
        const admittedByTargetG = createAdmittedTargetedOperationExecutionHandle({
            action: { pluginId: 'acme.contributor', localId: 'publish' },
            identity: {
                target: { pluginId: 'acme.target' },
                point: { pointId: 'providers', protocol: { id: 'acme.providers/provider', version: 1 } },
                contributor: {
                    pluginId: 'acme.contributor',
                    contributionId: 'primary',
                    occurrenceId: 'contributor-occurrence-g',
                    sourceCustody: { kind: 'managed', immutableGenerationId: 'immutable-contributor-g', installSource: 'archive' },
                },
                role: 'publish',
            },
            targetOccurrenceId: 'target-occurrence-g',
            targetProtocol: permissiveTargetProtocol('publish'),
        });

        await expect(service.executeAdmittedTargetedOperation(
            admittedByTargetG,
            { title: 'Ready' },
        )).rejects.toMatchObject({
            code: 'plugin_action_generation_retired',
            actionHandlerInvocation: 'notStarted',
        });
        await expect(service.executeAdmittedTargetedOperationWithExecutionOrigin(
            admittedByTargetG,
            { title: 'Ready' },
        )).rejects.toMatchObject({
            code: 'plugin_action_generation_retired',
            actionHandlerInvocation: 'notStarted',
        });
        expect(invokeContributedAction).not.toHaveBeenCalled();
    });
});
