import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, expect, it } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { useExecutionRunLauncherOptionsModel } from './useExecutionRunLauncherOptionsModel';

afterEach(standardCleanup);

it.each([true, false])('keeps report selection %s explicit through the options owner', async (initial) => {
    const hook = await renderHook(() => {
        const [actionInput, setActionInput] = React.useState<Record<string, unknown>>({
            permissionMode: 'read_only', notifyParentOnCompletion: initial,
        });
        return useExecutionRunLauncherOptionsModel({
            sessionId: 'session_1', intent: 'delegate', actionInput, setActionInput,
            enabledAgentIds: [], executionRunsBackends: {},
            acpCatalogSettingsV1: { v: 2, backends: [] },
            initialBackendTarget: null, fallbackAgentId: null,
            machineCapabilitiesState: { status: 'idle' },
        });
    });
    expect(hook.getCurrent().selectedNotifyParentOnCompletion).toBe(initial);
    await act(async () => hook.getCurrent().onPatch({ notifyParentOnCompletion: !initial }));
    expect(hook.getCurrent().selectedNotifyParentOnCompletion).toBe(!initial);
});
