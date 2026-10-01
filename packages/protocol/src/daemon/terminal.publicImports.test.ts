import { expect, it } from 'vitest';

it('composes public terminal workspace and daemon launch contracts without an initialization cycle', async () => {
    const protocol = await import('../index');
    const terminal = await import('../terminal/index');
    const target = { kind: 'workspace_shell', launch: { kind: 'package_script', runTargetId: 'build' } };
    expect(terminal.SessionTerminalTargetV1Schema.parse(target)).toEqual(target);
    expect(protocol.DaemonTerminalLaunchIntentSchema.parse(target.launch)).toEqual(target.launch);
// A cold public-barrel transform took 12s in the routed Node harness.
}, 30_000);
