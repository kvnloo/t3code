import { createContext, startTransition, use, useMemo, type ReactNode } from "react";
import { AppState, Appearance, Platform, useColorScheme } from "react-native";

import { manufacturer } from "expo-device";
import {
  resolveAndroidNavigationStyle,
  type AndroidNavigationStyle,
} from "../../../lib/androidNavigationStyle";

import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Atom, AsyncResult } from "effect/reactivity";

import { ScopedTheme, ScopedVariables, Uniwind } from "uniwind";

import {
  resolveAppearance,
  resolveAppearancePreferences,
  type ResolvedAppearance,
} from "../../../lib/appearancePreferences";
import { appAtomRegistry } from "../../../state/atom-registry";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../../state/preferences";
import type { Preferences } from "../../../persistence/mobile-preferences";
import {
  isSystemColorsAvailable,
  readSystemColorPalettes,
  type MaterialYouPalettes,
} from "../../../lib/materialYouPalette";
import { materialYouPaletteToMobileThemeVariables } from "../../../lib/materialYouTheme";
import { desktopColorsToPalettes, parseDesktopColors } from "../../../lib/desktopColors";
import {
  applyWindowGlass,
  normalizeWindowGlassMode,
  resolveWindowGlassPlan,
  type WindowGlassMode,
  type WindowGlassPlan,
} from "../../../lib/windowGlass";
import {
  isWindowGlassAvailable,
  readDesktopColorsJson,
  setWindowGlass as applyNativeWindowGlass,
  subscribeDesktopColors,
} from "../../../native/windowGlass";
import { getMobileThemeRuntimeVariables } from "../../../lib/mobileThemeVariables";
import type { MobileThemeVariables } from "../../../lib/mobileTheme";
import {
  createMobileThemePairPatch,
  createMobileThemeSelectionPatch,
  normalizeMobileThemeMode,
  resolveMobileThemeIds,
  isMobilePaletteThemeId,
  type MobileThemeAppearance,
  type MobileThemeId,
  type MobileThemeIds,
  type MobileThemeMode,
} from "../../../lib/mobileTheme";
import {
  createMobileThemeRuntimeOperations,
  getMobileUniwindThemeName,
  type MobileThemeRuntimeState,
} from "../../../lib/mobileThemeRuntime";

interface AppearancePreferencesContextValue {
  readonly appearance: ResolvedAppearance;
  readonly themeId: MobileThemeId;
  readonly themeIds: MobileThemeIds;
  readonly themeMode: MobileThemeMode;
  readonly androidNavigationStyle: AndroidNavigationStyle;
  readonly setAndroidNavigationStyle: (value: AndroidNavigationStyle) => void;
  readonly themeAppearance: MobileThemeAppearance;
  readonly systemColorsAvailable: boolean;
  readonly systemColorsActive: boolean;
  readonly themeVariables: MobileThemeVariables;
  readonly themeVariablesByAppearance: Readonly<
    Record<MobileThemeAppearance, MobileThemeVariables>
  >;
  readonly systemColorPalettes: ReturnType<typeof readSystemColorPalettes>;
  /** Palette pushed from the desktop's dotfiles; null until one arrives. */
  readonly desktopColorPalettes: MaterialYouPalettes | null;
  /** A runtime palette (Material You or Desktop) is painting the app. */
  readonly paletteThemeActive: boolean;
  readonly windowGlassAvailable: boolean;
  readonly windowGlass: WindowGlassMode;
  readonly windowGlassBlurSupported: boolean;
  readonly setWindowGlass: (value: WindowGlassMode) => void;
  readonly isReady: boolean;
  readonly setThemeIdForAppearance: (
    appearance: MobileThemeAppearance,
    value: MobileThemeId,
  ) => void;
  readonly setThemeIdForBothAppearances: (value: MobileThemeId) => void;
  readonly setThemeMode: (value: MobileThemeMode) => void;
  readonly setBaseFontSize: (value: number) => void;
  readonly setTerminalFontSize: (value: number | null) => void;
  readonly setCodeFontSize: (value: number | null) => void;
  readonly setCodeWordBreak: (value: boolean) => void;
  readonly mathRenderingEnabled: boolean;
  readonly setMathRenderingEnabled: (value: boolean) => void;
}

const AppearancePreferencesContext = createContext<AppearancePreferencesContextValue | null>(null);

function storedPreferencesOf<E>(result: AsyncResult.AsyncResult<Preferences, E>) {
  return AsyncResult.isSuccess(result) ? result.value : null;
}

