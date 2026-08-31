import { vi } from 'vitest';

export type LocalStorageMockHandle = {
    store: Map<string, string>;
    getItemMock: ReturnType<typeof vi.fn<(key: string) => string | null>>;
    setItemMock: ReturnType<typeof vi.fn<(key: string, value: string) => void>>;
    removeItemMock: ReturnType<typeof vi.fn<(key: string) => void>>;
    restore: () => void;
};

export function installLocalStorageMock(): LocalStorageMockHandle {
    const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const store = new Map<string, string>();
    const getItemMock = vi.fn((key: string) => store.get(key) ?? null);
    const setItemMock = vi.fn((key: string, value: string) => {
        store.set(key, value);
    });
    const removeItemMock = vi.fn((key: string) => {
        store.delete(key);
    });

    const localStorageMock: Storage = {
        get length() {
            return store.size;
        },
        clear: vi.fn(() => {
            store.clear();
        }),
        getItem: getItemMock,
        key: vi.fn((index: number) => [...store.keys()][index] ?? null),
        setItem: setItemMock,
        removeItem: removeItemMock,
    };

    Object.defineProperty(globalThis, 'localStorage', {
        value: localStorageMock,
        configurable: true,
    });

    return {
        store,
        getItemMock,
        setItemMock,
        removeItemMock,
        restore: () => {
            if (previousDescriptor) {
                Object.defineProperty(globalThis, 'localStorage', previousDescriptor);
                return;
            }
            Reflect.deleteProperty(globalThis, 'localStorage');
        },
    };
}
