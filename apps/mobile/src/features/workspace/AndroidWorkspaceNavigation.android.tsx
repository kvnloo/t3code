import { selectedNavigationTab, visibleNavigationTabs } from "./navigation-tab-order";
import { useRef } from "react";
import { requireNativeView } from "expo";
import { CommonActions, useNavigation } from "@react-navigation/native";
import {
  Keyboard,
  Pressable,
  processColor,
  useWindowDimensions,
  View,
  type NativeSyntheticEvent,
  type TextInputInstance,
  type ViewProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { SearchField } from "../../components/ui/SearchField";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useHardwareBack } from "../../lib/backHandler";
import { resolveBottomSearchMode } from "./bottom-search-prototype-state";
import { useToolbarLayout } from "../../components/ui/useToolbarLayout";
import { rootNavigationRef } from "../../lib/rootNavigation";
import { useWorkspaceConnectionState } from "../../state/workspace";
import { androidWorkspaceNavigationColors } from "./android-workspace-navigation-colors";
import {
  androidWorkspaceTabNavigationState,
  type AndroidWorkspaceNavigationTab,
} from "./android-workspace-tabs";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { useSoftKeyboardShowing } from "../keyboard/useSoftKeyboardShowing";
import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";
import { useAndroidWorkspaceRoot } from "./AndroidWorkspaceTabsProvider";
import { useNavigationTabOrder, useHiddenNavigationTabs } from "./navigation-tabs";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import { FLOATING_TABS, floatingTabsMetrics } from "./floating-workspace-tabs";

// Matches RAIL_WIDTH in the native rail.
export const ANDROID_WORKSPACE_RAIL_WIDTH = 72;

interface NativeNavigationProps extends ViewProps {
  readonly rail: boolean;
  readonly floating: boolean;
  readonly tabs: readonly string[];
  readonly selectedTab: AndroidWorkspaceNavigationTab;
  readonly dark: boolean;
  readonly textScale: number;
  readonly newEnabled: boolean;
  readonly safeAreaTop: number;
  readonly safeAreaBottom: number;
  readonly headerHeight: number;
  readonly containerColor: number;
  readonly selectedColor: number;
  readonly indicatorColor: number;
  readonly unselectedColor: number;
  readonly actionColor: number;
  readonly actionContentColor: number;
  readonly onTabSelected: (
    event: NativeSyntheticEvent<{ readonly tab: AndroidWorkspaceNavigationTab }>,
  ) => void;
  readonly onNewThread: () => void;
  readonly onOverlayChange: (event: NativeSyntheticEvent<{ readonly overlay: boolean }>) => void;
}

const NativeNavigation = requireNativeView<NativeNavigationProps>("T3WorkspaceNavigation");

function nativeColor(value: string) {
  const color = processColor(value);
  return typeof color === "number" ? color : 0;
}

