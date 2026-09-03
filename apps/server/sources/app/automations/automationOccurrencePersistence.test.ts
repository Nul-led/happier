import { describe, expect, it, vi } from "vitest";

import type { Tx } from "@/storage/inTx";

import { findAutomationOccurrencesTx } from "./automationOccurrencePersistence";

describe("findAutomationOccurrencesTx", () => {
    it("reads a bounded occurrence set in one query through the canonical Automation identity", async () => {
        const findMany = vi.fn().mockResolvedValue([
            { id: "run-1", automationId: "automation-1", occurrenceKey: "occurrence-1" },
        ]);

        await expect(findAutomationOccurrencesTx({
            tx: { automationRun: { findMany } } as unknown as Tx,
            accountId: "account-1",
            occurrences: [
                { automationId: "automation-1", occurrenceKey: "occurrence-1" },
                { automationId: "automation-2", occurrenceKey: "occurrence-2" },
            ],
            select: { id: true, automationId: true, occurrenceKey: true },
        })).resolves.toEqual([
            { id: "run-1", automationId: "automation-1", occurrenceKey: "occurrence-1" },
        ]);

        expect(findMany).toHaveBeenCalledTimes(1);
        expect(findMany).toHaveBeenCalledWith({
            where: {
                accountId: "account-1",
                OR: [
                    { automationId: "automation-1", occurrenceKey: "occurrence-1" },
                    { automationId: "automation-2", occurrenceKey: "occurrence-2" },
                ],
            },
            select: { id: true, automationId: true, occurrenceKey: true },
        });
    });
});
