import type * as React from 'react';

/** One lab frame id (`WB`, `WG`, …) → its render at static props; `phone` is the 390 twin. */
export type WidgetSpecimenFrames = Readonly<Record<string, (input: Readonly<{ phone: boolean }>) => React.ReactNode>>;
