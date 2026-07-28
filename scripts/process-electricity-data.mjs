import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const sourcePath = resolve(
  process.argv[2] ?? "Electricty Data 2024 onwards.csv",
);
const outputPath = resolve(
  process.argv[3] ?? "public/electricity-data.json",
);
const baseTimestamp = Date.UTC(2024, 0, 1);
const intervalMs = 30 * 60 * 1000;

function parseLocalTimestamp(value) {
  const match = value.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})$/,
  );

  if (!match) return null;

  const [, day, month, year, hour, minute] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
}

const intervals = new Map();
const duplicateSlots = new Set();
let detailRows = 0;
let skippedRows = 0;

for (const line of readFileSync(sourcePath, "utf8").split(/\r?\n/)) {
  if (!line.startsWith("DET,")) continue;

  const fields = line.split(",");
  const meter = fields[7];
  const timestamp = parseLocalTimestamp(fields[9] ?? "");
  const value = Number(fields[12]);

  if (
    timestamp === null ||
    !Number.isFinite(value) ||
    (meter !== "CN" && meter !== "UN")
  ) {
    skippedRows += 1;
    continue;
  }

  const slot = Math.round((timestamp - baseTimestamp) / intervalMs);
  const current = intervals.get(slot) ?? [slot, 0, 0];
  const valueIndex = meter === "CN" ? 1 : 2;

  if (current[valueIndex] !== 0) duplicateSlots.add(slot);
  current[valueIndex] = value;
  intervals.set(slot, current);
  detailRows += 1;
}

const data = [...intervals.values()].sort((a, b) => a[0] - b[0]);

if (data.length === 0) {
  throw new Error(`No usable interval rows were found in ${sourcePath}`);
}

const firstTimestamp = baseTimestamp + data[0][0] * intervalMs;
const lastTimestamp =
  baseTimestamp + data[data.length - 1][0] * intervalMs;

const payload = {
  meta: {
    source: sourcePath.split(/[\\/]/).at(-1),
    generatedAt: new Date().toISOString(),
    intervalMinutes: 30,
    baseDate: "2024-01-01T00:00:00.000Z",
    firstDate: new Date(firstTimestamp).toISOString(),
    lastDate: new Date(lastTimestamp).toISOString(),
    detailRows,
    intervalCount: data.length,
    duplicateIntervalCount: duplicateSlots.size,
    skippedRows,
  },
  data,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(payload));

console.log(
  JSON.stringify(
    {
      outputPath,
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
