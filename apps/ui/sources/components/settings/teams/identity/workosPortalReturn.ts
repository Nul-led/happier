export type WorkosPortalReturnController = Readonly<{
    markOpened: () => void;
    consumeReturn: () => boolean;
}>;

export function createWorkosPortalReturnController(): WorkosPortalReturnController {
    let awaiting = false;
    return Object.freeze({
        markOpened: () => { awaiting = true; },
        consumeReturn: () => {
            if (!awaiting) return false;
            awaiting = false;
            return true;
        },
    });
}
