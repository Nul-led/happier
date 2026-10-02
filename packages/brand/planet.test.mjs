import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPlanetFrame, planetFrameIntervalMs, planetRowsForColumns } from './planet.mjs';

// Independently measured from PR #463, head a83d311b63f8ba5e1bba7f637fee5a90a61ed1b3.
// These cover eclipse, settled shading, the light theme and dimming, including RGB + 2x4 projection.
test('planet frames retain the approved upstream golden vectors', () => {
  for (const [options, expected] of [
    [{ columns: 24, seconds: 0.25 }, 'a3005308bb669573129624997c5328eef2c8ab6cc03da0d2f1776ac93179a2f3'],
    [{ columns: 24, seconds: 8 }, '150598003fa19157bc3379c3aa185fa5aab2a9c05a3ad057c5e1cc9428a18d28'],
    [{ columns: 24, seconds: 8, theme: 'light' }, 'bac395fdbec358ac3587065f0b6dd805b2aa1d588c017bf827cd5228fd749fe5'],
    [{ columns: 24, seconds: 8, dim: 1 }, '0afc923ab467dad23f7db3b7a53619f3d2d9352af18535f973d310703c044827'],
  ]) {
    assert.equal(createHash('sha256').update(JSON.stringify(createPlanetFrame(options))).digest('hex'), expected);
  }
});

test('static and continuing renders keep geometry while intro, theme and dim change shading', () => {
  const staticFrame = createPlanetFrame({ columns: 24 });
  assert.equal(staticFrame.length, planetRowsForColumns(24));
  assert.ok(staticFrame.flat().some(Boolean));
  assert.ok(staticFrame.every((row) => row.length === 24));
  assert.deepEqual(createPlanetFrame({ columns: 24, seconds: 8 }), createPlanetFrame({ columns: 24, seconds: 8 }));
  assert.ok(createPlanetFrame({ columns: 24, seconds: 0, intro: false }).flat().filter(Boolean).length
    > createPlanetFrame({ columns: 24, seconds: 0 }).flat().filter(Boolean).length);
  assert.equal(planetFrameIntervalMs(5.9), 66);
  assert.equal(planetFrameIntervalMs(6), 200);
});
