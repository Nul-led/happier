export type GithubMarkdownDisplaySegmentV1 =
  | Readonly<{ kind: 'markdown'; value: string }>
  | Readonly<{ kind: 'attachment'; media: 'asset' | 'video'; url: string }>;

type SourceLine = Readonly<{ bytes: string; content: string }>;
type OpenFence = Readonly<{ marker: '`' | '~'; length: number }>;

const VIDEO_PATH_EXTENSION = /\.(?:m4v|mov|mp4|ogg|ogv|webm)$/i;
const MAX_VIDEO_BLOCK_LINES = 8;

function splitSourceLines(source: string): readonly SourceLine[] {
  if (source.length === 0) return Object.freeze([]);
  const lines: SourceLine[] = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character !== '\n' && character !== '\r') continue;
    const end = character === '\r' && source[index + 1] === '\n'
      ? index + 2
      : index + 1;
    lines.push(Object.freeze({
      bytes: source.slice(start, end),
      content: source.slice(start, index),
    }));
    start = end;
    index = end - 1;
  }
  if (start < source.length) {
    lines.push(Object.freeze({ bytes: source.slice(start), content: source.slice(start) }));
  }
  return Object.freeze(lines);
}

function readFenceOpener(line: string): OpenFence | null {
  const match = /^(?: {0,3})(`{3,}|~{3,})/.exec(line);
  const run = match?.[1];
  if (run === undefined) return null;
  return Object.freeze({ marker: run[0] as '`' | '~', length: run.length });
}

function closesFence(line: string, fence: OpenFence): boolean {
  const match = /^(?: {0,3})(`+|~+)[ \t]*$/.exec(line);
  const run = match?.[1];
  return run !== undefined && run[0] === fence.marker && run.length >= fence.length;
}

function readHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function standaloneUrlAttachment(line: string): GithubMarkdownDisplaySegmentV1 | null {
  const value = line.trim();
  if (value.length === 0 || /\s/.test(value)) return null;
  const url = readHttpUrl(value);
  if (url === null) return null;
  if (url.hostname.toLowerCase() === 'github.com'
    && url.pathname.startsWith('/user-attachments/assets/')
    && url.pathname.length > '/user-attachments/assets/'.length
  ) {
    return Object.freeze({ kind: 'attachment' as const, media: 'asset' as const, url: value });
  }
  if (VIDEO_PATH_EXTENSION.test(url.pathname)) {
    return Object.freeze({ kind: 'attachment' as const, media: 'video' as const, url: value });
  }
  return null;
}

function readTagSource(tag: string): string | null {
  const match = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(tag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value !== undefined && readHttpUrl(value) !== null ? value : null;
}

function videoBlockAttachment(
  lines: readonly SourceLine[],
  start: number,
): Readonly<{ segment: GithubMarkdownDisplaySegmentV1; nextLine: number }> | null {
  const opening = lines[start]?.content.trim();
  if (opening === undefined || !/^<video\b/i.test(opening)) return null;

  const block: string[] = [];
  let closingLine = -1;
  for (let offset = 0; offset < MAX_VIDEO_BLOCK_LINES && start + offset < lines.length; offset += 1) {
    const content = lines[start + offset]!.content;
    block.push(content);
    const close = /<\/video\s*>/i.exec(content);
    if (close !== null) {
      if (content.slice(close.index + close[0].length).trim().length !== 0) return null;
      closingLine = start + offset;
      break;
    }
  }
  if (closingLine < start) return null;

  const html = block.join('\n');
  const tags = html.match(/<(?:video|source)\b[^>]*>/gi) ?? [];
  const source = tags.map(readTagSource).find((value): value is string => value !== null);
  if (source === undefined) return null;
  return Object.freeze({
    segment: Object.freeze({ kind: 'attachment' as const, media: 'video' as const, url: source }),
    nextLine: closingLine + 1,
  });
}

/**
 * Separates the small attachment vocabulary GitHub documents from Markdown.
 *
 * Fenced and indented code remain exact source bytes. In particular, an
 * unterminated or mismatched fence never exposes its apparent links as media.
 */
export function projectGithubMarkdownForDisplay(
  source: string,
): readonly GithubMarkdownDisplaySegmentV1[] {
  if (source.length === 0) return Object.freeze([]);
  const lines = splitSourceLines(source);
  const result: GithubMarkdownDisplaySegmentV1[] = [];
  let markdown = '';
  let fence: OpenFence | null = null;

  const flushMarkdown = (): void => {
    if (markdown.length === 0) return;
    result.push(Object.freeze({ kind: 'markdown' as const, value: markdown }));
    markdown = '';
  };

  for (let index = 0; index < lines.length;) {
    const line = lines[index]!;
    if (fence !== null) {
      markdown += line.bytes;
      if (closesFence(line.content, fence)) fence = null;
      index += 1;
      continue;
    }

    const opener = readFenceOpener(line.content);
    if (opener !== null) {
      fence = opener;
      markdown += line.bytes;
      index += 1;
      continue;
    }

    // Four leading spaces or one tab is Markdown's indented-code plane. It is
    // never inspected for links or HTML attachment blocks.
    if (line.content.startsWith('    ') || line.content.startsWith('\t')) {
      markdown += line.bytes;
      index += 1;
      continue;
    }

    const urlAttachment = standaloneUrlAttachment(line.content);
    if (urlAttachment !== null) {
      flushMarkdown();
      result.push(urlAttachment);
      index += 1;
      continue;
    }

    const videoAttachment = videoBlockAttachment(lines, index);
    if (videoAttachment !== null) {
      flushMarkdown();
      result.push(videoAttachment.segment);
      index = videoAttachment.nextLine;
      continue;
    }

    markdown += line.bytes;
    index += 1;
  }

  flushMarkdown();
  return Object.freeze(result);
}
