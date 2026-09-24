import { describe, expect, it } from 'vitest';
import {
  beginGesturePointer,
  cancelGesture,
  createPanGestureState,
  endGesturePointer,
  updateGesturePointer,
} from './photo-pan';

describe('multi-pointer photo gesture state', () => {
  it('switches from pan to pinch without moving the remaining pointer', () => {
    const first = beginGesturePointer(createPanGestureState(), {
      pointerId: 1,
      lastClientX: 10,
      lastClientY: 20,
    });
    const pinch = beginGesturePointer(first, {
      pointerId: 2,
      lastClientX: 30,
      lastClientY: 20,
    });

    expect(pinch.mode).toBe('pinch');
    expect(pinch.pinch?.distance).toBe(20);
    expect(pinch.pinch?.centerX).toBe(20);

    const moved = updateGesturePointer(pinch, 2, 50, 20);
    expect(moved.mode).toBe('pinch');
    expect(moved.pinch?.distance).toBe(40);

    const single = endGesturePointer(moved, 2);
    expect(single.mode).toBe('pan');
    expect(single.pointers).toEqual([{
      pointerId: 1,
      lastClientX: 10,
      lastClientY: 20,
    }]);
  });

  it('cleans every pointer on cancel so a later drag starts fresh', () => {
    const state = beginGesturePointer(
      beginGesturePointer(createPanGestureState(), {
        pointerId: 1,
        lastClientX: 10,
        lastClientY: 20,
      }),
      {
        pointerId: 2,
        lastClientX: 30,
        lastClientY: 20,
      },
    );

    expect(cancelGesture(state)).toEqual(createPanGestureState());
  });
});
