# Source-demo chart fences (catalog v2)

One completed `openui-v2` answer per prompt in `source-demo-conversations.json`. They use the same synthetic fixtures. `charts.test.ts` parses and renders all three. They are reference answers for the renderer, not model output.

## repo-treemap

```openui-v2
root = Board("Repository size and churn", "src/ui/chat.ts is the largest file; src/auth/login.ts has the most commits.", [map, churn])
map = Treemap("Size and churn", "LOC", "commits", [{path: "src/auth/login.ts", size: 80, color: 12}, {path: "src/auth/tokens.ts", size: 40, color: 6}, {path: "src/ui/chat.ts", size: 120, color: 4}, {path: "tests/auth.test.ts", size: 60, color: 7}])
churn = BarChart("Top 3 files by churn", "commits", [{label: "login.ts", value: 12}, {label: "auth.test.ts", value: 7}, {label: "tokens.ts", value: 6}])
```

## model-stacked-area

```openui-v2
root = Board("Turns by model", "Wednesday had the most turns (16); Claude led on Tuesday.", [usage])
usage = StackedArea("Turns by model", "turns", ["Mon", "Tue", "Wed"], [{name: "Codex", values: [8, 4, 10]}, {name: "Claude", values: [4, 10, 6]}])
```

## activity-heatmap

```openui-v2
root = Board("Activity by day and hour", "Tuesday 12:00 UTC was the busiest slot with 9 turns.", [heat])
heat = Heatmap("Activity (UTC)", "turns", ["Mon", "Tue", "Wed"], ["00:00", "06:00", "12:00", "18:00"], [[0, 2, 7, 1], [1, 4, 9, 2], [0, 3, 5, 1]])
```
