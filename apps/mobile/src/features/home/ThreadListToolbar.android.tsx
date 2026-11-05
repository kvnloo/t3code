import { useNavigation, useNavigationState } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { BackHandler, Keyboard } from "react-native";

import { AppBar } from "../../components/ui/AppBar";
import { appBarMenuItemsFromActions } from "../../components/ui/menuActionItems";
import { useWorkspaceConnectionState } from "../../state/workspace";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";
import { WorkspaceBrandTitle } from "../workspace/WorkspaceBrandTitle";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import type { ThreadListToolbarProps } from "./ThreadListToolbar.types";
import { useBottomSearchPrototypeB } from "./useBottomSearchPrototypeB";

export function ThreadListToolbar(props: ThreadListToolbarProps) {
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs();
  const { layout } = useAdaptiveWorkspaceLayout();
  const bottomSearch = useBottomSearchPrototypeB() && !layout.usesSplitView;
  const isTabActive = workspace?.isTabActive;
  const homeFocused = useNavigationState((state) => state.routes[state.index]?.name === "Home");
  const listFocused =
    homeFocused && (workspace === null || workspace.state.selectedTab === "threads");
  const connectionState = useWorkspaceConnectionState();
  const { onRequestVisibility, onSearchQueryChange } = props;
  const [searchOpen, setSearchOpen] = useState(false);
  const searching = !bottomSearch && (searchOpen || props.searchQuery.length > 0);
  const openSearch = () => {
    if (bottomSearch) return false;
    onRequestVisibility?.();
    setSearchOpen(true);
    return true;
  };
  useHardwareKeyboardCommand("focusSearch", openSearch);

  const closeSearch = () => {
    onSearchQueryChange("");
    setSearchOpen(false);
    Keyboard.dismiss();
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to BackHandler while searching to close search on Android back
  useEffect(() => {
    if (!searching || !listFocused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      // Frozen Home screens can keep effects alive after a detail route opens.
      const state = navigation.getState();
      if (
        !state ||
        state.routes[state.index]?.name !== "Home" ||
        isTabActive?.("threads") === false
      )
        return false;
      if (Keyboard.isVisible()) Keyboard.dismiss();
      else closeSearch();
      return true;
    });
    return () => subscription.remove();
  }, [closeSearch, searching, listFocused, navigation, isTabActive]);

  return (
    <AppBar
      title="T3 Code"
      titleContent={
        <WorkspaceBrandTitle
          accessibilityLabel="T3 Code, Threads"
          onOpenEnvironments={props.onOpenEnvironments}
        />
      }
      search={
        bottomSearch
          ? undefined
          : {
              value: props.searchQuery,
              onChangeText: onSearchQueryChange,
              placeholder: "Search",
              accessibilityLabel: "Search threads",
              active: searching,
              onOpen: openSearch,
              onClose: closeSearch,
            }
      }
      menus={
        connectionState.hasConnections
          ? [
              {
                title: "Filter threads",
                icon: props.filterCustomized
                  ? "line.3.horizontal.decrease.circle.fill"
                  : "line.3.horizontal.decrease.circle",
                items: appBarMenuItemsFromActions(props.filterActions, props.onFilterSelect),
              },
            ]
          : undefined
      }
    />
  );
}
