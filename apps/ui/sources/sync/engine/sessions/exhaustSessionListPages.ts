export async function exhaustSessionListPages(params: Readonly<{
    fetchFirstPage(): Promise<void>;
    hasNextPage(): boolean;
    fetchNextPage(): Promise<void>;
    shouldContinue(): boolean;
}>): Promise<void> {
    await params.fetchFirstPage();
    while (params.shouldContinue() && params.hasNextPage()) {
        await params.fetchNextPage();
    }
}
