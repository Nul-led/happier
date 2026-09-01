import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ElectronSystemTasks } from './systemTasks';

test('runs hsetup over stdin and projects events, prompt responses, and results through the shared bridge contract', async () => {
    if (process.platform === 'win32') return;
    const root = mkdtempSync(join(tmpdir(), 'happier-electron-system-task-'));
    const executable = join(root, 'hsetup');
    writeFileSync(executable, `#!/bin/sh
test "$1" = "system-tasks" || exit 10
test "$2" = "run" || exit 11
IFS= read -r spec || exit 12
printf '{"protocolVersion":1,"taskId":"child","tsMs":1,"type":"prompt","stepId":"confirm","message":"Confirm"}\n'
IFS= read -r answer || exit 13
printf '{"protocolVersion":1,"taskId":"child","ok":true,"data":{"spec":%s,"answer":%s}}\n' "$spec" "$answer"
`);
    chmodSync(executable, 0o755);

    const emitted: Array<readonly [string, unknown]> = [];
    let resolveResult: ((payload: unknown) => void) | undefined;
    const resultPromise = new Promise<unknown>((resolve) => {
        resolveResult = resolve;
    });
    const tasks = new ElectronSystemTasks({
        resolveHsetupPath: () => executable,
        emitEvent: (name, payload) => {
            emitted.push([name, payload]);
            if (name.endsWith('/result')) resolveResult?.(payload);
        },
    });
    const specJson = '{"protocolVersion":1,"kind":"system.ping.v1","params":{}}';

    const { taskId } = await tasks.start(specJson);
    assert.equal(taskId, 'system_task_1');
    await tasks.respondToPrompt(taskId, '{"confirmed":true}');
    const result = await new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timed out waiting for system task result')), 10_000);
        void resultPromise.then((payload) => {
            clearTimeout(timeout);
            resolve(payload);
        });
    });

    assert.deepEqual(result, {
        protocolVersion: 1,
        taskId,
        ok: true,
        data: {
            spec: JSON.parse(specJson),
            answer: { confirmed: true },
        },
    });
    assert.equal(emitted[0]?.[0], `systemTasks://task/${taskId}/event`);
    assert.deepEqual(tasks.snapshot(taskId), {
        events: [{
            protocolVersion: 1,
            taskId,
            tsMs: 1,
            type: 'prompt',
            stepId: 'confirm',
            message: 'Confirm',
        }],
        result,
    });

    rmSync(root, { recursive: true, force: true });
});

test('rejects malformed task specifications before starting hsetup', async () => {
    const tasks = new ElectronSystemTasks({
        resolveHsetupPath: () => '/not/reached',
        emitEvent: () => {},
    });

    await assert.rejects(tasks.start('{"protocolVersion":1}'), /Invalid system task specification JSON/u);
});
