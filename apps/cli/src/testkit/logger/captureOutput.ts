import { vi } from 'vitest'

type WriteCallback = (error?: Error | null) => void

function formatConsoleArgs(args: readonly unknown[]): string {
  return args.map((arg) => String(arg)).join(' ')
}

/**
 * Parses the captured stream as the exact JSON command envelope.
 *
 * The strict path first joins every captured fragment into one payload, so a
 * single envelope written across multiple writes still parses as one value.
 * Only when that whole-stream parse fails — other captured output (for
 * example ordinary in-process daemon runtime diagnostics) shares the stream —
 * does this select the last captured line that parses as a command envelope
 * (`ok` boolean plus `kind` string). A stream with no command envelope keeps
 * failing loudly with the original parse error.
 */
function parseJsonCommandEnvelope(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (wholeStreamError) {
    const lines = text.split(/\r?\n/u)
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]!.trim()
      if (!line) continue
      let candidate: unknown
      try {
        candidate = JSON.parse(line) as unknown
      } catch {
        continue
      }
      if (
        candidate
        && typeof candidate === 'object'
        && typeof (candidate as { ok?: unknown }).ok === 'boolean'
        && typeof (candidate as { kind?: unknown }).kind === 'string'
      ) {
        return candidate
      }
    }
    throw wholeStreamError
  }
}

function captureWriteStream(stream: 'stdout' | 'stderr'): {
  chunks: string[]
  text: () => string
  restore: () => void
} {
  const chunks: string[] = []
  const writeSpy = vi.spyOn(process[stream], 'write').mockImplementation(
    ((
      chunk: string | Uint8Array,
      encoding?: BufferEncoding | WriteCallback,
      callback?: WriteCallback,
    ) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      if (typeof encoding === 'function') {
        encoding(null)
      } else if (typeof callback === 'function') {
        callback(null)
      }
      return true
    }) as typeof process.stdout.write,
  )

  return {
    chunks,
    text: () => chunks.join(''),
    restore(): void {
      writeSpy.mockRestore()
    },
  }
}

export function captureStdout(): {
  chunks: string[]
  text: () => string
  restore: () => void
} {
  return captureWriteStream('stdout')
}

export function captureStdoutJsonOutput<T = any>(): {
  chunks: string[]
  json: <TJson = T>() => TJson
  restore: () => void
} {
  const stdout = captureStdout()

  return {
    chunks: stdout.chunks,
    json<TJson = T>(): TJson {
      return JSON.parse(stdout.text().trim()) as TJson
    },
    restore(): void {
      stdout.restore()
    },
  }
}

export function captureStderr(): {
  chunks: string[]
  text: () => string
  restore: () => void
} {
  return captureWriteStream('stderr')
}

export function captureConsoleLogAndMuteStdout(): {
  logs: string[]
  stdoutChunks: string[]
  restore: () => void
} {
  const stdout = captureStdout()
  const logs = stdout.chunks
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(formatConsoleArgs(args))
  })

  return {
    logs,
    stdoutChunks: stdout.chunks,
    restore(): void {
      logSpy.mockRestore()
      stdout.restore()
    },
  }
}

export function captureConsoleText(): {
  lines: string[]
  text: () => string
  restore: () => void
} {
  const lines: string[] = []
  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(
    ((
      chunk: string | Uint8Array,
      encoding?: BufferEncoding | WriteCallback,
      callback?: WriteCallback,
    ) => {
      lines.push((typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')).replace(/\n$/u, ''))
      if (typeof encoding === 'function') {
        encoding(null)
      } else if (typeof callback === 'function') {
        callback(null)
      }
      return true
    }) as typeof process.stdout.write,
  )
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(formatConsoleArgs(args))
  })
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    lines.push(formatConsoleArgs(args))
  })
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(formatConsoleArgs(args))
  })

  return {
    lines,
    text(): string {
      return lines.join('\n')
    },
    restore(): void {
      errorSpy.mockRestore()
      warnSpy.mockRestore()
      logSpy.mockRestore()
      writeSpy.mockRestore()
    },
  }
}

export function captureConsoleJsonOutput<T = any>(): {
  logs: string[]
  json: <TJson = T>() => TJson
  restore: () => void
} {
  const logs: string[] = []
  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(
    ((
      chunk: string | Uint8Array,
      encoding?: BufferEncoding | WriteCallback,
      callback?: WriteCallback,
    ) => {
      logs.push((typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')).replace(/\n$/u, ''))
      if (typeof encoding === 'function') {
        encoding(null)
      } else if (typeof callback === 'function') {
        callback(null)
      }
      return true
    }) as typeof process.stdout.write,
  )
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(formatConsoleArgs(args))
  })

  return {
    logs,
    json<TJson = T>(): TJson {
      return parseJsonCommandEnvelope(logs.join('\n').trim()) as TJson
    },
    restore(): void {
      logSpy.mockRestore()
      writeSpy.mockRestore()
    },
  }
}