export function AndroidWorkspaceNavigation(props: {
  readonly onNewThread: () => void;
  readonly rail?: boolean;
  readonly floating?: boolean;
  readonly fillWidth?: boolean;
  readonly paneWidth?: number;
  readonly onSelect?: () => void;
  /** The rail needs the whole workspace while it widens over the list. */
  readonly onOverlayChange?: (overlay: boolean) => void;
}) {
  const workspace = useWorkspaceTabs()!;
  const bottomSearch = workspace.bottomSearch;
  const searchInputRef = useRef<TextInputInstance>(null);
  const order = useNavigationTabOrder();
  const hidden = useHiddenNavigationTabs();
  const root = useAndroidWorkspaceRoot();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const toolbar = useToolbarLayout();
  const connectionState = useWorkspaceConnectionState();
  const keyboardVisible = useSoftKeyboardShowing();
  const {
    layout,
    keyboardHoldsSidebar,
    primarySidebarSearchQuery,
    setPrimarySidebarSearchQuery,
  } = useAdaptiveWorkspaceLayout();
  const { themeAppearance, themeVariables: colors } = useAppearancePreferences();
  const { scale, fabSize } = useAndroidControlSizing();
  const window = useWindowDimensions();
  const rail = Boolean(props.rail);
  const floating = !rail && Boolean(props.floating);
  const tabs = [...visibleNavigationTabs(order, hidden, rail ? 5 : 4), "settings"];
  const { containerColor, indicatorColor, selectedColor, unselectedColor } =
    androidWorkspaceNavigationColors(colors, rail, floating);
  const selectedTab = selectedNavigationTab(
    order,
    workspace.state.selectedTab,
    root?.settingsOpen ?? false,
    hidden,
    rail ? 5 : 4,
  );
  const searchMode = resolveBottomSearchMode({
    enabled: bottomSearch?.enabled === true,
    active: !rail && workspace.state.selectedTab === "threads" && root?.settingsOpen !== true,
    expanded: bottomSearch?.expanded === true,
  });
  const showSearchPill = searchMode === "pill";
  const showSearchField = searchMode === "field";
  useHardwareBack(showSearchField, () => {
    bottomSearch?.close();
    Keyboard.dismiss();
    return true;
  });
  // FloatingWorkspaceTabs starts the bar at the left inset, so a cutout narrows the room.
  const barWidth =
    (props.paneWidth ?? window.width) -
    (Math.max(insets.left, FLOATING_TABS.edge) - FLOATING_TABS.edge);
  const metrics = floatingTabsMetrics(tabs.length, scale, fabSize, barWidth, props.fillWidth);
  // The composer's keyboard slides the sidebar away with the bar on it; other keyboards don't.
  if (!rail && keyboardVisible && !keyboardHoldsSidebar && !showSearchField) return null;

  return (
    <View
      style={
        // The rail draws its own surface and pads the system bars; while open it spans the
        // workspace, so the rest of it must stay transparent.
        rail
          ? { flex: 1 }
          : floating
            ? showSearchField
              ? {
                  width:
                    (props.paneWidth ?? window.width) -
                    Math.max(insets.left, FLOATING_TABS.edge) -
                    Math.max(insets.right, FLOATING_TABS.edge),
                }
              : showSearchPill
                ? { flexDirection: "row", alignItems: "center" }
                : undefined
            : {
                backgroundColor: containerColor,
                paddingBottom: insets.bottom,
                ...(showSearchPill ? { flexDirection: "row", alignItems: "center" } : {}),
              }
      }
    >
      {showSearchField ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: floating ? 0 : 12,
            height: floating
              ? metrics.height + 2 * FLOATING_TABS.shadow
              : 80 * Math.max(1, scale),
          }}
        >
          <SearchField
            inputRef={searchInputRef}
            accessibilityLabel="Search threads"
            clearAccessibilityLabel="Clear search"
            placeholder="Search threads"
            value={primarySidebarSearchQuery}
            onChangeText={setPrimarySidebarSearchQuery}
            onBlur={() => bottomSearch?.blur(primarySidebarSearchQuery)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close bottom search"
            hitSlop={8}
            onPress={() => {
              bottomSearch?.close();
              Keyboard.dismiss();
            }}
            style={{ padding: 8 }}
          >
            <SymbolView name="xmark" size={20} tintColorClassName="accent-icon" />
          </Pressable>
        </View>
      ) : (
        <>
          {showSearchPill ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search threads"
              onPress={() => bottomSearch?.open()}
              className="items-center justify-center rounded-full bg-subtle-strong"
              style={{ width: 48, height: floating ? metrics.height : 48 }}
            >
              <SymbolView name="magnifyingglass" size={21} tintColorClassName="accent-icon" />
            </Pressable>
          ) : null}
            <NativeNavigation
              rail={rail}
              floating={floating}
              tabs={tabs}
              selectedTab={selectedTab}
              dark={themeAppearance === "dark"}
              textScale={scale}
              newEnabled={connectionState.hasConnections}
              safeAreaTop={toolbar.paddingTop}
              safeAreaBottom={insets.bottom}
              headerHeight={toolbar.height}
              containerColor={nativeColor(containerColor)}
              selectedColor={nativeColor(selectedColor)}
              indicatorColor={nativeColor(indicatorColor)}
              unselectedColor={nativeColor(unselectedColor)}
              actionColor={nativeColor(colors["--color-primary"])}
              actionContentColor={nativeColor(colors["--color-primary-foreground"])}
              onTabSelected={(event) => {
                Keyboard.dismiss();
                const tab = event.nativeEvent.tab;
                if (tab !== "settings") workspace.dispatch({ type: "select", tab });
                // Reset the root stack even when a nested settings navigator has focus.
                // The provider renders inside the root stack's layout, so the container's root state is
                // that stack's current state.
                const rootState = rootNavigationRef.getRootState();
                if (root && rootState) {
                  navigation.dispatch({
                    ...CommonActions.reset(
                      androidWorkspaceTabNavigationState(rootState, tab, layout.usesSplitView),
                    ),
                    target: root.key,
                  });
                }
                props.onSelect?.();
              }}
              onNewThread={() => {
                Keyboard.dismiss();
                props.onNewThread();
              }}
              onOverlayChange={(event) => props.onOverlayChange?.(event.nativeEvent.overlay)}
              style={
                rail
                  ? { flex: 1 }
                  : floating
                    ? {
                        width: metrics.pill + 2 * FLOATING_TABS.shadow - (showSearchPill ? 48 : 0),
                        height: metrics.height + 2 * FLOATING_TABS.shadow,
                      }
                    : { height: 80 * Math.max(1, scale), ...(showSearchPill ? { flex: 1 } : {}) }
              }
            />
        </>
      )}
    </View>
  );
}

export function FloatingWorkspaceTabs(props: {
  readonly fillWidth?: boolean;
  readonly onNewThread: () => void;
  readonly paneWidth?: number;
  readonly onSelect?: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: Math.max(insets.left, FLOATING_TABS.edge) - FLOATING_TABS.shadow,
        right: 0,
        bottom: insets.bottom + FLOATING_TABS.bottom - FLOATING_TABS.shadow,
        alignItems: "flex-start",
      }}
    >
      <AndroidWorkspaceNavigation {...props} floating />
    </View>
  );
}
