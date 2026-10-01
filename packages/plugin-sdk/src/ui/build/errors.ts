export class PluginUiBuildError extends Error {
    readonly code: string;
    readonly contributionId?: string;

    constructor(code: string, message: string, contributionId?: string) {
        super(message);
        this.name = 'PluginUiBuildError';
        this.code = code;
        this.contributionId = contributionId;
    }
}
