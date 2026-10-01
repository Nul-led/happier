import * as React from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const nativePlatform = vi.hoisted(() => ({ OS: 'ios' }));
/** `Animated.loop` hands the dots' clock to the native driver; start/stop is the observable boundary. */
const loops = vi.hoisted(() => [] as Array<{ started: number; stopped: number }>);

vi.mock('react-native', () => {
  class Value {
    constructor(readonly initial: number) {}
    setValue(_value: number) {}
    interpolate() {
      return this;
    }
  }
  return {
    ActivityIndicator: 'ActivityIndicator',
    Animated: {
      Value,
      View: 'AnimatedView',
      loop: () => {
        const record = { started: 0, stopped: 0 };
        loops.push(record);
        return { start: () => { record.started += 1; }, stop: () => { record.stopped += 1; } };
      },
      sequence: (steps: unknown[]) => steps,
      timing: (_value: unknown, config: unknown) => config,
    },
    Easing: { linear: (t: number) => t, ease: (t: number) => t, inOut: (easing: unknown) => easing },
    Platform: nativePlatform,
    View: 'View',
  };
});

import { PluginUiProvider } from './PluginUiProvider.js';
import { PluginUiProviderInternal } from './PluginUiProvider.js';
import { Spinner } from './Spinner.js';
import { HappierSpinner } from '../presentation/feedback/Spinner.js';
import { createHostApiStub, createSurfaceContext } from '../surfaceFixture.testSupport.js';

let renderer: ReactTestRenderer | null = null;

afterEach(() => {
  act(() => {
    renderer?.unmount();
  });
  renderer = null;
  loops.length = 0;
});

const running = () => loops.filter((loop) => loop.started > loop.stopped).length;

function dotOpacities(): unknown[] {
  return renderer!.root
    .findAll((node) => node.type === 'AnimatedView' && node.props.testID === 'happier-spinner-dot')
    .map((dot) => (dot.props.style as { opacity: unknown }).opacity);
}

describe('native HappierSpinner presentation', () => {
  it('keeps an indeterminate spinner visible, breathing the still H, when the projected reduced-motion preference is on', async () => {
    const context = createSurfaceContext({ platform: 'ios', reducedMotion: true });

    await act(async () => {
      renderer = create(
        <PluginUiProvider hostApi={createHostApiStub(context)} context={context}>
          <HappierSpinner testID="reduced-motion-spinner" />
        </PluginUiProvider>,
      );
    });

    expect(renderer!.root.findAllByType('ActivityIndicator' as never)).toHaveLength(0);
    expect(dotOpacities()).toEqual(Array(7).fill(0.85));
  });

  it('holds public Spinner still, with no running clock, while its retained surface is inactive', async () => {
    const context = createSurfaceContext({ platform: 'ios', reducedMotion: false });
    const renderSpinner = (active: boolean) => (
      <PluginUiProviderInternal
        hostApi={createHostApiStub(context)}
        context={context}
        surfaceActivity={{ active }}
      >
        <Spinner testID="public-spinner" />
      </PluginUiProviderInternal>
    );

    await act(async () => {
      renderer = create(renderSpinner(false));
    });
    expect(dotOpacities()).toEqual(Array(7).fill(0.85));
    expect(running()).toBe(0);

    await act(async () => {
      renderer!.update(renderSpinner(true));
    });
    expect(running()).toBe(1);

    await act(async () => {
      renderer!.update(renderSpinner(false));
    });
    expect(running()).toBe(0);
  });
});
