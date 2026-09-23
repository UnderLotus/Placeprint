export interface PanPointer {
  pointerId: number;
  lastClientX: number;
  lastClientY: number;
}

export type PanGestureMode = 'idle' | 'pan' | 'pinch';

export interface PinchGesture {
  pointerIdA: number;
  pointerIdB: number;
  distance: number;
  centerX: number;
  centerY: number;
}

export interface PanGestureState {
  pointers: PanPointer[];
  mode: PanGestureMode;
  pinch: PinchGesture | null;
}

/** Keep the first pointer; this editor intentionally supports single-finger pan only. */
export function beginPanPointer(
  active: PanPointer | null,
  next: PanPointer,
): PanPointer {
  return active ?? next;
}

export function ownsPanPointer(
  active: PanPointer | null,
  pointerId: number,
): boolean {
  return active?.pointerId === pointerId;
}

export function updatePanPointer(
  active: PanPointer | null,
  pointerId: number,
  lastClientX: number,
  lastClientY: number,
): PanPointer | null {
  return ownsPanPointer(active, pointerId)
    ? { pointerId, lastClientX, lastClientY }
    : active;
}

/** Only the pointer that began the pan may end it. */
export function endPanPointer(
  active: PanPointer | null,
  pointerId: number,
): PanPointer | null {
  return ownsPanPointer(active, pointerId) ? null : active;
}

export function createPanGestureState(): PanGestureState {
  return { pointers: [], mode: 'idle', pinch: null };
}

function distanceBetween(first: PanPointer, second: PanPointer): number {
  return Math.hypot(
    second.lastClientX - first.lastClientX,
    second.lastClientY - first.lastClientY,
  );
}

function createPinchGesture(pointers: PanPointer[]): PinchGesture | null {
  if (pointers.length < 2) {
    return null;
  }
  const [first, second] = pointers;
  return {
    pointerIdA: first.pointerId,
    pointerIdB: second.pointerId,
    distance: distanceBetween(first, second),
    centerX: (first.lastClientX + second.lastClientX) / 2,
    centerY: (first.lastClientY + second.lastClientY) / 2,
  };
}

function stateForPointers(pointers: PanPointer[]): PanGestureState {
  const normalized = pointers.slice(0, 2);
  return {
    pointers: normalized,
    mode: normalized.length >= 2
      ? 'pinch'
      : normalized.length === 1
        ? 'pan'
        : 'idle',
    pinch: normalized.length >= 2 ? createPinchGesture(normalized) : null,
  };
}

/** Start a one- or two-pointer session without introducing a gesture framework. */
export function beginGesturePointer(
  state: PanGestureState,
  next: PanPointer,
): PanGestureState {
  if (state.pointers.some((pointer) => pointer.pointerId === next.pointerId)) {
    return state;
  }
  if (state.pointers.length >= 2) {
    return state;
  }
  return stateForPointers([...state.pointers, next]);
}

export function updateGesturePointer(
  state: PanGestureState,
  pointerId: number,
  lastClientX: number,
  lastClientY: number,
): PanGestureState {
  if (!state.pointers.some((pointer) => pointer.pointerId === pointerId)) {
    return state;
  }
  return stateForPointers(state.pointers.map((pointer) => (
    pointer.pointerId === pointerId
      ? { pointerId, lastClientX, lastClientY }
      : pointer
  )));
}

export function endGesturePointer(
  state: PanGestureState,
  pointerId: number,
): PanGestureState {
  if (!state.pointers.some((pointer) => pointer.pointerId === pointerId)) {
    return state;
  }
  return stateForPointers(
    state.pointers.filter((pointer) => pointer.pointerId !== pointerId),
  );
}

/** Reset all pointer state for pointercancel, lost capture, or teardown. */
export function cancelGesture(_state?: PanGestureState): PanGestureState {
  return createPanGestureState();
}
