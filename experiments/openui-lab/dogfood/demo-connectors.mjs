#!/usr/bin/env node
// Demo MCP connectors for dogfooding app cards: `node demo-connectors.mjs gmail|uber|google-maps|github`.
// Speaks MCP over stdio with no dependencies. Every result is canned demo data and says so;
// nothing is fetched, booked, sent or merged.
import * as NodeReadline from "node:readline";

const DEMO = "Demo data from the T3 Code OpenUI lab, not a real account.";

const CONNECTORS = {
  gmail: {
    search_messages: {
      description: "Search the user's Gmail. Returns matching messages.",
      input: { query: { type: "string", description: "Gmail search query" } },
      run: ({ query }) => ({
        query,
        messages: [
          {
            from: "Acme Billing",
            subject: "Invoice #4512 for October",
            snippet: "Your October invoice for $1,240.00 is ready. Payment is due Nov 15.",
            time: "9:41 AM",
            unread: true,
          },
          {
            from: "Acme Billing",
            subject: "Invoice #4498 for September",
            snippet: "September invoice attached. Thanks for your business.",
            time: "Oct 2",
            unread: false,
          },
          {
            from: "Priya at Acme",
            subject: "Re: billing contact change",
            snippet: "Updated the billing contact to finance@ as requested.",
            time: "Sep 28",
            unread: false,
          },
        ],
      }),
    },
  },
  uber: {
    get_price_estimates: {
      description: "Uber ride options and prices for a trip.",
      input: { pickup: { type: "string" }, dropoff: { type: "string" } },
      run: ({ pickup, dropoff }) => ({
        pickup,
        dropoff,
        options: [
          { name: "UberX", pickup_minutes: 4, price: "$31.20", seats: 4 },
          { name: "Comfort", pickup_minutes: 6, price: "$38.90", seats: 4 },
          { name: "UberXL", pickup_minutes: 9, price: "$52.10", seats: 6 },
        ],
      }),
    },
    request_ride: {
      description: "Request an Uber ride. Demo only: never books.",
      input: {
        product: { type: "string" },
        pickup: { type: "string" },
        dropoff: { type: "string" },
      },
      run: () => ({
        booked: false,
        reason: "Demo connector: booking is disabled. Open the Uber app to book.",
      }),
    },
  },
  "google-maps": {
    get_directions: {
      description: "Directions between two places.",
      input: {
        origin: { type: "string" },
        destination: { type: "string" },
        mode: { type: "string", description: "drive, walk, transit or bike" },
      },
      run: ({ origin, destination, mode = "drive" }) => ({
        origin,
        destination,
        mode,
        minutes: 18,
        distance: "6.2 mi",
        steps: [
          "Head north on Valencia St",
          "Turn right onto Market St",
          "Continue onto The Embarcadero",
          "Arrive at the Ferry Building",
        ],
      }),
    },
  },
  github: {
    get_pull_request: {
      description: "A pull request with its checks and merge state.",
      input: { number: { type: "number" } },
      run: ({ number = 128 }) => ({
        number,
        title: "Refresh sessions in the auth middleware",
        head: "feat/session-refresh",
        base: "main",
        mergeable_state: "dirty",
        conflicts: 3,
        checks: [
          { name: "Tests", status: "pass", detail: "vitest · 42 passed" },
          { name: "Lint", status: "pass", detail: "" },
          { name: "Types", status: "running", detail: "tsgo" },
        ],
      }),
    },
    merge_pull_request: {
      description: "Merge a pull request. Demo only: never merges.",
      input: { number: { type: "number" } },
      run: ({ number }) => ({
        merged: false,
        number,
        reason: "Demo connector: merging is disabled.",
      }),
    },
  },
};

const name = process.argv[2];
const tools = CONNECTORS[name];
if (!tools) {
  process.stderr.write(`usage: demo-connectors.mjs ${Object.keys(CONNECTORS).join("|")}\n`);
  process.exit(2);
}

const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

NodeReadline.createInterface({ input: process.stdin }).on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = request;
  if (id === undefined) return;
  if (method === "initialize") {
    send({
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name, version: "0.0.1" },
      },
    });
  } else if (method === "tools/list") {
    send({
      id,
      result: {
        tools: Object.entries(tools).map(([tool, spec]) => ({
          name: tool,
          description: `${spec.description} ${DEMO}`,
          inputSchema: { type: "object", properties: spec.input },
        })),
      },
    });
  } else if (method === "tools/call") {
    const spec = tools[params?.name];
    if (!spec) send({ id, error: { code: -32602, message: `Unknown tool ${params?.name}` } });
    else
      send({
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({ note: DEMO, ...spec.run(params.arguments ?? {}) }),
            },
          ],
        },
      });
  } else if (method === "ping") {
    send({ id, result: {} });
  } else {
    send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
