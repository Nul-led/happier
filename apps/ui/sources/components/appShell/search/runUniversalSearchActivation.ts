/**
 * The single surface-level activation order: commit happens in the option
 * callback, this helper validates that committed identity, then dismisses the
 * host before awaiting the exact owner action. Keeping it explicit makes
 * currentness, focus restoration and error custody order testable without
 * mounting either platform host.
 */
export async function runUniversalSearchActivation(input: Readonly<{
    prepare?(): boolean | Promise<boolean>;
    dismiss(): void;
    activate(): Promise<boolean>;
    presentFailure(): void;
}>): Promise<void> {
    try {
        if (input.prepare && !await input.prepare()) {
            input.presentFailure();
            return;
        }
    } catch {
        input.presentFailure();
        return;
    }
    input.dismiss();
    let succeeded = false;
    try {
        succeeded = await input.activate();
    } catch {
        succeeded = false;
    }
    if (!succeeded) input.presentFailure();
}
