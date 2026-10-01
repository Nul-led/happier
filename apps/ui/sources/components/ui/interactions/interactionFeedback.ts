/** Focus treatment reuses the border already reserved by both primitives. */
export function focusRingStyle(params: Readonly<{
    focused: boolean;
    color: string;
}>) {
    return params.focused ? { borderColor: params.color } : undefined;
}
