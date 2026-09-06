type FullscreenDocumentElement = HTMLElement & {
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
  webkitRequestFullscreen?: () => void;
};

type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: "landscape") => Promise<void>;
};

/** Mouse capture is optional in embedded browsers; keyboard turning remains available. */
export async function requestMouseLook(target: { requestPointerLock?: () => Promise<void> | void }): Promise<boolean> {
  if (!target.requestPointerLock) return false;
  try {
    await target.requestPointerLock();
    return true;
  } catch {
    return false;
  }
}

export function isTouchFirstDevice() {
  if (typeof window === "undefined") return false;
  return navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
}

/**
 * Fullscreen and orientation locking are permission-gated browser features.
 * This must be called directly from the headphone screen's continue gesture.
 */
export async function requestMobileLandscape() {
  if (!isTouchFirstDevice()) return;

  const root = document.documentElement as FullscreenDocumentElement;
  try {
    if (!document.fullscreenElement) {
      if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: "hide" });
      else root.webkitRequestFullscreen?.();
    }
  } catch {
    // iOS Safari and embedded browsers may refuse document fullscreen. The
    // portrait guard supplies a clear rotate-device fallback in that case.
  }

  try {
    await (window.screen.orientation as LockableScreenOrientation | undefined)?.lock?.("landscape");
  } catch {
    // Orientation locking is not universally implemented, even in fullscreen.
  }
}
