/**
 * Policy for opening CCTV quick-view windows from GeoINT camera pins. Pure + dependency-free so the
 * open/focus/deny decision is unit-testable without the window store. A soft cap bounds how many live
 * players can run at once (each window is its own HLS/<video> instance), preventing the kind of
 * resource flood the early EyeSpy auto-grid hit.
 */

export const MAX_CAMERA_WINDOWS = 8;

export type CameraWindowAction = 'focus' | 'open' | 'deny';

/** Deterministic window id for a stream, so re-clicking the same pin re-focuses its window. */
export function cameraWindowId(streamId: string): string {
  return `camera-view:${streamId}`;
}

/**
 * Decide what to do when a camera pin is clicked, given the ids of currently-open camera windows.
 * - 'focus' if a window for this stream is already open (cap does not apply).
 * - 'deny' if opening a NEW stream would exceed the cap.
 * - 'open' otherwise.
 */
export function cameraWindowAction(
  openCameraIds: string[],
  streamId: string,
  cap: number = MAX_CAMERA_WINDOWS
): CameraWindowAction {
  if (openCameraIds.includes(cameraWindowId(streamId))) return 'focus';
  if (openCameraIds.length >= cap) return 'deny';
  return 'open';
}
