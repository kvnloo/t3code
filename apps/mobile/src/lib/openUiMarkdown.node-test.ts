import assert from "node:assert/strict";
import test from "node:test";
import { splitOpenUiMarkdown } from "./openUiMarkdown.ts";

test("completed report preserves surrounding transcript", () => {
  assert.deepEqual(splitOpenUiMarkdown('Before\n```openui-v1\nroot = Report("Facts")\n```\nAfter'), [
    { kind: "markdown", text: "Before\n" }, { kind: "report", code: 'root = Report("Facts")' }, { kind: "markdown", text: "After" },
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
  assert.deepEqual(splitOpenUiMarkdown('~~~openui-v1\r\nroot = Report("Facts")\r\n~~~'), [{ kind: "report", code: 'root = Report("Facts")' }]);
});
test("unversioned and unrelated fences remain source", () => {
  const source = '```openui\nroot = Report("Facts")\n```\n';
  assert.deepEqual(splitOpenUiMarkdown(source), [{ kind: "markdown", text: source }]);
});
