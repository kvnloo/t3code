# Experimental OpenUI reports

The OpenUI experiment adds read-only reports to ordinary chat messages. It does
not replace T3's chat, providers, or application interface.

A report is stored as an `openui-v1` code block. Choose **Render report** to show
it, or **Show source** to return to the original program. The renderer loads only
when you choose to render a report. Other code blocks keep their usual behavior.

Catalog version 1 supports a title, summary, metrics, a table, and percentage
bars. Catalog version 2 (an `openui-v2` code block) is a chart board: a title, a
summary, and up to eight panels. A chart board renders on its own once its code
block is complete; **Show source** still returns to the program.

- **Treemap**: files sized by one number and shaded by another. Tap a folder to
  open it, Back to return, and a file to see its values. A folder that holds a
  single entry is merged with it, so `home/kvn/` opens in one tap.
- **BarChart**: horizontal bars of raw values. Long path labels keep their file
  name and drop the start of the path.
- **StackedArea**: counts per category stacked by series. Tap a category to see
  exact values and mark it on the chart.
- **Heatmap**: counts on labeled rows and columns, zeros included. Tap a cell to
  see its exact count. Grids wider than 12 columns, such as hours of the day,
  show compact cells and label every few columns; the counts stay one tap away.

Chart boards can also hold app cards, drawn in the colors of the service the
data came from:

- **RideOptions** (Uber or Lyft): pickup and drop-off, then each ride option
  with its pickup time, price and seats. The cheapest option is tagged. Tap an
  option to see it in full; booking still happens in the ride app.
- **MailList** (Gmail): the search, then each message's sender, subject, time
  and snippet, with unread messages marked. Tap a message to show its whole
  snippet.
- **Route** (Google Maps): travel time, distance and mode, then the steps. Tap a
  step to highlight it.
- **PullRequest** (GitHub): number, title, branches, a progress track (opened,
  checks, ready, merged), the conflict count and check chips. Tap a check to
  see its detail. A merged pull request fills its track once when it appears.

Charts and cards keep their selections locally; tapping never sends a message,
books, sends or merges anything. Scrolling a long conversation can reset a
selection.

When an agent uses a tool from a known app, its activity row shows that app's
colored mark and a plain sentence, such as "Searching Gmail · invoices from
Acme" or "Checked Uber prices", instead of the generic tool name. This works for
any provider; the app is recognized from the tool's server name (Gmail, Google
Calendar, Google Maps, Uber, Lyft, GitHub, Slack, Spotify and DoorDash). Expand
the row as usual to see the full call.

Brand names and colors only identify the service. T3 Code bundles no logos and
is not affiliated with these companies.

Reports cannot call tools, run queries or mutations, maintain generated
state, or dispatch actions. Invalid or incomplete reports display a notice; the
source remains available. Reports are limited to 64 KiB, table rows must
match their columns, and chart data must line up: one value per category, one
count per heatmap cell, and no file path that is also a folder.

Reports remain ordinary message text for storage and remote connections. Agents
should include a normal Markdown summary after a report so clients without this
experiment still have a readable answer. An interrupted or unclosed code block
stays source text rather than being treated as a completed report.

The experimental web renderer is shared with desktop. The Android experiment
uses native views for the same catalog, rather than embedding an HTML page.
Native iOS execution has not been qualified. The separate Android experiment app
does not replace the standard T3 Code app or receive its over-the-air updates.

A replay of a saved conversation demonstrates rendering and navigation, not
model generation speed. Generation-speed claims require live measurements with
the same facts, model, prompt overhead, and completion criteria.

## Credits

- Reports and chart boards use [OpenUI](https://github.com/thesysdev/openui)
  (`@openuidev/react-lang`, `@openuidev/lang-core`).
- The PullRequest card's progress track, conflict count and check chips follow
  [@pitus_'s "Generative UI #2 – Merge conflicts"](https://x.com/pitus_/status/2111519352503873866).
- The idea of brand-colored app cards in place of a bare "thinking" row comes
  from Kevin Rajan ([@kvnloo](https://github.com/kvnloo)).
