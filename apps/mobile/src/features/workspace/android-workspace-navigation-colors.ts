import {
  flattenThemeColor,
  isDarkThemeColor,
  themeColorContrastRatio,
  themeColorWithAlpha,
  themeColorWithContrast,
  type MobileThemeVariables,
} from "../../lib/mobileTheme";
import { TEXT_CONTRAST_MINIMUM } from "../../lib/themeContrastAudit";
import { colorWithAlphaHex } from "../../lib/windowGlass";

/** A see-through window: the floating pill becomes a glass pane like the cards. */
export interface AndroidNavigationGlass {
  /** Pane opacity from the window-glass plan (`WindowGlassPlan.pane`). */
  readonly pane: number;
  /** The tint painted over the wallpaper at the root (`windowGlassRootColor`). */
  readonly rootColor: string;
}

// A dark page swallows the native shadow, so the fill alone has to lift the pill off the page
// and off the cards it floats over.
function floatingContainerColor(colors: MobileThemeVariables) {
  const screen = colors["--color-screen"];
  const fill = flattenThemeColor(colors["--color-secondary"], screen);
  if (!isDarkThemeColor(screen)) return fill;
  return themeColorWithContrast(
    fill,
    [screen, flattenThemeColor(colors["--color-grouped-card"], screen)],
    1.25,
  );
}

// What the pill can end up over on glass, as the contrast audit sees it: the root tint over
// black or white wallpaper, bare or under a pane card.
function glassBackdrops(colors: MobileThemeVariables, glass: AndroidNavigationGlass) {
  return ["#000000", "#ffffff"].flatMap((wallpaper) => {
    const tinted = flattenThemeColor(glass.rootColor, wallpaper);
    return [tinted, flattenThemeColor(colors["--color-grouped-card"], tinted)];
  });
}

/**
 * Content scrolls under the floating pill. A real window blur only softens the wallpaper, never
 * the app's own rows, so at the bare pane alpha a label passing under the pill stays sharp and
 * lands on top of the pill's icons. Text behind the pill may reach at most this contrast against
 * the pill around it: faint enough that it no longer reads as a second layer of labels.
 */
export const GLASS_PILL_CONTENT_GHOST_MAX = 1.25;

// The strongest content colors a row can paint under the pill.
const CONTENT_ROLES = ["--color-foreground", "--color-primary"] as const;

/** Worst contrast of content text against the pill around it, seen through a pill of `alpha`. */
export function glassPillContentGhost(
  colors: MobileThemeVariables,
  glass: AndroidNavigationGlass,
  alpha: number,
): number {
  const fill = colorWithAlphaHex(colors["--color-secondary"], alpha);
  return Math.max(
    ...glassBackdrops(colors, glass).flatMap((backdrop) => {
      const around = flattenThemeColor(fill, backdrop);
      return CONTENT_ROLES.filter((role) => colors[role]).map((role) =>
        themeColorContrastRatio(
          flattenThemeColor(fill, flattenThemeColor(colors[role], backdrop)),
          around,
        ),
      );
    }),
  );
}

/**
 * The pill's opacity: the pane alpha when that already hides content, otherwise the least alpha
 * (to 0.01) that does. The wallpaper still tints through whatever is left.
 */
export function glassPillAlpha(colors: MobileThemeVariables, glass: AndroidNavigationGlass) {
  const hides = (alpha: number) =>
    glassPillContentGhost(colors, glass, alpha) <= GLASS_PILL_CONTENT_GHOST_MAX;
  if (hides(glass.pane)) return glass.pane;
  let low = glass.pane;
  let high = 1;
  for (let step = 0; step < 16; step += 1) {
    const middle = (low + high) / 2;
    if (hides(middle)) high = middle;
    else low = middle;
  }
  return Math.min(1, Math.ceil(high * 100) / 100);
}

// The pill is a glass pane, thick enough that rows scrolling under it don't read through it.
// Colors on it are checked against every opaque color it can composite to.
function glassFloatingColors(colors: MobileThemeVariables, glass: AndroidNavigationGlass) {
  const containerColor = colorWithAlphaHex(colors["--color-secondary"], glassPillAlpha(colors, glass));
  const pills = glassBackdrops(colors, glass).map((backdrop) =>
    flattenThemeColor(containerColor, backdrop),
  );
  const indicatorColor = themeColorWithContrast(
    flattenThemeColor(colors["--color-secondary"], pills[0]!),
    pills,
    1.5,
  );
  const foreground = colors["--color-secondary-foreground"];
  return {
    containerColor,
    indicatorColor,
    selectedColor: themeColorWithContrast(
      flattenThemeColor(foreground, indicatorColor),
      indicatorColor,
      TEXT_CONTRAST_MINIMUM,
    ),
    unselectedColor: themeColorWithContrast(
      flattenThemeColor(foreground, pills[0]!),
      pills,
      TEXT_CONTRAST_MINIMUM,
    ),
  };
}

export function androidWorkspaceNavigationColors(
  colors: MobileThemeVariables,
  rail: boolean,
  floating = false,
  glass?: AndroidNavigationGlass,
) {
  if (floating && !rail && glass) return glassFloatingColors(colors, glass);
  const screen = colors["--color-screen"];
  const header = flattenThemeColor(colors["--color-header"], screen);
  const containerColor = rail
    ? header
    : floating
      ? floatingContainerColor(colors)
      : flattenThemeColor(themeColorWithAlpha(colors["--color-header-foreground"], 0.05), header);
  // The lifted dark pill already took the secondary fill's place, so its indicator lifts further.
  const indicatorColor = themeColorWithContrast(
    floating && isDarkThemeColor(screen)
      ? containerColor
      : flattenThemeColor(colors["--color-secondary"], containerColor),
    containerColor,
    1.5,
  );
  return {
    containerColor,
    indicatorColor,
    selectedColor: themeColorWithContrast(
      flattenThemeColor(colors["--color-secondary-foreground"], indicatorColor),
      [indicatorColor, containerColor],
    ),
    unselectedColor: floating
      ? themeColorWithContrast(
          flattenThemeColor(colors["--color-secondary-foreground"], containerColor),
          containerColor,
        )
      : flattenThemeColor(colors["--color-header-foreground"], containerColor),
  };
}
