import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSetupChoicePrompt, renderPlanet, renderSetupChoice, renderSetupWelcome, supportsBrailleArt } from './planet';

beforeEach(() => vi.stubEnv('WT_SESSION', 'test-modern-terminal'));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('setup welcome handoff', () => {
  it('keeps setup context without repeating installer artwork or the brand heading', () => {
    vi.stubEnv('TERM', 'xterm-256color');
    vi.stubEnv('HAPPIER_INSTALLER_WELCOME_SHOWN', '');
    expect(renderSetupWelcome({ machineName: 'preview-machine', subtitle: 'Choose your connection' }).split('\n')).toContain('Happier');
    vi.stubEnv('HAPPIER_INSTALLER_WELCOME_SHOWN', '1');
    const output = renderSetupWelcome({ machineName: 'preview-machine', subtitle: 'Choose your connection', columns: 80 });
    expect(output).toContain('preview-machine');
    expect(output).toContain('Choose your connection');
    expect(output.split('\n')).not.toContain('Happier');
    expect(output).not.toMatch(/[\u2801-\u28ff]/u);
  });

  it('places the static planet beside the complete first setup choice on a wide terminal', () => {
    vi.stubEnv('TERM', 'xterm-256color');
    vi.stubEnv('NO_COLOR', '1');
    vi.stubEnv('HAPPIER_INSTALLER_WELCOME_SHOWN', '');
    const output = renderSetupChoice({
      machineName: 'preview-machine',
      subtitle: 'Choose or create a Home. Your coding agents run here.',
      question: 'How would you like to set up this computer?',
      description: 'A Home keeps your Happier account, sessions, and settings together.',
      choices: [
        { key: 'f', label: 'Find my linked Homes (recommended)', description: 'sign in through your sign-in service', isDefault: true },
        { key: 'e', label: 'Connect to an existing Home' },
        { key: 'c', label: 'Create a Personal Home on this computer' },
        { key: 'x', label: 'Exit' },
      ],
      columns: 92,
      rows: 24,
      isTTY: true,
    });
    const lines = output.split('\n');
    expect(lines.some((line) => /^[ \u2800-\u28ff]{24} {3}Happier$/u.test(line))).toBe(true);
    expect(lines.some((line) => /^[ \u2800-\u28ff]{24} {3}How would you like to set up this computer\?$/u.test(line))).toBe(true);
    expect(output).toContain('Find my linked Homes (recommended)');
    expect(output).toContain('sign-in service');
    expect(output.trimEnd().endsWith('Use ↑/↓ to move, Enter to select, or type a letter')).toBe(true);
  });

  it('uses compact complete text without the planet on narrow terminals', () => {
    vi.stubEnv('TERM', 'xterm-256color');
    vi.stubEnv('HAPPIER_INSTALLER_WELCOME_SHOWN', '');
    const options = {
      machineName: 'preview-machine',
      subtitle: 'Choose your connection',
      question: 'Question',
      choices: [{ key: 'a', label: 'A deliberately long option whose meaning must wrap instead of being cropped', isDefault: true }],
      columns: 44,
      rows: 24,
      isTTY: true,
    } as const;
    const narrow = renderSetupChoice(options);
    expect(narrow).toContain('Happier\nChoose your connection\nComputer: preview-machine');
    expect(narrow.replace(/\n\s*/gu, ' ')).toContain('A deliberately long option whose meaning must wrap instead of being cropped');
    expect(narrow).not.toMatch(/[\u2801-\u28ff]/u);

    vi.stubEnv('HAPPIER_INSTALLER_WELCOME_SHOWN', '1');
    const handedOff = renderSetupChoice({ ...options, columns: 100 });
    expect(handedOff).not.toContain('Happier');
    expect(handedOff).toMatch(/[\u2801-\u28ff]/u);
    expect(handedOff).toContain('Question');
    expect(handedOff).toContain('Computer: preview-machine');
  });

  it('offers idle frames only for a wide capable terminal', () => {
    vi.stubEnv('TERM', 'xterm-256color');
    vi.stubEnv('HAPPIER_NO_ANIMATION', '');
    const base = {
      machineName: 'preview-machine',
      subtitle: 'Choose your connection',
      question: 'Question',
      choices: [{ key: 'a', label: 'Answer', isDefault: true }],
      columns: 92,
      rows: 24,
      isTTY: true,
    } as const;
    const animated = createSetupChoicePrompt(base);
    expect(animated.message).toBe(animated.renderMessage?.(0));
    expect(animated.renderMessage?.(1)).not.toBe(animated.message);
    vi.stubEnv('HAPPIER_NO_ANIMATION', ' TRUE ');
    const still = createSetupChoicePrompt(base);
    expect(still).toMatchObject({ animate: false, renderMessage: expect.any(Function) });
    expect(still.renderMessage?.(0)).toBe(still.message);
    vi.stubEnv('HAPPIER_NO_ANIMATION', '');
    expect(createSetupChoicePrompt({ ...base, columns: 44 })).toMatchObject({ animate: false, renderMessage: expect.any(Function) });
    expect(createSetupChoicePrompt({ ...base, isTTY: false }).renderMessage).toBeUndefined();
  });

  it('marks and highlights the currently selected choice independently of the recommendation', () => {
    vi.stubEnv('TERM', 'xterm-256color');
    vi.stubEnv('NO_COLOR', '1');
    const output = renderSetupChoice({
      machineName: 'preview-machine',
      subtitle: 'Choose your connection',
      question: 'Question',
      choices: [
        { key: 'a', label: 'Recommended answer', isDefault: true },
        { key: 'b', label: 'Current answer' },
      ],
      selectedId: 'b',
      columns: 92,
      rows: 24,
      isTTY: true,
    });
    expect(output).toContain('  a) Recommended answer');
    expect(output).toContain('› b) Current answer');
  });

  it('renders setup submenus without repeating welcome context or the planet', () => {
    vi.stubEnv('TERM', 'xterm-256color');
    vi.stubEnv('NO_COLOR', '1');
    const prompt = createSetupChoicePrompt({
      machineName: '',
      subtitle: '',
      showWelcome: false,
      question: 'Try again?',
      choices: [
        { id: 'retry', key: 'r', label: 'Retry', isDefault: true },
        { id: 'exit', key: 'x', label: 'Exit' },
      ],
      columns: 92,
      rows: 24,
      isTTY: true,
    });
    expect(prompt.message).toContain('Try again?\n› r) Retry\n  x) Exit');
    expect(prompt.message).not.toContain('Happier');
    expect(prompt.message).not.toContain('Computer:');
    expect(prompt.message).not.toMatch(/[\u2801-\u28ff]/u);
    expect(prompt).toMatchObject({ animate: false, renderMessage: expect.any(Function) });
  });
});

