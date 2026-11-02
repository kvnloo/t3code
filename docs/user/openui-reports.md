# Experimental OpenUI reports

The OpenUI experiment adds read-only reports to ordinary chat messages. It does
not replace T3's chat, providers, or application interface.

A report is stored as an `openui-v1` code block. Choose **Render report** to show
it, or **Show source** to return to the original program. The renderer loads only
when you choose to render a report. Other code blocks keep their usual behavior.

Catalog version 1 supports a title, summary, metrics, a table, and percentage
bars. Reports cannot call tools, run queries or mutations, maintain generated
state, or dispatch actions. Invalid or incomplete reports display a notice; the
source remains available. Reports are limited to 64 KiB, and table rows must
match their columns.

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
