import { requireOptionalNativeModule } from "expo";

import type { WindowGlassState } from "./windowGlass";

export type { WindowGlassState } from "./windowGlass";

interface T3WindowGlassModule {
  setGlass(enabled: boolean, blurDp: number): Promise<WindowGlassState>;
  state(): Promise<WindowGlassState>;
  readDesktopColors(): string | null;
  clearDesktopColors(): void;
  addListener(
    event: "onDesktopColorsChange",
    listener: (event: { readonly colors: string }) => void,
  ): { remove(): void };
}

const NativeWindowGlass = requireOptionalNativeModule<T3WindowGlassModule>("T3WindowGlass");
const UNAVAILABLE: WindowGlassState = { blurSupported: false, showsWallpaper: false };

// Older dev clients lack the module; everything degrades to the opaque window.
export const isWindowGlassAvailable = NativeWindowGlass !== null;

export async function setWindowGlass(enabled: boolean, blurDp: number): Promise<WindowGlassState> {
  return NativeWindowGlass ? NativeWindowGlass.setGlass(enabled, blurDp) : UNAVAILABLE;
}

export async function readWindowGlassState(): Promise<WindowGlassState> {
  return NativeWindowGlass ? NativeWindowGlass.state() : UNAVAILABLE;
}

export function readDesktopColorsJson(): string | null {
  return NativeWindowGlass?.readDesktopColors() ?? null;
}

export function clearDesktopColors(): void {
  NativeWindowGlass?.clearDesktopColors();
}

export function subscribeDesktopColors(listener: (json: string) => void): () => void {
  const subscription = NativeWindowGlass?.addListener("onDesktopColorsChange", (event) =>
    listener(event.colors),
  );
  return () => subscription?.remove();
}
