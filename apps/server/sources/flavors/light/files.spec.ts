import { describe, expect, it } from "vitest";
import { getLightPublicUrl, normalizePublicPath, resolveLightPublicFilesDir } from "./files";

describe("resolveLightPublicFilesDir", () => {
  it("prefers the current HAPPIER_* files dir over a conflicting legacy HAPPY_* alias", () => {
    const env = {
      HAPPIER_SERVER_LIGHT_FILES_DIR: "/current/files",
      HAPPY_SERVER_LIGHT_FILES_DIR: "/legacy/files",
    } as NodeJS.ProcessEnv;
    expect(resolveLightPublicFilesDir(env)).toBe("/current/files");
  });

  it("falls back to the legacy HAPPY_* files dir when the current name is absent", () => {
    const env = { HAPPY_SERVER_LIGHT_FILES_DIR: "/legacy/files" } as NodeJS.ProcessEnv;
    expect(resolveLightPublicFilesDir(env)).toBe("/legacy/files");
  });
});

describe("normalizePublicPath", () => {
  it("rejects path traversal and absolute paths", () => {
    expect(() => normalizePublicPath("../x")).toThrow();
    expect(() => normalizePublicPath("a/../x")).toThrow();
    expect(() => normalizePublicPath("..\\x")).toThrow();
    expect(() => normalizePublicPath("/x")).toThrow();
    expect(() => normalizePublicPath("\\x")).toThrow();
    expect(() => normalizePublicPath("C:\\x")).toThrow();
    expect(() => normalizePublicPath("C:/x")).toThrow();
  });

  it("returns a normalized relative path", () => {
    expect(normalizePublicPath("foo//bar")).toBe("foo/bar");
    expect(normalizePublicPath("foo/./bar")).toBe("foo/bar");
    expect(normalizePublicPath("foo\\bar\\baz.txt")).toBe("foo/bar/baz.txt");
  });
});

describe("getLightPublicUrl", () => {
  it("encodes each path segment (so # and ? are not treated as URL fragment/query)", () => {
    const env = { PUBLIC_URL: "http://localhost:3005" } as NodeJS.ProcessEnv;
    const url = getLightPublicUrl(env, "foo/bar baz#qux?zap");
    expect(url).toBe("http://localhost:3005/files/foo/bar%20baz%23qux%3Fzap");
  });
});
