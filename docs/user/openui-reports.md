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

Chart boards can also hold app cards. Each card is drawn in the design system
of the service its data came from (GitHub's Primer, Uber's Base, Google's
Material 3), in that app's typeface, and follows T3 Code's light or dark
appearance:

- **RideOptions** (Uber or Lyft): pickup and drop-off, then each ride option
  with a vehicle picture, seats, pickup time, arrival time and price. The
  cheapest option is tagged and selected. Tap another option to select it; the
  button opens the ride app, where booking happens.
- **MailList** (Gmail): the search, then each message's sender, subject, time,
  snippet and attachment, with unread messages in bold. Tap a message to show
  its whole snippet; "Open in Gmail" runs the same search in Gmail.
- **Route** (Google Maps): travel time, distance, mode and main road, then one
  step at a time. When the maps tool returns the route's shape, the card draws
  it on the road it takes, over the tool's map image when it sent one; a card
  never draws a route the tool did not return. "Open in Maps" opens the same
  directions in Google Maps.
- **PullRequest** (GitHub): number, title, state, recent commits on a small
  commit graph with conflicting commits marked, the checks (as a timeline when
  the tool reports when each ran), and one line that says where the pull
  request stands, such as "This branch has 2 conflicts that must be resolved".
  A failing check opens with its detail; tap any check to see its detail.

On web and desktop a board fills in card by card while the agent is still
writing it. The Android experiment shows the same cards natively, with the same
themes, commit graph, route and app links, once the board is complete.

Charts and cards keep their selections locally; tapping never sends a message,
books, sends or merges anything. Links open the app itself, where any action
still needs you. Scrolling a long conversation can reset a
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
- The PullRequest card's commit graph, conflict marks and check chips follow
  [@pitus_'s "Generative UI #2 – Merge conflicts"](https://x.com/pitus_/status/2111519352503873866).
- The idea of brand-colored app cards in place of a bare "thinking" row comes
  from Kevin Rajan ([@kvnloo](https://github.com/kvnloo)).
- App card themes copy tokens from [Primer](https://primer.style) (MIT),
  [Base Web](https://baseweb.design) (MIT) and Material 3; icons are
  [Primer Octicons](https://primer.style/octicons) (MIT). Fonts are Google
  Sans, Inter Tight and Mona Sans (SIL Open Font License).
- Vehicle pictures in the ride card are generated illustrations, not Uber or
  Lyft artwork. The demo maps connector's route comes from
  [OSRM](https://project-osrm.org) and its map image from
  [OpenStreetMap](https://www.openstreetmap.org/copyright) data (ODbL).

