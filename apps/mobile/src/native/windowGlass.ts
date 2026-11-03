export interface WindowGlassState {
  readonly blurSupported: boolean;
  readonly showsWallpaper: boolean;
}

/** The see-through window and desktop colors are Android-only. */
export const isWindowGlassAvailable = false;

export async function setWindowGlass(
  _enabled: boolean,
  _blurDp: number,
): Promise<WindowGlassState> {
  return { blurSupported: false, showsWallpaper: false };
}

export async function readWindowGlassState(): Promise<WindowGlassState> {
  return { blurSupported: false, showsWallpaper: false };
}

export function readDesktopColorsJson(): string | null {
  return null;
}

export function clearDesktopColors(): void {}

export function subscribeDesktopColors(_listener: (json: string) => void): () => void {
  return () => {};
}
