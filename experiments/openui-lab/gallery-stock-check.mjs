import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Isolated stock-parser + SSR check. Host asset authorization and dialog focus need app tests.
const out = join(process.env.TMPDIR, "openui-gallery-stock");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module", private: true }));
const install = spawnSync("npm", ["install", "--prefix", out, "--ignore-scripts", "--no-audit", "--no-fund", "@openuidev/lang-core@1.0.2", "@openuidev/react-lang@1.0.2", "react@19.3.0", "react-dom@19.3.0", "zod@4.1.12", "lucide-react@0.564.0", "typescript@6.0.3"], { stdio: "inherit" });
if (install.status !== 0) process.exit(install.status ?? 1);
const ts = (await import(join(out, "node_modules/typescript/lib/typescript.js"))).default;
const source = (path) => readFileSync(path, "utf8");
const transpile = (name, text) => {
  const result = ts.transpileModule(text, {
    fileName: name,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  });
  const errors = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(JSON.stringify(errors));
  writeFileSync(join(out, name.replace(/\.tsx?$/, ".js")), result.outputText);
};
transpile("openUiGallery.ts", source("packages/client-runtime/src/openUiGallery.ts"));
let panel = source("apps/web/src/components/chat/OpenUiGallery.tsx")
  .replace('"@t3tools/client-runtime/openui-gallery"', '"./openUiGallery.js"')
  .replace('"../../lib/utils"', '"./host.js"')
  .replace('"../ui/dialog"', '"./host.js"')
  .replace('"./openUiImageSource"', '"./host.js"');
transpile("Gallery.tsx", panel);
writeFileSync(join(out, "host.js"), `
export const cn = (...values) => values.filter(Boolean).join(" ");
export function useOpenUiImage(source) { return { status: "ready", url: source }; }
export const Dialog = () => null;
export const DialogPopup = () => null;
export const DialogTitle = () => null;
`);
writeFileSync(join(out, "verify.mjs"), `
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createParser } from "@openuidev/lang-core";
import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { Gallery, GalleryPanel, galleryProps } from "./Gallery.js";
import { galleryProblem } from "./openUiGallery.js";
const slides = [{ image: "/shots/a.jpg", title: "Terminal", group: "Terminal", tags: [{text:"Rust",tone:"ok"}], note:"Test note" }, { image: "https://example.com/b.jpg", title: "Kerosene" }];
const props = { title: "Trading terminals", slides };
assert.equal(galleryProps.safeParse(props).success, true);
assert.equal(galleryProblem({typeName:"Gallery",props}), null);
assert.equal(galleryProps.safeParse({title:"too many",slides:Array(25).fill(slides[0])}).success, false);
assert.equal(galleryProps.safeParse({title:"empty",slides:[]}).success, false);
assert.notEqual(galleryProblem({typeName:"Gallery",props:{title:"bad",slides:[{image:"javascript:x",title:"bad"}]}}),null);
const Board = defineComponent({name:"Board",description:"test board",props:z.object({title:z.string(),panels:z.array(Gallery.ref)}),component:({props,renderNode}) => React.createElement("main",null,props.title,renderNode(props.panels))});
const lib = createLibrary({components:[Board,Gallery],root:"Board"});
const code = 'root = Board("Picks", [shots])\\nshots = Gallery("Trading terminals", ' + JSON.stringify(slides) + ')';
const parsed = createParser(lib.toJSONSchema(), lib.root).parse(code);
assert.deepEqual(parsed.meta.errors, []);
assert.equal(parsed.root.props.panels[0].typeName,"Gallery");
const html = renderToStaticMarkup(React.createElement(Renderer,{response:code,library:lib,isStreaming:false}));
assert.ok(html.includes('data-openui-gallery'));
assert.ok(html.includes('1 / 2'));
assert.ok(html.includes('Test note'));
assert.ok(html.includes('aria-roledescription="carousel"'));
assert.ok(html.includes('/shots/a.jpg'));
console.log("PASS: stock OpenUI 1.0.2 positional Gallery parser, schema bounds, unsafe source rejection and production web panel SSR");
console.log("NOT tested: browser interaction, host asset signing, Android UI, installed nightly");
`);
const result = spawnSync(process.execPath, [join(out, "verify.mjs")], { stdio: "inherit" });
process.exit(result.status ?? 1);