/**
 * Material You palettes follow the system wallpaper, which can change while the
 * app is in the background.
 */
const systemColorPalettesAtom = Atom.make((get): MaterialYouPalettes | null => {
  const initial = readSystemColorPalettes();
  if (!isSystemColorsAvailable) return initial;
  let current = initial;
  const refresh = () => {
    const next = readSystemColorPalettes();
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    current = next;
    get.setSelf(next);
  };
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") refresh();
  });
  const focusSubscription = AppState.addEventListener("focus", refresh);
  get.addFinalizer(() => {
    subscription.remove();
    focusSubscription.remove();
  });
  return initial;
}).pipe(Atom.withLabel("mobile:system-color-palettes"));

/** Desktop colors arrive by broadcast from the computer and persist natively across restarts. */
const desktopColorPalettesAtom = Atom.make((get): MaterialYouPalettes | null => {
  const read = (json: string | null) => {
    if (!json) return null;
    try {
      return desktopColorsToPalettes(parseDesktopColors(JSON.parse(json)));
    } catch {
      return null;
    }
  };
  const unsubscribe = subscribeDesktopColors((json) => get.setSelf(read(json)));
  get.addFinalizer(unsubscribe);
  return read(readDesktopColorsJson());
}).pipe(Atom.withLabel("mobile:desktop-color-palettes"));

/** Whether the window can blur the wallpaper; known after the first native apply. */
const windowGlassBlurSupportedAtom = Atom.make(false).pipe(
  Atom.withLabel("mobile:window-glass-blur-supported"),
);

const windowGlassModeAtom = Atom.make((get) =>
  isWindowGlassAvailable
    ? normalizeWindowGlassMode(storedPreferencesOf(get(mobilePreferencesAtom))?.windowGlass)
    : "off",
);

function resolveThemeVariablesByAppearance(
  themeIds: MobileThemeIds,
  palettes: Readonly<Record<"material-you" | "desktop", MaterialYouPalettes | null>>,
  glass: WindowGlassPlan | null,
): Readonly<Record<MobileThemeAppearance, MobileThemeVariables>> {
  const resolve = (appearance: MobileThemeAppearance) => {
    const themeId = themeIds[appearance];
    const base = getMobileThemeRuntimeVariables(themeId, appearance, Platform.OS);
    const palette = isMobilePaletteThemeId(themeId) ? palettes[themeId] : null;
    const variables = palette
      ? materialYouPaletteToMobileThemeVariables(palette[appearance], appearance, base)
      : base;
    return applyWindowGlass(variables, glass);
  };
  return { light: resolve("light"), dark: resolve("dark") };
}

/** The appearance whose theme is on screen, read from the native scheme. */
export function resolveThemeAppearance(stored: Preferences | null): MobileThemeAppearance {
  const themeMode = normalizeMobileThemeMode(stored?.themeMode);
  if (themeMode !== "system") return themeMode;
  return Appearance.getColorScheme() === "dark" ? "dark" : "light";
}

function runtimeStateFor(stored: Preferences | null): MobileThemeRuntimeState {
  return {
    baseFontSize: resolveAppearancePreferences(stored).baseFontSize,
    themeMode: normalizeMobileThemeMode(stored?.themeMode),
    themeAppearance: resolveThemeAppearance(stored),
  };
}

const themeRuntimeStateAtom = Atom.make((get) =>
  runtimeStateFor(storedPreferencesOf(get(mobilePreferencesAtom))),
).pipe(
  Atom.withEquality(
    (left: MobileThemeRuntimeState, right: MobileThemeRuntimeState) =>
      left.baseFontSize === right.baseFontSize &&
      left.themeMode === right.themeMode &&
      left.themeAppearance === right.themeAppearance,
  ),
);

// Native appearance and Uniwind text variables are process-global, so the
// last applied state is too. Setters apply ahead of the preference write so the
// first frame after a change already uses it; the atom subscription then sees
// no difference.
let appliedRuntimeState: MobileThemeRuntimeState | null = null;

function applyThemeRuntime(next: MobileThemeRuntimeState) {
  for (const operation of createMobileThemeRuntimeOperations(appliedRuntimeState, next)) {
    if (operation.kind === "update-text-variables") {
      Uniwind.updateCSSVariables(operation.themeName, operation.variables);
      continue;
    }
    if (operation.kind === "set-appearance-mode") {
      Appearance.setColorScheme(
        operation.themeMode === "system" ? "unspecified" : operation.appearance,
      );
    }
  }
  appliedRuntimeState = next;
}

