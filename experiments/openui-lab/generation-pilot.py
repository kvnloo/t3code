"""Generation-only pilot; not an integrated T3 latency benchmark."""
import argparse
import json
import time
from pathlib import Path

import requests

parser = argparse.ArgumentParser()
parser.add_argument("--endpoint", default="http://100.113.138.100:11530/v1")
parser.add_argument("--model", default="qwen3-4b-q4km")
parser.add_argument("--catalog", required=True)
parser.add_argument("--out", required=True)
args = parser.parse_args()
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
catalog = Path(args.catalog).read_text()
html_prompt = "Create a complete self-contained read-only HTML report. Inline CSS; no scripts, external resources, network or tools. Use semantic headings, table headers, metric cards and labelled percentage meters. Fit a narrow phone and desktop. Use a dark neutral background with readable contrast. Output only a fenced html document. Preserve every supplied fact; invent none."
cases = [
    {"id": "tests", "title": "Parser test results", "summary": "Focused suite, not a full application qualification", "metrics": [{"label": "Passed", "value": "12"}, {"label": "Failed", "value": "1"}], "columns": ["Suite", "Passed", "Failed"], "rows": [["Parser", "8", "0"], ["Replay", "4", "1"]], "bars": [{"label": "Replay pass rate", "value": 80}]},
    {"id": "comparison", "title": "Renderer comparison", "summary": "Synthetic input data for an output fidelity test, not measured product performance", "metrics": [{"label": "Candidates", "value": "2"}], "columns": ["Renderer", "Output tokens", "Valid"], "rows": [["Catalog", "420", "yes"], ["HTML", "980", "yes"]], "bars": [{"label": "Catalog acceptance", "value": 100}, {"label": "HTML acceptance", "value": 100}]},
]

def generate(system, user, limit):
    start = time.monotonic()
    first = None
    text = ""
    usage = None
    finish = None
    chunks = []
    with requests.post(args.endpoint + "/chat/completions", json={"model": args.model, "temperature": 0, "seed": 42, "max_tokens": limit, "stream": True, "stream_options": {"include_usage": True}, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}, stream=True, timeout=(10, 180)) as response:
        response.raise_for_status()
        for line in response.iter_lines(chunk_size=1):
            if not line.startswith(b"data: ") or line == b"data: [DONE]":
                continue
            event = json.loads(line[6:])
            if event.get("usage"):
                usage = event["usage"]
            for choice in event.get("choices", []):
                content = choice.get("delta", {}).get("content", "")
                if content:
                    now = time.monotonic() - start
                    if first is None:
                        first = now
                    text += content
                    chunks.append({"at_seconds": now, "text": content})
                if choice.get("finish_reason"):
                    finish = choice["finish_reason"]
    return {"ttft_seconds": first, "completion_seconds": time.monotonic() - start, "usage": usage, "finish_reason": finish, "text": text, "chunks": chunks}

# Separate cold-start warmup from paired samples. Do not change the model server config.
try:
    warm = generate("Reply with OK.", "OK", 8)
except requests.RequestException as error:
    failure = {"stage": "warmup", "model": args.model, "endpoint": args.endpoint, "error": str(error)}
    (out / "warmup-error.json").write_text(json.dumps(failure, indent=2))
    raise SystemExit("Model warmup failed; no paired generation samples were collected.") from error
(out / "warmup.json").write_text(json.dumps(warm, indent=2))
for index, case in enumerate(cases):
    for kind in (["openui", "html"] if index % 2 == 0 else ["html", "openui"]):
        system = catalog if kind == "openui" else html_prompt
        prompt = "Render exactly this report, including all metrics, table cells and percentage bars:\n" + json.dumps(case)
        row = {"case": case, "kind": kind, "model": args.model, "endpoint": args.endpoint, "system_prompt": system, "user_prompt": prompt}
        try:
            row.update(generate(system, prompt, 1200))
        except Exception as error:
            row["error"] = str(error)
        target = out / f"{case['id']}-{kind}.json"
        target.write_text(json.dumps(row, indent=2))
        print(json.dumps({k: row.get(k) for k in ["kind", "usage", "finish_reason", "ttft_seconds", "completion_seconds", "error"]}), flush=True)
