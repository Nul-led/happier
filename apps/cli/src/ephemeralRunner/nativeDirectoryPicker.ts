import { spawn } from 'node:child_process';

export type NativeDirectoryDialogSpec = Readonly<{
  executable: string;
  args: readonly string[];
}>;

export type NativeDirectoryDialogRunResult =
  | Readonly<{ status: 'completed'; exitCode: number; stdout: string }>
  | Readonly<{ status: 'unavailable' }>;

export type NativeDirectoryPickerResult =
  | Readonly<{ status: 'selected'; directory: string }>
  | Readonly<{ status: 'cancelled' | 'unavailable' }>;

export class EphemeralRunnerNativeDirectoryPickerUnavailableError extends Error {
  readonly code = 'RUNNER_NATIVE_DIRECTORY_PICKER_UNAVAILABLE' as const;

  constructor() {
    super('A supported system folder chooser is unavailable on this desktop');
    this.name = 'EphemeralRunnerNativeDirectoryPickerUnavailableError';
  }
}

/**
 * The title is endpoint copy resolved by the presentation owner, so it reaches
 * AppleScript and PowerShell as a value rather than a literal. Both embed it in
 * a double-quoted string, so both quoting characters are neutralized here; the
 * zenity/kdialog specs are argv entries and need no escaping.
 */
function quoteForEmbeddedScriptString(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

function dialogSpecs(
  platform: NodeJS.Platform,
  dialogTitle: string,
): readonly NativeDirectoryDialogSpec[] {
  if (platform === 'darwin') {
    return [{
      executable: '/usr/bin/osascript',
      args: ['-e', `POSIX path of (choose folder with prompt "${quoteForEmbeddedScriptString(dialogTitle)}")`],
    }];
  }
  if (platform === 'win32') {
    return [{
      executable: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        [
          'Add-Type -AssemblyName System.Windows.Forms;',
          '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;',
          `$dialog.Description = "${quoteForEmbeddedScriptString(dialogTitle)}";`,
          '$dialog.ShowNewFolderButton = $true;',
          'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
          '  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new();',
          '  [Console]::WriteLine($dialog.SelectedPath); exit 0',
          '} else { exit 1 }',
        ].join(' '),
      ],
    }];
  }
  if (platform === 'linux') {
    return [
      {
        executable: 'zenity',
        args: ['--file-selection', '--directory', `--title=${dialogTitle}`],
      },
      {
        executable: 'kdialog',
        args: ['--getexistingdirectory', '.', '--title', dialogTitle],
      },
    ];
  }
  return [];
}

function removeDialogLineEnding(value: string): string {
  if (value.endsWith('\r\n')) return value.slice(0, -2);
  if (value.endsWith('\n')) return value.slice(0, -1);
  return value;
}

async function runNativeDirectoryDialog(
  spec: NativeDirectoryDialogSpec,
  signal: AbortSignal,
): Promise<NativeDirectoryDialogRunResult> {
  if (signal.aborted) signal.throwIfAborted();
  return await new Promise<NativeDirectoryDialogRunResult>((resolve, reject) => {
    const child = spawn(spec.executable, [...spec.args], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: false,
    });
    let output = '';
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      settle();
    };
    const onAbort = () => {
      child.kill();
      const error = new Error('Native directory picker aborted');
      error.name = 'AbortError';
      finish(() => reject(error));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
    });
    child.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') finish(() => resolve({ status: 'unavailable' }));
      else finish(() => reject(error));
    });
    child.once('close', (code) => {
      finish(() => resolve({ status: 'completed', exitCode: code ?? 1, stdout: output }));
    });
  });
}

/**
 * Uses the operating system's directory dialog when the current desktop owns
 * one. It never implements a second filesystem browser; callers fail closed
 * when the selected shell has neither a native dialog nor the approved Happier
 * filesystem SelectionList.
 */
export async function selectDirectoryWithNativeDialog(input: Readonly<{
  platform?: NodeJS.Platform;
  graphicalSession?: boolean;
  /** Endpoint copy from the one presentation owner; this adapter writes none. */
  dialogTitle: string;
  signal: AbortSignal;
  run?: (
    spec: NativeDirectoryDialogSpec,
    signal: AbortSignal,
  ) => Promise<NativeDirectoryDialogRunResult>;
}>): Promise<NativeDirectoryPickerResult> {
  const platform = input.platform ?? process.platform;
  const graphicalSession = input.graphicalSession ?? (
    platform !== 'linux'
    || Boolean(process.env.DISPLAY?.trim() || process.env.WAYLAND_DISPLAY?.trim())
  );
  if (!graphicalSession) return { status: 'unavailable' };
  const run = input.run ?? runNativeDirectoryDialog;
  for (const spec of dialogSpecs(platform, input.dialogTitle)) {
    const result = await run(spec, input.signal);
    if (result.status === 'unavailable') continue;
    if (result.exitCode === 1) return { status: 'cancelled' };
    if (result.exitCode !== 0) continue;
    const directory = removeDialogLineEnding(result.stdout);
    return directory ? { status: 'selected', directory } : { status: 'cancelled' };
  }
  return { status: 'unavailable' };
}
