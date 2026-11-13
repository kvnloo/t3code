import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { OpenUiReport, inspectOpenUiReport, openUiReportPrompt } from "../../apps/web/src/components/chat/OpenUiReport";

const valid = 'root = Report("Build results", "Focused suite", [{label: "Passed", value: "12"}], ["Suite", "Result"], [["Parser", "pass"]], [{label: "Pass rate", value: 100}])';

test("accepts the version-one catalog and renders the supplied data", () => {
  assert.equal(inspectOpenUiReport(valid).kind, "ready");
  const html = renderToStaticMarkup(createElement(OpenUiReport, { code: valid }));
  assert.match(html, /Build results/);
  assert.match(html, /Parser/);
  assert.match(html, /Pass rate/);
  assert.doesNotMatch(html, /<script/);
  assert.match(openUiReportPrompt, /Report/);
});

test("rejects malformed, unresolved, unknown and tool-bearing programs", () => {
  for (const code of [
    'root = Report(',
    'root = Unknown("bad")',
    'root = missing',
    valid + '\ndata = Query("read_file", {})',
    valid + '\nmutation = Mutation("write_file", {})',
    'root = Report("Bad", "", [], ["one", "two"], [["one"]], [])',
    'root = Report("Bad", "", [], [], [], [{label: "bad", value: -1}])',
    'root = Report("Bad", "", [], [], [], [{label: "bad", value: 101}])',
  ]) assert.notEqual(inspectOpenUiReport(code).kind, "ready", code);
});

test("interruption remains visibly incomplete and replay is deterministic", () => {
  const interrupted = valid.slice(0, valid.length - 10);
  assert.notEqual(inspectOpenUiReport(interrupted).kind, "ready");
  assert.deepEqual(inspectOpenUiReport(valid), inspectOpenUiReport(valid));
});

test("escapes model-authored markup and bounds input size", () => {
  const escaped = valid.replace("Build results", "<script>alert(1)</script>");
  const html = renderToStaticMarkup(createElement(OpenUiReport, { code: escaped }));
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(inspectOpenUiReport("x".repeat(65_537)).kind, "invalid");
});
