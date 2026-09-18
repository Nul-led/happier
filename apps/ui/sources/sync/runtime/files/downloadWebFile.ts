/** Hand a completed local file to the browser before releasing its backing storage. */
export function downloadWebFile(file: File | Blob, name: string, cleanup: () => Promise<void>): void {
    let url: string;
    try {
        url = URL.createObjectURL(file);
    } catch (error) {
        void cleanup();
        throw error;
    }
    try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        anchor.rel = 'noopener noreferrer';
        try { anchor.style.display = 'none'; } catch {}
        try { document.body?.appendChild(anchor); } catch {}
        anchor.click();
        // Keep the synthetic navigation visible to browser download observers.
        setTimeout(() => { try { anchor.remove(); } catch {} }, 0);
    } finally {
        setTimeout(() => {
            try { URL.revokeObjectURL(url); } catch {}
            void cleanup();
        }, 1_000);
    }
}
