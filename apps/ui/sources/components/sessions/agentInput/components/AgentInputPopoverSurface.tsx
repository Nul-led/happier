import * as React from "react";
import { View } from 'react-native';
import {
  FloatingOverlay,
  type FloatingOverlayArrow,
  type FloatingOverlayEdgeFades,
} from "@/components/ui/overlays/FloatingOverlay";
import type { HoverPreviewHandlers } from "@/components/ui/popover/useHoverPreviewPopover";
import type { ScrollEdgeVisibility } from "@/components/ui/scroll/useScrollEdgeFades";

export type AgentInputPopoverSurfaceProps = Readonly<{
  children: React.ReactNode;
  maxHeight: number;
  testID?: string;
  /**
   * When true (default), the popover provides its own scroll container + edge fades.
   * When false, the popover only provides the surface/frame (useful if the child already
   * contains its own scrollable list).
   */
  scrollEnabled?: boolean;
  showScrollIndicator?: boolean;
  keyboardShouldPersistTaps?: boolean | "always" | "never" | "handled";
  edgeFades?: FloatingOverlayEdgeFades;
  edgeIndicators?: boolean | Readonly<{ size?: number; opacity?: number }>;
  arrow?: FloatingOverlayArrow;
  initialVisibility?: Partial<ScrollEdgeVisibility>;
  /** A hover preview's panel handlers: the pointer resting anywhere on the surface keeps it open. */
  hoverProps?: HoverPreviewHandlers | null;
}>;

export const AgentInputPopoverSurface = React.memo(
  (props: AgentInputPopoverSurfaceProps) => {
    const {
      children,
      maxHeight,
      testID,
      scrollEnabled = true,
      showScrollIndicator = false,
      keyboardShouldPersistTaps = "handled",
      edgeFades = { top: true, bottom: true, size: 28 },
      edgeIndicators = true,
      arrow = false,
      initialVisibility,
      hoverProps,
    } = props;

    return (
      <View testID={testID} collapsable={false} {...hoverProps}>
        <FloatingOverlay
          maxHeight={maxHeight}
          scrollEnabled={scrollEnabled}
          showScrollIndicator={showScrollIndicator}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
          edgeFades={edgeFades}
          edgeIndicators={edgeIndicators}
          arrow={arrow}
          surfaceChrome="theme"
          initialVisibility={initialVisibility}
        >
          {children}
        </FloatingOverlay>
      </View>
    );
  },
);
