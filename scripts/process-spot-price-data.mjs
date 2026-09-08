import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const DEFAULT_SOURCE_PATH =
  "data/wilton_settled_spot_prices_since_2024.csv";
const DEFAULT_OUTPUT_PATH = "public/spot-price-data.json";
const baseTimestamp = Date.UTC(2024, 0, 1);
const intervalMs = 30 * 60 * 1000;

function parseArguments(arguments_) {
  const sourcePath = resolve(arguments_[0] ?? DEFAULT_SOURCE_PATH);
  const outputPath = resolve(arguments_[1] ?? DEFAULT_OUTPUT_PATH);
  return { sourcePath, outputPath };
}

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  fields.push(current);
  return fields;
}

function parseLocalTimestamp(value) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) NZ(?:D|S)T$/,
  );
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
}

const { sourcePath, outputPath } = parseArguments(process.argv.slice(2));
const lines = readFileSync(sourcePath, "utf8").split(/\r?\n/);
const headings = parseCsvLine((lines.shift() ?? "").replace(/^\uFEFF/, ""));
const timestampIndex = headings.indexOf("Interval start (NZ)");
const priceIndex = headings.indexOf("Final price (c/kWh)");
const pointIndex = headings.indexOf("Point of connection");

if (timestampIndex === -1 || priceIndex === -1) {
  throw new Error(
    "The spot-price CSV must contain Interval start (NZ) and Final price (c/kWh) columns.",
  );
}

const intervals = new Map();
const points = new Set();
let sourceRows = 0;
let skippedRows = 0;
let duplicateIntervalCount = 0;

for (const line of lines) {
  if (!line.trim()) continue;
  const fields = parseCsvLine(line);
  const timestamp = parseLocalTimestamp(fields[timestampIndex] ?? "");
  const price = Number(fields[priceIndex]);

  if (
    timestamp === null ||
    !Number.isFinite(price) ||
    new Date(timestamp).getUTCMinutes() % 30 !== 0
  ) {
    skippedRows += 1;
    continue;
  }

  const slot = Math.round((timestamp - baseTimestamp) / intervalMs);
  const prices = intervals.get(slot) ?? [];
  if (prices.length > 0) duplicateIntervalCount += 1;
  prices.push(price);
  intervals.set(slot, prices);
  if (pointIndex !== -1 && fields[pointIndex]) points.add(fields[pointIndex]);
  sourceRows += 1;
}

const data = [...intervals.entries()]
  .sort(([a], [b]) => a - b)
  .map(([slot, prices]) => [
    slot,
    Number(
      (prices.reduce((total, price) => total + price, 0) / prices.length).toFixed(
        6,
      ),
    ),
  ]);

if (data.length === 0) {
  throw new Error(`No usable spot-price rows were found in ${sourcePath}`);
}

const firstTimestamp = baseTimestamp + data[0][0] * intervalMs;
const lastTimestamp = baseTimestamp + data[data.length - 1][0] * intervalMs;
const payload = {
  meta: {
    source: basename(sourcePath),
    generatedAt: new Date().toISOString(),
    pointOfConnection: [...points].join(", "),
    intervalMinutes: 30,
    baseDate: "2024-01-01T00:00:00.000Z",
    firstDate: new Date(firstTimestamp).toISOString(),
    lastDate: new Date(lastTimestamp).toISOString(),
    sourceRows,
    intervalCount: data.length,
    duplicateIntervalCount,
    skippedRows,
    priceUnit: "c/kWh",
  },
  data,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(payload));

console.log(
  JSON.stringify(
    {
      outputPath,
      source: payload.meta.source,
      pointOfConnection: payload.meta.pointOfConnection,
      firstDate: payload.meta.firstDate,
      lastDate: payload.meta.lastDate,
      intervals: payload.meta.intervalCount,
      duplicateIntervals: payload.meta.duplicateIntervalCount,
      skippedRows,
    },
    null,
    2,
  ),
);
