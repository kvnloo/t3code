import {
  THREAD_TAG_COLORS,
  THREAD_TAG_ICONS,
  ThreadTag,
  type ThreadTagColor,
  type ThreadTagIcon,
  type ThreadTagStyle,
} from "@t3tools/contracts";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import { ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { ThreadTagChip, ThreadTagIconGlyph } from "../sidebar/ThreadTagBadges";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const NO_ICON = "none";
const ICON_OPTIONS = [NO_ICON, ...THREAD_TAG_ICONS] as const;
const isThreadTag = Schema.is(ThreadTag);

const ICON_LABELS: Record<ThreadTagIcon | typeof NO_ICON, string> = {
  none: "No icon",
  flame: "Flame",
  star: "Star",
  hand: "Hand",
  bolt: "Bolt",
  alert: "Alert",
  check: "Check",
  clock: "Clock",
  pause: "Pause",
  eye: "Eye",
  rocket: "Rocket",
  bug: "Bug",
  flask: "Flask",
  sparkles: "Sparkles",
  brain: "Brain",
  chart: "Chart",
  code: "Code",
  "pull-request": "Pull request",
  phone: "Phone",
  film: "Film",
  palette: "Palette",
  book: "Book",
  heart: "Heart",
  lock: "Lock",
  cloud: "Cloud",
};

const COLOR_LABELS: Record<ThreadTagColor, string> = {
  red: "Red",
  orange: "Orange",
  amber: "Amber",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  violet: "Violet",
  pink: "Pink",
  gray: "Gray",
};

function nextTagName(styles: ReadonlyArray<ThreadTagStyle>): string {
  const taken = new Set(styles.map((style) => style.tag));
  for (let index = 1; ; index += 1) {
    const candidate = index === 1 ? "new tag" : `new tag ${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Edits how tags look in thread lists. Order is priority: the first styled tag with an icon
 * a thread carries replaces its project icon, and the rest show as chips after the title.
 */
export function ThreadTagStylesRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const saved = settings.threadTagStyles;
  const mixed = useScopedSettingsMixed(["threadTagStyles"]);
  // Edits build on a local draft so a second edit before the first echo does not undo it.
  const [draft, setDraft] = useState(saved);
  const [savedSource, setSavedSource] = useState(saved);
  if (!Equal.equals(savedSource, saved)) {
    setSavedSource(saved);
    setDraft(saved);
  }
  const save = (next: ReadonlyArray<ThreadTagStyle>) => {
    if (!mixed && Equal.equals(next, draft)) return;
    setDraft(next);
    updateSettings(
      { threadTagStyles: next },
      {
        onFailed: () => setDraft(saved),
      },
    );
  };
  const replaceAt = (index: number, next: ThreadTagStyle) =>
    save(draft.map((style, candidate) => (candidate === index ? next : style)));

  return (
    <SettingsRow
      serverScoped
      settingKeys={["threadTagStyles"]}
      {...searchableSetting("thread-tag-styles")}
      description="Give tags an icon and color to show them in thread lists. Higher tags win the icon spot; the rest show as chips. Agents can tag threads too."
      resetAction={
        draft.length > 0 || mixed ? (
          <SettingResetButton label="thread tags" onClick={() => save([])} />
        ) : null
      }
    >
      <div className="flex flex-col gap-1.5 pt-3 pb-2">
        {draft.map((style, index) => (
          <ThreadTagStyleFields
            key={style.tag}
            style={style}
            index={index}
            takenTags={draft.filter((_, candidate) => candidate !== index).map((s) => s.displayName ?? s.tag)}
            onChange={(next) => replaceAt(index, next)}
            onRaise={
              index === 0
                ? null
                : () =>
                    save([
                      ...draft.slice(0, index - 1),
                      draft[index]!,
                      draft[index - 1]!,
                      ...draft.slice(index + 1),
                    ])
            }
            onRemove={() => save(draft.filter((_, candidate) => candidate !== index))}
          />
        ))}
        <div>
          <Button
            variant="ghost-muted"
            size="compact"
            onClick={() => save([...draft, { tag: nextTagName(draft), color: "gray" }])}
          >
            <PlusIcon />
            Add tag
          </Button>
        </div>
      </div>
    </SettingsRow>
  );
}

function ThreadTagStyleFields(props: {
  readonly style: ThreadTagStyle;
  readonly index: number;
  readonly takenTags: ReadonlyArray<string>;
  readonly onChange: (style: ThreadTagStyle) => void;
  readonly onRaise: (() => void) | null;
  readonly onRemove: () => void;
}) {
  const { style, onChange } = props;
  const color = style.color ?? "gray";
  const withIcon = (icon: ThreadTagIcon | null): ThreadTagStyle => {
    const { icon: _previous, ...rest } = style;
    return icon === null ? rest : { ...rest, icon };
  };
  return (
    <div
      role="group"
      aria-label={`Tag ${props.index + 1}`}
      className="flex flex-wrap items-center gap-2"
    >
      <Select
        value={style.icon ?? NO_ICON}
        items={ICON_LABELS}
        onValueChange={(value) => {
          if (value === null) return;
          onChange(withIcon(value === NO_ICON ? null : (value as ThreadTagIcon)));
        }}
      >
        <SelectTrigger size="sm" className="w-36" aria-label="Icon">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {ICON_OPTIONS.map((value) => (
            <SelectItem hideIndicator key={value} value={value}>
              <span className="inline-flex items-center gap-2">
                {value === NO_ICON ? null : (
                  <ThreadTagIconGlyph icon={value} color={color} className="size-3.5" />
                )}
                {ICON_LABELS[value]}
              </span>
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <DraftInput
        size="sm"
        className="w-40"
        aria-label="Tag display name"
        value={style.displayName ?? style.tag}
        spellCheck={false}
        onCommit={(next) => {
          const displayName = next.trim();
          if (displayName === (style.displayName ?? style.tag) || !isThreadTag(displayName) || props.takenTags.includes(displayName)) return;
          onChange({ ...style, displayName });
        }}
      />
      <Select
        value={color}
        items={COLOR_LABELS}
        onValueChange={(value) => {
          if (value !== null) onChange({ ...style, color: value as ThreadTagColor });
        }}
      >
        <SelectTrigger size="sm" className="w-28" aria-label="Color">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {THREAD_TAG_COLORS.map((value) => (
            <SelectItem hideIndicator key={value} value={value}>
              <span className="inline-flex items-center gap-2">
                <ThreadTagIconGlyph icon="star" color={value} className="size-3.5" />
                {COLOR_LABELS[value]}
              </span>
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <div className="ml-auto flex min-w-0 items-center gap-1">
        <ThreadTagChip
          badge={{ tag: style.displayName ?? style.tag, icon: style.icon ?? null, color: style.color ?? null }}
        />
        <Button
          variant="ghost-muted"
          size="icon-sm"
          aria-label={`Raise ${style.tag}`}
          disabled={props.onRaise === null}
          onClick={props.onRaise ?? undefined}
        >
          <ArrowUpIcon />
        </Button>
        <Button
          variant="ghost-muted"
          size="icon-sm"
          aria-label={`Remove ${style.tag}`}
          onClick={props.onRemove}
        >
          <XIcon />
        </Button>
      </div>
    </div>
  );
}
