import { EngagementController, type EngagementControllerOpts } from './engagement-controller';

let instance: EngagementController | null = null;

/** Initialise the process-wide EngagementController (call once at startup). */
export function initEngagementController(opts: EngagementControllerOpts): EngagementController {
  instance = new EngagementController(opts);
  return instance;
}

/** The shared controller, or null if not yet initialised. */
export function getEngagementController(): EngagementController | null {
  return instance;
}

/** test-only */
export function _resetEngagementControllerForTest(): void {
  instance = null;
}
