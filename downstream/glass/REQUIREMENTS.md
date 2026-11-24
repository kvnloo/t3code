# Android glass / transparency: requirements and recurring failures (downstream only)

This file lives only on the fork, `kvnloo/t3code`. It is never sent upstream. It is a short version of the full source-linked ledger at
`studio:~/.hermes/profiles/tek/workspace/t3-glass/REQUIREMENTS.md`, plus `ledger.jsonl` (48 rows), which was built on 2026-11-19 from Kevin's own messages.
Ask: tek session `20261119_070341_07746a`, 2026-11-19 07:05 CST. The ask was: "continue working on glass / transparency features. scan my message history to gather requirements and understand recurring failures."

## Requirements (Kevin's words → what must be true)

| ID | Requirement | Kevin's words (date, CST) | Status 2026-11-24 |
|---|---|---|---|
| R1 | The app background is see-through over the live wallpaper, with an optional blur / liquid-glass pane | "i want the app to have a translucent background with an optional blur / liquid glass pane … getting bored of looking at a black screen" (11-02) | partial: wallpaper shows on the thread list. Neither phone has OS blur, so Frosted is a deeper tint |
| R2 | A theme engine like Detent, with colours from dotfiles / pywal like Hyprland | "theming engine … similar to detent, and my dotfiles for loading my colors in" (11-02, 11-03) | partial: T3DesktopColorsReceiver works. Not wired to groot's colour sync |
| R3 | All text stays readable on glass, with real accessibility checks | "all text has to be readable so run proper text accessibility and ui considerations" (11-03) | partial: `themeContrastAudit` holds text roles to 4.5:1 or better. No device-frame contrast receipt yet |
| R4 | Every installed flavour (preview, nightly) has transparency and is configured | "none of them had the see through background or blurred screen" (11-04) | open: glass is only on `ayo/O15*`. `channels/preview` and `channels/nightly` lack it |
| R5 | The Settings toggle applies immediately. If it can't, restart the app or prompt | "it only works if I essentially tab out of the app and come back in" (11-04) | code done (setTranslucent, API 30+). Not proven in one continuous device recording |
| R6 | Glass applies everywhere, Settings included | "it doesn't work everywhere … it doesn't work on the settings" (11-04) | code done (`--color-sheet-solid` cleared) |
| R7 | No previous-screen bleed: only the wallpaper shows behind a transparent view | "I can see the settings pin behind the chat view" (11-04) | partial: the sidebar is fixed. Native-stack previous screens / header ghosting are open |
| R8 | The wallpaper is actually visible when See-through is on | "I cannot see the background still" (11-04) | partial (owner screenshot 11-19) |
| R9 | Glass is dogfooded in the separate Preview app (only main + Preview on the phone) | "dogfooding these features in a separate preview app" (11-02); "i just wanna run main one and preview to test" (11-19) | done 11-19: Preview `2.2.0-glass.6532922`, signed with the t3channels key |
| R10 | Apps stay up to date, and the installed build is identifiable | "why is the app not automatically updating" (11-02, asked 3 times) | partial: the versionName now carries the source SHA. No auto-update |
| R11 | Test the real gesture on the phone (virtual display allowed), and explain why QA missed it | "why did the testing that we did not catch those failures" (11-04) | partial: a VD cannot composite the wallpaper, so owner-display proof is still needed |
| R12 | Crisp, non-blurry videos of the glass features | "make sure that the videos are not blurry" (11-04) | open |
| R13 | Reuse prior art (Dash glass spike, Detent, Hyprland). Extend the architecture | "extend the existing architecture without recreating the wheel" (11-02) | done (design) |
| R14 | Bars over scrolling content must hide that content: frosted, never clear | "the bar im typing in is clear so i can see background text thru it when i scroll. make the bar blurred to fix it." (10-21, Dash) | **this branch**: the floating nav pill now hides rows behind it |
| R15 | Readability beats transparency: lower the opacity or blur when see-through looks bad | "use lower opacity if too high of transparency makes it look bad. or use blur effectively." (11-11) | applied in this branch |
| R16 | Premium glass with user-selectable strength, not too dark | "There should be like more options for me to choose. How the glass looks" (11-02, Detent) | open (Solid / See-through / Frosted only) |
| R17 | Only the wallpaper behind glass, and light and dark both follow the wallpaper palette | "should only show the wallpaper engine bg" (08-21, Hermes Liquid Glass) | T3 light mode not checked on a device |
| R18 | Glass is opt-in personalisation. The default theme stays | "i want ppl to be able to personalize if they want to" (10-27) | done: Solid is the default |
| R20 | 11-19 screenshot defects: faded "Reconnecting" banner, nearly invisible top row, opaque black nav pill, last row clipped under the nav, dim meta glyphs | screenshot `tek/images/upload_ld8kp779.jpg` (11-19) | the pill went see-through in 6532922, but rows then showed through it. This branch fixes that |

## Recurring failures (what keeps going wrong)

1. **F1 Previous-screen / behind-content bleed** (5+ incidents in 4 apps). Settings showed behind Chats, header ghosting, Hermes LG showed hermes3d behind it, and Dash composer text showed through. QA only shot the main screen after resume.
2. **F2 The toggle isn't immediate.** It works only after background/resume. The positive proof was a resume screenshot.
3. **F3 Installed builds don't carry the feature.** All flavours said `2.2.0`, and the repair sat on an experiment branch 313 commits behind nightly. versionName was treated as identity.
4. **F4 Infrastructure blocks verification, and the blocked work gets reported as progress.** MBP disk pressure, lost ADB, S25 wireless debug offline, the R8 timeout on the runner.
5. **F5 The wrong test layer was accepted as evidence.** Palette-only unit tests, CSS-string asserts, a virtual display that doesn't composite the wallpaper, wrong VD geometry.
6. **F6 Readability regressions on glass.** Settings got darker from stacked panes, the Detent dial was too dark, the banner and top row were faded, and content could be read through a see-through bar.
7. **F7 Glass demo videos were undelivered or regressed.** Fix passes re-broke accepted clips.
8. **F8 Kevin had to repeat asks.** "update apps" was asked 3 times. "why do you just constantly forget everything".

## Done-checks a glass build must pass (summary of A1–A14 in the full ledger)

- Identity: read back the installed package versionName, versionCode, APK sha256 and source SHA.
- Immediate toggle in one continuous recording. No bleed through Chats → thread → back → Settings. Solid⇄See-through ×3.
- Readability on real device frames over the actual wallpaper: body text 4.5:1 or better, meta 3:1 or better.
- Chrome: the nav pill, FAB and composer follow glass, **and no row content reads through them** (R14).
- At least one observation on the owner's display (display 0), because a VD does not composite the wallpaper.

## This branch: `glass/nav-pill-hides-content`

Before: in See-through mode the floating pill used the bare pane alpha (0.25). Rows that scrolled under it ("Render math", its icon and toggle) showed sharply through the pill and collided with the nav icons (R14, F6). After: the pill takes the least alpha that keeps any text or accent under it at 1.25:1 contrast or lower against the pill around it (`GLASS_PILL_CONTENT_GHOST_MAX`). That alpha is never below the pane alpha, so the wallpaper still tints through. Solid mode, the rail and the docked bar are unchanged.