function currentRuntimeState() {
  return appliedRuntimeState ?? appAtomRegistry.get(themeRuntimeStateAtom);
}

let windowGlassRequest = 0;

// The blur radius depends on what the device supports, which only the native side knows, so the
// first apply asks for blur and later applies reuse the answer.
function applyWindowGlassMode(mode: WindowGlassMode) {
  const request = ++windowGlassRequest;
  const plan = resolveWindowGlassPlan(mode, true);
  void applyNativeWindowGlass(plan !== null, plan?.blurDp ?? 0).then((state) => {
    if (request !== windowGlassRequest) return;
    appAtomRegistry.set(windowGlassBlurSupportedAtom, state.blurSupported);
  });
}

/**
 * App-lifetime: applies theme preferences to the native runtime and holds the
 * system palette listeners. Holding them here instead of `keepAlive` lets the
 * fast-refresh disposer release the replaced module's AppState listeners.
 */
export function installAppearanceRuntime(): () => void {
  const unsubscribeRuntime = appAtomRegistry.subscribe(themeRuntimeStateAtom, applyThemeRuntime, {
    immediate: true,
  });
  const releasePalettes = appAtomRegistry.mount(systemColorPalettesAtom);
  const releaseDesktopPalettes = appAtomRegistry.mount(desktopColorPalettesAtom);
  const unsubscribeGlass = isWindowGlassAvailable
    ? appAtomRegistry.subscribe(windowGlassModeAtom, applyWindowGlassMode, { immediate: true })
    : () => {};
  return () => {
    unsubscribeRuntime();
    releasePalettes();
    releaseDesktopPalettes();
    unsubscribeGlass();
  };
}

