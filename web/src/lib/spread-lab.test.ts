import { describe, expect, it } from 'vitest';
import { areaAt, decodeRun, flameClass } from './spread-lab';

const b64 = (a: number[]) => btoa(String.fromCharCode(...a));

describe('spread lab runs', () => {
  it('decodes a window and counts hectares reached by a time', () => {
    // 2x3 window, 2-minute steps: arrivals 0, 4, 10 min; 255 = never reached
    const run = decodeRun({ w: [5, 7, 2, 3], a: b64([0, 2, 255, 5, 255, 255]), f: b64([12, 30, 255, 0, 255, 255]) }, 2);
    expect([run.r0, run.c0, run.h, run.w]).toEqual([5, 7, 2, 3]);
    expect([areaAt(run, 0), areaAt(run, 4), areaAt(run, 9), areaAt(run, 10)]).toEqual([1, 2, 2, 3]);
  });

  it('rejects a window that does not match its cells', () => {
    expect(() => decodeRun({ w: [0, 0, 2, 2], a: b64([0, 1, 2]), f: b64([0, 1, 2]) }, 2)).toThrow();
  });

  it('classes flame length on the hauling-chart breaks', () => {
    expect([0.5, 1.2, 2.39, 3.4, 9].map((m) => flameClass(m, [1.2, 2.4, 3.4]))).toEqual([0, 1, 1, 3, 3]);
  });
});