describe('planet', () => {
  it('uses readable text instead of Braille in legacy Windows consoles', () => {
    expect(supportsBrailleArt({}, 'win32')).toBe(false);
    expect(supportsBrailleArt({ WT_SESSION: 'terminal-session' }, 'win32')).toBe(true);
    expect(supportsBrailleArt({ TERM_PROGRAM: 'vscode' }, 'win32')).toBe(true);
    expect(supportsBrailleArt({}, 'linux')).toBe(true);
    expect(supportsBrailleArt({}, 'darwin')).toBe(true);
  });
  it('opens from an eclipse inside a fixed-height Braille canvas', () => {
    const first = renderPlanet({ columns: 24, seconds: 0, color: false });
    const later = renderPlanet({ columns: 24, seconds: 2, color: false });
    expect(later).not.toEqual(first);
    const occupiedCells = (frame: string[]) => frame.join('').replace(/\s/gu, '').length;
    expect(occupiedCells(later)).toBeGreaterThan(occupiedCells(first));
    expect(later).toHaveLength(first.length);
    for (const frame of [first, later]) {
      expect(frame.join('\n')).toMatch(/^[\u2801-\u28ff \n]+$/u);
      expect(frame.every((line) => line.length <= 24)).toBe(true);
    }
  });

  it('renders a rounded globe with varied dot density', () => {
    const frame = renderPlanet({ columns: 28, seconds: 1.6, color: false });
    const occupiedWidths = frame.map((line) => line.trim().length).filter((width) => width > 0);
    const visible = frame.join('').replace(/[ .]/gu, '');

    expect(frame).toHaveLength(13);
    expect(occupiedWidths.at(0)).toBeLessThan(occupiedWidths[Math.floor(occupiedWidths.length / 2)]!);
    expect(occupiedWidths.at(-1)).toBeLessThan(occupiedWidths[Math.floor(occupiedWidths.length / 2)]!);
    expect(new Set(visible).size).toBeGreaterThanOrEqual(8);
    expect(visible).toMatch(/^[\u2801-\u28ff]+$/u);
  });
});
