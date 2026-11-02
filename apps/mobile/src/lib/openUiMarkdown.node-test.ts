import assert from "node:assert/strict";
import test from "node:test";
import { splitOpenUiMarkdown } from "./openUiMarkdown.ts";

test("completed report preserves surrounding transcript", () => {
  assert.deepEqual(splitOpenUiMarkdown('Before\n```openui-v1\nroot = Report("Facts")\n```\nAfter'), [
    { kind: "markdown", text: "Before\n" }, { kind: "report", version: 1, code: 'root = Report("Facts")' }, { kind: "markdown", text: "After" },
  ]);
});
test("streaming incomplete fences remain source", () => {
  const source = 'Before\n```openui-v1\nroot = Report(';
  assert.deepEqual(splitOpenUiMarkdown(source), [{ kind: "markdown", text: source }]);
});
test("nested examples are not interpreted", () => {
  const source = '````markdown\n```openui-v1\nroot = Report("example")\n```\n````';
  assert.deepEqual(splitOpenUiMarkdown(source), [{ kind: "markdown", text: source }]);
});
test("CRLF and tilde fences are supported", () => {
  assert.deepEqual(splitOpenUiMarkdown('~~~openui-v1\r\nroot = Report("Facts")\r\n~~~'), [{ kind: "report", version: 1, code: 'root = Report("Facts")' }]);
});
test("unversioned and unrelated fences remain source", () => {
  const source = '```openui\nroot = Report("Facts")\n```\n';
  assert.deepEqual(splitOpenUiMarkdown(source), [{ kind: "markdown", text: source }]);
});
test("chart board fences carry catalog version 2", () => {
  assert.deepEqual(splitOpenUiMarkdown('```openui-v2\nroot = Board("Churn", "", [])\n```\nSummary'), [
    { kind: "report", version: 2, code: 'root = Board("Churn", "", [])' }, { kind: "markdown", text: "Summary" },
  ]);
});
test("unknown catalog versions remain source", () => {
  const source = '```openui-v3\nroot = Board("Churn")\n```\n';
  assert.deepEqual(splitOpenUiMarkdown(source), [{ kind: "markdown", text: source }]);
});