export function AppearancePreferencesProvider(props: { readonly children: ReactNode }) {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const systemColorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const storedPreferences = AsyncResult.isSuccess(preferencesResult)
    ? preferencesResult.value
    : null;
  const preferences = useMemo(
    () => resolveAppearancePreferences(storedPreferences),
    [storedPreferences],
  );
  const androidNavigationStyle = resolveAndroidNavigationStyle(
    storedPreferences?.androidNavigationStyle,
    manufacturer,
    process.env.EXPO_PUBLIC_T3_FLOATING_TABS === "1",
  );
  const themeMode = normalizeMobileThemeMode(storedPreferences?.themeMode);
  const themeAppearance = themeMode === "system" ? systemColorScheme : themeMode;
  const resolvedThemeIds = resolveMobileThemeIds(storedPreferences ?? {});
  const themeIds = useMemo<MobileThemeIds>(
    () => ({ light: resolvedThemeIds.light, dark: resolvedThemeIds.dark }),
    [resolvedThemeIds.dark, resolvedThemeIds.light],
  );
  const themeId = themeIds[themeAppearance];
  const systemColorsActive = themeId === "material-you" && isSystemColorsAvailable;
  const systemColorPalettes = useAtomValue(systemColorPalettesAtom);
  const desktopColorPalettes = useAtomValue(desktopColorPalettesAtom);
  const paletteThemeActive =
    systemColorsActive || (themeId === "desktop" && desktopColorPalettes !== null);
  const windowGlass = useAtomValue(windowGlassModeAtom);
  const windowGlassBlurSupported = useAtomValue(windowGlassBlurSupportedAtom);
  const windowGlassPlan = resolveWindowGlassPlan(windowGlass, windowGlassBlurSupported);
  const themeVariablesByAppearance = resolveThemeVariablesByAppearance(
    themeIds,
    { "material-you": systemColorPalettes, desktop: desktopColorPalettes },
    windowGlassPlan,
  );
  const themeVariables = themeVariablesByAppearance[themeAppearance];
  const activeThemeName = getMobileUniwindThemeName(themeId, themeAppearance);
  const { baseFontSize, codeFontSize, codeWordBreak, terminalFontSize } = preferences;
  const appearance = useMemo(
    () => resolveAppearance({ baseFontSize, codeFontSize, codeWordBreak, terminalFontSize }),
    [baseFontSize, codeFontSize, codeWordBreak, terminalFontSize],
  );
  const isReady = AsyncResult.isSuccess(preferencesResult);
  const updatePreferences = (patch: Partial<Preferences>) => {
    startTransition(() => savePreferences(patch));
  };

  const updateThemePreferences = (patch: Partial<Preferences>) => {
    savePreferences(patch);
  };

  const setThemeIdForAppearance = (appearance: MobileThemeAppearance, value: MobileThemeId) => {
    // Read at call time: a second pick before the next render must build on
    // the first one's optimistic write.
    const selected = resolveMobileThemeIds(
      storedPreferencesOf(appAtomRegistry.get(mobilePreferencesAtom)) ?? {},
    );
    updateThemePreferences(
      createMobileThemeSelectionPatch(selected, themeAppearance, appearance, value),
    );
  };

  const setThemeIdForBothAppearances = (value: MobileThemeId) => {
    updateThemePreferences(createMobileThemePairPatch(value));
  };

  const setThemeMode = (value: MobileThemeMode) => {
    const current = currentRuntimeState();

    // Clear forced appearance before publishing System so useColorScheme batches the system palette into the preference commit.
    if (value === "system") {
      Appearance.setColorScheme("unspecified");
    }
    const nextAppearance =
      value === "system" ? (Appearance.getColorScheme() === "dark" ? "dark" : "light") : value;
    const next = {
      ...current,
      themeAppearance: nextAppearance,
      themeMode: value,
    };

    if (value === "system") {
      appliedRuntimeState = next;
    } else {
      applyThemeRuntime(next);
    }
    updateThemePreferences({ themeMode: value });
  };

  const setAndroidNavigationStyle = (value: AndroidNavigationStyle) =>
    updatePreferences({ androidNavigationStyle: value });

  const setBaseFontSize = (value: number) => {
    applyThemeRuntime({ ...currentRuntimeState(), baseFontSize: value });
    updatePreferences({ baseFontSize: value });
  };

  const setTerminalFontSize = (value: number | null) => {
    updatePreferences({ terminalFontSize: value });
  };

  const setCodeFontSize = (value: number | null) => {
    updatePreferences({ codeFontSize: value });
  };

  const setCodeWordBreak = (value: boolean) => {
    updatePreferences({ codeWordBreak: value });
  };

  const setWindowGlass = (value: WindowGlassMode) => updateThemePreferences({ windowGlass: value });

  const mathRenderingEnabled = storedPreferences?.mathRenderingEnabled === true;
  const setMathRenderingEnabled = (value: boolean) =>
    updatePreferences({ mathRenderingEnabled: value });

  const value = useMemo(
    (): AppearancePreferencesContextValue => ({
      appearance,
      themeId,
      themeIds,
      themeMode,
      androidNavigationStyle,
      setAndroidNavigationStyle,
      themeAppearance,
      systemColorsAvailable: isSystemColorsAvailable,
      systemColorsActive,
      themeVariables,
      themeVariablesByAppearance,
      systemColorPalettes,
      desktopColorPalettes,
      paletteThemeActive,
      windowGlassAvailable: isWindowGlassAvailable,
      windowGlass,
      windowGlassBlurSupported,
      setWindowGlass,
      isReady,
      setThemeIdForAppearance,
      setThemeIdForBothAppearances,
      setThemeMode,
      setBaseFontSize,
      setTerminalFontSize,
      setCodeFontSize,
      setCodeWordBreak,
      mathRenderingEnabled,
      setMathRenderingEnabled,
    }),
    [
      appearance,
      themeId,
      themeIds,
      themeMode,
      androidNavigationStyle,
      setAndroidNavigationStyle,
      themeAppearance,
      systemColorsActive,
      themeVariables,
      themeVariablesByAppearance,
      systemColorPalettes,
      desktopColorPalettes,
      paletteThemeActive,
      windowGlass,
      windowGlassBlurSupported,
      setWindowGlass,
      isReady,
      setThemeIdForAppearance,
      setThemeIdForBothAppearances,
      setThemeMode,
      setBaseFontSize,
      setTerminalFontSize,
      setCodeFontSize,
      setCodeWordBreak,
      mathRenderingEnabled,
      setMathRenderingEnabled,
    ],
  );

  return (
    <AppearancePreferencesContext.Provider value={value}>
      <ScopedTheme theme={activeThemeName}>
        <ScopedVariables variables={themeVariables}>{props.children}</ScopedVariables>
      </ScopedTheme>
    </AppearancePreferencesContext.Provider>
  );
}

export function useAppearancePreferences(): AppearancePreferencesContextValue {
  const context = use(AppearancePreferencesContext);
  if (!context) {
    throw new Error("useAppearancePreferences must be used within AppearancePreferencesProvider");
  }
  return context;
}

export function useAndroidFloatingTabs() {
  const { androidNavigationStyle } = useAppearancePreferences();
  return Platform.OS === "android" && androidNavigationStyle === "one-ui";
}
