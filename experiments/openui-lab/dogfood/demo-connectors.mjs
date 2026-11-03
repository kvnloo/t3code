#!/usr/bin/env node
// Demo MCP connectors for dogfooding app cards: `node demo-connectors.mjs gmail|uber|google-maps|github`.
// Speaks MCP over stdio with no dependencies. Every result is canned demo data and says so;
// nothing is fetched, booked, sent or merged.
import * as NodeReadline from "node:readline";

const ROUTE_FERRY_SFO = [
  [37.79384, -122.39395],
  [37.79325, -122.39321],
  [37.79372, -122.39261],
  [37.79271, -122.39147],
  [37.79115, -122.39061],
  [37.78924, -122.38841],
  [37.78778, -122.38799],
  [37.78085, -122.38865],
  [37.7737, -122.39757],
  [37.77275, -122.3981],
  [37.76886, -122.39738],
  [37.76591, -122.39412],
  [37.76399, -122.393],
  [37.75164, -122.39166],
  [37.74557, -122.39467],
  [37.73888, -122.40064],
  [37.73572, -122.40444],
  [37.73383, -122.40507],
  [37.71634, -122.39893],
  [37.7114, -122.39581],
  [37.67773, -122.38851],
  [37.6742, -122.38972],
  [37.67028, -122.39245],
  [37.66498, -122.39762],
  [37.6597, -122.40477],
  [37.65578, -122.4068],
  [37.65292, -122.40712],
  [37.64071, -122.40597],
  [37.6356, -122.40409],
  [37.62656, -122.40252],
  [37.61442, -122.39796],
  [37.6138, -122.39644],
  [37.61536, -122.38856],
  [37.61475, -122.38581],
  [37.6151, -122.38486],
  [37.6165, -122.38392],
];

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
            attachment: "INV-4512.pdf",
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
        minutes: 22,
        distance: "14.5 mi",
        via: "I-280 S and US-101 S",
        steps: [
          "Head south on Steuart St",
          "Turn left onto Mission St",
          "Turn right onto The Embarcadero",
          "Continue onto King St",
          "Merge onto I-280 S",
          "Take the exit onto US-101 S",
          "Keep right onto US-101 Spur toward the airport",
          "Turn right onto Departures",
        ],
        // The real Ferry Building to SFO driving route (OSRM over OpenStreetMap, ODbL), simplified.
        path: ROUTE_FERRY_SFO,
        // A static basemap of the same area in Google's map colours, from OpenStreetMap (ODbL).
        map: {
          image:
            "https://raw.githubusercontent.com/kvnloo/t3code/media/openui-app-cards/maps/ferry-sfo-map.png",
          bounds: [37.597565, -122.664055, 37.810018, -122.127003],
        },
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
          { name: "Install", status: "pass", detail: "", started: 0, seconds: 11 },
          { name: "Lint", status: "pass", detail: "", started: 11, seconds: 9 },
          { name: "Tests", status: "pass", detail: "vitest · 42 passed", started: 11, seconds: 38 },
          { name: "Types", status: "running", detail: "tsgo", started: 20, seconds: 24 },
        ],
        commits: [
          {
            title: "Refresh tokens before expiry",
            sha: "a41f9c2",
            author: "kevin",
            age: "2h",
            lane: "head",
            branch: "feat/session-refresh",
          },
          {
            title: "Add refresh test for clock skew",
            sha: "9b3e0d4",
            author: "kevin",
            age: "3h",
            lane: "head",
          },
          {
            title: "Rewrite session middleware",
            sha: "c90e1b7",
            author: "julius",
            age: "5h",
            lane: "base",
            branch: "main",
            conflict: true,
          },
          {
            title: "Bump effect to 4.0.0-beta.31",
            sha: "77d0aa1",
            author: "theo",
            age: "1d",
            lane: "base",
          },
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
