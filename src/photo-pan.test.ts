import { describe, expect, it } from 'vitest';
import {
  beginGesturePointer,
  beginPanPointer,
  cancelGesture,
  createPanGestureState,
  endGesturePointer,
  endPanPointer,
  ownsPanPointer,
  updateGesturePointer,
  updatePanPointer,
  type PanPointer,
} from './photo-pan';

describe('single-pointer photo pan ownership', () => {
  it('keeps pointer one active while pointer two down/move/lost events are ignored', () => {
    const pointerOne: PanPointer = {
      pointerId: 1,
      lastClientX: 10,
      lastClientY: 20,
    };
    const pointerTwo: PanPointer = {
      pointerId: 2,
      lastClientX: 30,
      lastClientY: 40,
    };

    const active = beginPanPointer(null, pointerOne);
    const afterSecondDown = beginPanPointer(active, pointerTwo);
    const afterSecondMove = updatePanPointer(afterSecondDown, 2, 90, 100);
    const afterSecondLost = endPanPointer(afterSecondMove, 2);

    expect(afterSecondDown).toBe(active);
    expect(afterSecondMove).toBe(active);
    expect(afterSecondLost).toBe(active);
    expect(ownsPanPointer(afterSecondLost, 1)).toBe(true);
    expect(ownsPanPointer(afterSecondLost, 2)).toBe(false);
  });

  it('lets the owning pointer update and end the pan', () => {
    const active = beginPanPointer(null, {
      pointerId: 1,
      lastClientX: 10,
      lastClientY: 20,
    });
    const moved = updatePanPointer(active, 1, 42, 54);

    expect(moved).toEqual({ pointerId: 1, lastClientX: 42, lastClientY: 54 });
    expect(endPanPointer(moved, 1)).toBeNull();
  });
});


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
