import type { ConfinementPlan } from './plan';

// Re-export the plan surface for convenience: callers wire a plan and spawn from
// one module. `export type` is required under verbatimModuleSyntax for the type;
// buildConfinementPlan is a runtime value and re-exported plainly.
export type { ConfinementPlan } from './plan';
export { buildConfinementPlan } from './plan';

/**
 * Output sinks for a confined subprocess. All optional: a caller that only cares
 * about exit can omit the stream callbacks. The platform impls are responsible
 * for wiring these to the child's stdout/stderr/exit.
 */
export interface ConfinedIO {
  onStdout?: (b: Buffer) => void;
  onStderr?: (b: Buffer) => void;
  onExit?: (code: number | null) => void;
}

/**
 * A live handle to a subprocess running inside the OS egress jail. `stop()` tears
 * the jail down and terminates the child; it must be idempotent and safe to call
 * after the process has already exited.
 */
export interface ConfinedHandle {
  pid: number;
  stop(): Promise<void>;
}

/**
 * A per-OS spawn implementation. Registered at module load by the platform task
 * (Linux: Task 3, Windows: Task 5) via __registerLinuxImpl / __registerWin32Impl,
 * or injected wholesale in tests via __setPlatformImplsForTest.
 */
export type PlatformImpl = (
  cmd: string,
  args: string[],
  plan: ConfinementPlan,
  io: ConfinedIO,
) => Promise<ConfinedHandle>;

interface PlatformImpls {
  /** The platform to dispatch on. Defaults to process.platform. */
  platform: NodeJS.Platform | string;
  linux?: PlatformImpl;
  win32?: PlatformImpl;
}

// Module-global registry. Real impls self-register at load; tests override it.
let impls: PlatformImpls = { platform: process.platform };

/**
 * Launch a subprocess inside the OS egress jail, dispatching on the active
 * platform. macOS is a hard refusal: sandbox-exec offers no sound CIDR egress
 * confinement, so we will not pretend to jail there. Linux/win32 route to their
 * registered impl; if that impl isn't wired yet, we throw rather than silently
 * spawning an unconfined child — a half-built release must fail loud.
 */
export async function spawnConfined(
  cmd: string,
  args: string[],
  plan: ConfinementPlan,
  io: ConfinedIO,
): Promise<ConfinedHandle> {
  const { platform } = impls;

  if (platform === 'darwin') {
    throw new Error('confined spawn is not supported on macOS (no sound CIDR egress jail via sandbox-exec)');
  }

  if (platform === 'linux' || platform === 'win32') {
    const impl = impls[platform];
    if (!impl) {
      throw new Error(`confined spawn: ${platform} impl not registered`);
    }
    return impl(cmd, args, plan, io);
  }

  throw new Error(`confined spawn is unsupported on platform: ${platform}`);
}

/** Real Linux impl (Task 3) self-registers here at module load. */
export function __registerLinuxImpl(fn: PlatformImpl): void {
  impls.linux = fn;
}

/** Real Windows impl (Task 5) self-registers here at module load. */
export function __registerWin32Impl(fn: PlatformImpl): void {
  impls.win32 = fn;
}

/**
 * Test seam: replace the platform + injected impls wholesale. Passing a partial
 * resets any previously registered/injected impls not named in `next`, so cases
 * don't bleed into one another.
 */
export function __setPlatformImplsForTest(next: Partial<PlatformImpls> & { platform: NodeJS.Platform | string }): void {
  impls = { platform: next.platform, linux: next.linux, win32: next.win32 };
}
