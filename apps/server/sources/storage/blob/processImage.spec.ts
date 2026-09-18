import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { IMAGE_MAX_DECODE_PIXELS, processImage, tryProcessImage } from "./processImage";

async function jpeg(width: number, height: number): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } } })
        .jpeg()
        .toBuffer();
}

async function pngWithAlpha(width: number, height: number): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.5 } } })
        .png()
        .toBuffer();
}

describe("processImage publication contract", () => {
    it("returns re-encoded publication bytes whose metadata describes those bytes", async () => {
        // The published dimensions must describe what a client will actually
        // render. Returning the source dimensions alongside resized bytes was the
        // exact mismatch that made the old thumbnail pixels unpublishable.
        const source = await jpeg(1600, 800);

        const result = await processImage(source, { fit: "contain", maxEdge: 512 });

        expect(result.format).toBe("jpeg");
        expect(result.mimeType).toBe("image/jpeg");
        expect(result.extension).toBe("jpg");
        expect(result.width).toBe(512);
        expect(result.height).toBe(256);
        const published = await sharp(result.bytes).metadata();
        expect(published.width).toBe(result.width);
        expect(published.height).toBe(result.height);
        expect(published.format).toBe("jpeg");
        expect(result.thumbhash.length).toBeGreaterThan(0);
    });

    it("preserves the aspect ratio for the avatar caller and never enlarges", async () => {
        const source = await jpeg(200, 100);

        const result = await processImage(source, { fit: "contain", maxEdge: 512 });

        expect(result.width).toBe(200);
        expect(result.height).toBe(100);
    });

    it("fits a square logo by cropping rather than distorting or upscaling", async () => {
        const wide = await processImage(await jpeg(1600, 800), { fit: "cover", maxEdge: 512 });
        expect(wide.width).toBe(512);
        expect(wide.height).toBe(512);

        const small = await processImage(await jpeg(300, 120), { fit: "cover", maxEdge: 512 });
        expect(small.width).toBe(120);
        expect(small.height).toBe(120);
    });

    it("keeps transparency as PNG and publishes opaque input as JPEG", async () => {
        const transparent = await processImage(await pngWithAlpha(300, 300), { fit: "cover", maxEdge: 512 });
        expect(transparent.format).toBe("png");
        expect(transparent.mimeType).toBe("image/png");
        expect(transparent.extension).toBe("png");

        const opaque = await processImage(await jpeg(300, 300), { fit: "cover", maxEdge: 512 });
        expect(opaque.format).toBe("jpeg");
        expect(opaque.extension).toBe("jpg");
    });

    it("validates the declared source MIME from the same decoded metadata", async () => {
        const source = await jpeg(300, 300);

        await expect(tryProcessImage(source, { expectedSourceMimeType: "image/jpeg" }))
            .resolves.toMatchObject({ ok: true });
        await expect(tryProcessImage(source, { expectedSourceMimeType: "image/png" }))
            .resolves.toEqual({ ok: false, reason: "source_mime_mismatch" });
    });

    it("strips an unrelated trailing payload instead of republishing the input", async () => {
        const source = await jpeg(300, 300);
        const smuggled = Buffer.concat([source, Buffer.from("<?php echo 'payload'; ?>")]);

        const result = await processImage(smuggled, { fit: "cover", maxEdge: 512 });

        expect(result.bytes.includes(Buffer.from("payload"))).toBe(false);
        expect(result.bytes.equals(smuggled)).toBe(false);
        expect(result.bytes.length).toBeLessThan(smuggled.length);
        // The published object is a complete, independently decodable image
        // rather than a truncation of the submitted bytes.
        expect((await sharp(result.bytes).metadata()).width).toBe(300);
    });

    it("rejects a decompression-bomb-shaped input before allocating its pixels", async () => {
        // A uniform 12000×12000 PNG is a few hundred kilobytes on the wire and
        // 576 MB of raw RGBA in memory: only the pixel bound stops it.
        const bomb = await sharp({
            create: { width: 12_000, height: 12_000, channels: 3, background: { r: 1, g: 2, b: 3 } },
        }).png({ compressionLevel: 9 }).toBuffer();
        expect(bomb.length).toBeLessThan(IMAGE_MAX_DECODE_PIXELS);

        const result = await tryProcessImage(bomb, { fit: "cover", maxEdge: 512, maxInputPixels: 4_000_000 });

        expect(result).toEqual({ ok: false, reason: "too_many_pixels" });
    });

    it("rejects an unsupported format and undecodable bytes with typed results", async () => {
        const webp = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 } } })
            .webp()
            .toBuffer();

        expect(await tryProcessImage(webp)).toEqual({ ok: false, reason: "unsupported_format" });
        expect(await tryProcessImage(Buffer.from("not an image at all"))).toEqual({
            ok: false,
            reason: "undecodable",
        });
        await expect(processImage(Buffer.from("not an image at all"))).rejects.toThrow();
    });

    it("names the decode budget as raw RGBA working memory", () => {
        expect(IMAGE_MAX_DECODE_PIXELS * 4).toBe(64 * 1024 * 1024);
    });
});
