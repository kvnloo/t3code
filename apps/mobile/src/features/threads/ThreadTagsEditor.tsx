import { useNavigation } from "@react-navigation/native";
import { openSettings } from "../settings/settings-navigation";
import { useAtomValue } from "@effect/atom-react";
import {
  AuthSettingsWriteScope,
  THREAD_TAG_COLORS,
  THREAD_TAG_ICONS,
  isManagedSettingPath,
  type EnvironmentId,
  type ThreadTagColor,
  type ThreadTagIcon,
  type ThreadTagStyle,
} from "@t3tools/contracts";
import { moveTagStyle, saveTagStyle, tagNameError } from "@t3tools/client-runtime/state/thread-tag-badges";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SymbolView } from "../../components/ui/AppSymbol";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { useEnvironments } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { THREAD_TAG_SYMBOLS, THREAD_TAG_TINTS } from "./thread-tag-badges";

/** One environment owns both the styles and every assignment key in this editor. */
export function ThreadTagsEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly initialTag?: string;
  readonly onBeforeManage?: () => void;
  readonly tags?: ReadonlyArray<{ readonly tag: string; readonly name: string; readonly checked: boolean }>;
  readonly onToggle?: (tag: string) => void;
}) {
  const navigation = useNavigation();
  const styles = useAtomValue(serverEnvironment.threadTagStylesAtom(props.environmentId));
  const writable = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const { environments } = useEnvironments();
  const environment = environments.find((entry) => entry.environmentId === props.environmentId);
  const managed = isManagedSettingPath(environment?.serverConfig?.managedPolicy, "threadTagStyles");
  const [selection, setSelection] = useState<{ readonly original: ThreadTagStyle | null } | null>(() => props.initialTag ? { original: styles.find((style) => style.tag === props.initialTag) ?? { tag: props.initialTag } } : null);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const disabled = !writable || managed || pending;
  const persist = async (next: ReadonlyArray<ThreadTagStyle>) => {
    if (inFlight.current || managed || !readEnvironmentScope(props.environmentId, AuthSettingsWriteScope)) return false;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await update({ environmentId: props.environmentId, input: { patch: { threadTagStyles: next } } });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) setError("Could not save tags. Your draft is still open; try again.");
        return false;
      }
      return true;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  const rows = (props.tags ?? styles.map((style) => ({ tag: style.tag, name: style.displayName ?? style.tag, checked: false }))).map((entry) => ({ ...entry, name: styles.find((style) => style.tag === entry.tag)?.displayName ?? entry.name }));
  return (
    <View className="gap-3">
      <TextInput accessibilityLabel="Search tags" placeholder="Search tags" value={search} onChangeText={setSearch} className="min-h-12 rounded-xl bg-subtle px-3 text-foreground" />
      {rows.filter((entry) => entry.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((entry) => {
        const style = styles.find((item) => item.tag === entry.tag);
        return (
          <View key={entry.tag} className="flex-row items-center gap-2">
            <Pressable accessibilityRole="button" accessibilityLabel={props.onToggle ? `${entry.checked ? "Remove" : "Apply"} ${entry.name}` : `Edit ${entry.name}`} accessibilityState={{ selected: entry.checked }} disabled={!props.onToggle && disabled} className="min-h-12 flex-1 flex-row items-center gap-2 rounded-xl bg-subtle px-3" onPress={() => props.onToggle ? props.onToggle(entry.tag) : setSelection({ original: style ?? { tag: entry.tag } })}>
              {style?.icon ? <SymbolView name={THREAD_TAG_SYMBOLS[style.icon]} size={18} tintColor={THREAD_TAG_TINTS[style.color ?? "gray"]} /> : null}
              <Text className="flex-1 text-foreground">{entry.name}</Text>
              {props.onToggle && entry.checked ? <Text>✓</Text> : null}
            </Pressable>
            <Button label="Edit" accessibilityLabel={`Edit ${entry.name} appearance`} icon="square.and.pencil" disabled={disabled} tone="secondary" onPress={() => setSelection({ original: style ?? { tag: entry.tag } })} />
          </View>
        );
      })}
      <Button label="Add tag" icon="plus" disabled={disabled} tone="secondary" onPress={() => setSelection({ original: null })} />
      {props.onToggle ? <Button label="Manage tags in Settings" tone="secondary" disabled={pending} onPress={() => { props.onBeforeManage?.(); openSettings(navigation, "SettingsThreadTags", { environmentId: props.environmentId }); }} /> : null}
      {!writable || managed ? <Text className="text-foreground-muted">Tag styles are read-only in this environment.</Text> : null}
      {error ? <Text accessibilityRole="alert" className="text-foreground">{error}</Text> : null}
      {selection ? (
        <Modal transparent animationType="fade" onRequestClose={() => { if (!pending) setSelection(null); }}>
          <KeyboardAvoidingView className="flex-1 justify-center bg-backdrop px-5" behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <ScrollView keyboardShouldPersistTaps="handled" className="max-h-[85%] rounded-3xl bg-screen grow-0" contentContainerStyle={{ padding: 20, gap: 16 }}>
              {props.onToggle ? <Button label="Manage this tag in Settings" disabled={pending} onPress={() => { const tag = selection.original?.tag; setSelection(null); props.onBeforeManage?.(); openSettings(navigation, "SettingsThreadTags", { environmentId: props.environmentId, ...(tag ? { tag } : {}) }); }} /> : null}
              <TagStyleForm key={selection.original?.tag ?? "new"} original={selection.original} styles={styles} disabled={disabled} error={error} onCancel={() => setSelection(null)} onSave={async (next) => { if (await persist(next)) setSelection(null); }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>
      ) : null}
    </View>
  );
}

function TagStyleForm(props: {
  readonly original: ThreadTagStyle | null;
  readonly styles: ReadonlyArray<ThreadTagStyle>;
  readonly disabled: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onSave: (styles: ReadonlyArray<ThreadTagStyle>) => Promise<void>;
}) {
  const [name, setName] = useState(props.original?.displayName ?? props.original?.tag ?? "");
  const [color, setColor] = useState<ThreadTagColor>(props.original?.color ?? "gray");
  const [icon, setIcon] = useState<ThreadTagIcon | null>(props.original?.icon ?? null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const validation = tagNameError(name, props.styles, props.original?.tag ?? null);
  const originalTag = props.original?.tag;
  const index = props.styles.findIndex((style) => style.tag === originalTag);
  return (
    <View className="gap-4">
      <Text accessibilityRole="header" className="text-xl text-foreground">Edit tag appearance</Text>
      <View className="flex-row items-center gap-2 rounded-xl px-3 py-3" style={{ backgroundColor: `${THREAD_TAG_TINTS[color]}26` }}>
        {icon ? <SymbolView name={THREAD_TAG_SYMBOLS[icon]} size={20} tintColor={THREAD_TAG_TINTS[color]} /> : null}
        <Text style={{ color: THREAD_TAG_TINTS[color] }}>{name || "Tag preview"}</Text>
      </View>
      <TextInput accessibilityLabel="Tag display name" editable={!props.disabled} value={name} onChangeText={setName} className="min-h-12 rounded-xl bg-subtle px-3 text-foreground" />
      {validation ? <Text accessibilityRole="alert">{validation}</Text> : null}
      {props.original ? <Text className="text-foreground-muted">Assignment key: {props.original.tag}. Changing the display name keeps all thread assignments.</Text> : null}
      <Text>Color</Text>
      <View className="flex-row flex-wrap gap-2">
        {THREAD_TAG_COLORS.map((value) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${value} color`} accessibilityState={{ selected: color === value }} disabled={props.disabled} onPress={() => setColor(value)} className="h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: THREAD_TAG_TINTS[value] }}><Text>{color === value ? "✓" : ""}</Text></Pressable>)}
      </View>
      <Text>Icon</Text>
      <View className="flex-row flex-wrap gap-2">
        <Button label="None" tone="secondary" disabled={props.disabled} onPress={() => setIcon(null)} />
        {THREAD_TAG_ICONS.map((value) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${value} icon`} accessibilityState={{ selected: icon === value }} disabled={props.disabled} onPress={() => setIcon(value)} className="h-12 w-12 items-center justify-center rounded-xl bg-subtle"><SymbolView name={THREAD_TAG_SYMBOLS[value]} size={22} tintColor={icon === value ? THREAD_TAG_TINTS[color] : THREAD_TAG_TINTS.gray} /></Pressable>)}
      </View>
      {props.error ? <Text accessibilityRole="alert">{props.error}</Text> : null}
      <Button label="Save" disabled={props.disabled || validation !== null} onPress={() => void props.onSave(saveTagStyle(props.styles, props.original, name, color, icon))} />
      <Button label="Cancel" tone="secondary" disabled={props.disabled} onPress={props.onCancel} />
      {originalTag && index >= 0 ? <>
        <Text>Priority</Text>
        <Button label="Move earlier" tone="secondary" disabled={props.disabled || index === 0} onPress={() => void props.onSave(moveTagStyle(props.styles, originalTag, -1))} />
        <Button label="Move later" tone="secondary" disabled={props.disabled || index === props.styles.length - 1} onPress={() => void props.onSave(moveTagStyle(props.styles, originalTag, 1))} />
        <Text className="text-foreground-muted">Removing appearance hides this style; it does not remove the tag from threads.</Text>
        <Button label={confirmRemove ? "Confirm remove appearance" : "Remove appearance…"} tone="secondary" disabled={props.disabled} onPress={() => { if (confirmRemove) void props.onSave(props.styles.filter((style) => style.tag !== props.original?.tag)); else setConfirmRemove(true); }} />
      </> : null}
    </View>
  );
}
