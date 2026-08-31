import { describe, expect, it } from 'vitest';

import { projectGithubMarkdownForDisplay } from './projectGithubMarkdownForDisplay.js';

const ASSET = 'https://github.com/user-attachments/assets/01234567-89ab-cdef-0123-456789abcdef';
const VIDEO = 'https://media.example.test/demo.mp4';
const VIDEO_SOURCE = 'https://media.example.test/demo.webm';
const VIDEO_BLOCK = `<video controls>\n  <source src="${VIDEO_SOURCE}">\n</video>`;

describe('GitHub Markdown display projection', () => {
  it('projects supported GitHub attachments only outside fenced and indented code', () => {
    const backticks = `\`\`\`md\n${ASSET}\n${VIDEO_BLOCK}\n\`\`\`\n`;
    const tildes = `~~~~html\n${VIDEO}\n${VIDEO_BLOCK}\n~~~~\n`;
    const indented = `    ${ASSET}\n\t${VIDEO_BLOCK.replaceAll('\n', '\n\t')}\n`;
    const input = [
      'Before\n',
      `${ASSET}\n`,
      `${VIDEO}\n`,
      `${VIDEO_BLOCK}\n`,
      backticks,
      tildes,
      indented,
      'After',
    ].join('');

    const projected = projectGithubMarkdownForDisplay(input);

    expect(projected.filter((segment) => segment.kind === 'attachment')).toEqual([
      { kind: 'attachment', media: 'asset', url: ASSET },
      { kind: 'attachment', media: 'video', url: VIDEO },
      { kind: 'attachment', media: 'video', url: VIDEO_SOURCE },
    ]);
    const markdown = projected
      .filter((segment) => segment.kind === 'markdown')
      .map((segment) => segment.value)
      .join('');
    expect(markdown).toContain(backticks);
    expect(markdown).toContain(tildes);
    expect(markdown).toContain(indented);
  });

  it('keeps unclosed and mismatched GitHub Markdown fences verbatim', () => {
    const input = [
      '````html',
      ASSET,
      '```',
      VIDEO_BLOCK,
      '~~~',
      VIDEO,
    ].join('\n');

    expect(projectGithubMarkdownForDisplay(input)).toEqual([
      { kind: 'markdown', value: input },
    ]);
  });
});
