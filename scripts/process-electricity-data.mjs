import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const DEFAULT_SOURCE_PATHS = [
  "data/Electricty Data 20240101 - 20260401.csv",
  "data/Electricty Data 20260401 onwards.csv",
];
const DEFAULT_OUTPUT_PATH = "public/electricity-data.json";
const baseTimestamp = Date.UTC(2024, 0, 1);
const intervalMs = 30 * 60 * 1000;

function parseArguments(arguments_) {
  const outputFlagIndex = arguments_.indexOf("--output");
  const outputPath =
    outputFlagIndex === -1
      ? DEFAULT_OUTPUT_PATH
      : arguments_[outputFlagIndex + 1];

  if (outputFlagIndex !== -1 && !outputPath) {
    throw new Error("--output requires a destination path");
  }

  const sourcePaths = arguments_.filter(
    (_, index) => index !== outputFlagIndex && index !== outputFlagIndex + 1,
  );

  return {
    sourcePaths: (sourcePaths.length ? sourcePaths : DEFAULT_SOURCE_PATHS).map(
      (path) => resolve(path),
    ),
    outputPath: resolve(outputPath),
  };
}

function parseLegacyTimestamp(value) {
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

function parseCurrentTimestamp(value) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):\d{2}[+-]\d{2}:\d{2}$/,
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

function parseLegacyRow(line) {
  if (!line.startsWith("DET,")) return null;

  const fields = line.split(",");
  const meter = fields[7];
  const timestamp = parseLegacyTimestamp(fields[9] ?? "");
  const value = Number(fields[12]);

  if (meter !== "CN" && meter !== "UN") return false;

  return {
    timestamp,
    value,
    valueIndex: meter === "CN" ? 1 : 2,
  };
}

function parseCurrentRow(line) {
  if (
    !line ||
    line.startsWith("Supply Point Identifier,") ||
    line.startsWith("DET,")
  ) {
    return null;
  }

  const fields = line.split(",");
  const register = fields[6];
  const timestamp = parseCurrentTimestamp(fields[1] ?? "");
  const value = Number(fields[3]);

  if (register !== "1" && register !== "2") return false;

  return {
    timestamp,
    value,
    valueIndex: register === "2" ? 1 : 2,
  };
}

function parseRow(line) {
  return line.startsWith("DET,")
    ? parseLegacyRow(line)
    : parseCurrentRow(line);
}

const { sourcePaths, outputPath } = parseArguments(process.argv.slice(2));
const intervals = new Map();
const populatedReadings = new Set();
const duplicateSlots = new Set();
let detailRows = 0;
let skippedRows = 0;

for (const sourcePath of sourcePaths) {
  for (const line of readFileSync(sourcePath, "utf8").split(/\r?\n/)) {
    const reading = parseRow(line);
    if (reading === null) continue;

    if (
      reading === false ||
      reading.timestamp === null ||
      !Number.isFinite(reading.value) ||
      new Date(reading.timestamp).getUTCMinutes() % 30 !== 0
    ) {
      skippedRows += 1;
      continue;
    }

    const slot = Math.round(
      (reading.timestamp - baseTimestamp) / intervalMs,
    );
    const current = intervals.get(slot) ?? [slot, 0, 0];
    const readingKey = `${slot}:${reading.valueIndex}`;

    if (populatedReadings.has(readingKey)) duplicateSlots.add(slot);
    current[reading.valueIndex] = reading.value;
    intervals.set(slot, current);
    populatedReadings.add(readingKey);
    detailRows += 1;
  }
}

const data = [...intervals.values()].sort((a, b) => a[0] - b[0]);

if (data.length === 0) {
  throw new Error(
    `No usable interval rows were found in ${sourcePaths.join(", ")}`,
  );
}

const firstTimestamp = baseTimestamp + data[0][0] * intervalMs;
const lastTimestamp =
  baseTimestamp + data[data.length - 1][0] * intervalMs;
const sourceNames = sourcePaths.map((path) => basename(path));

const payload = {
  meta: {
    source: sourceNames.length === 1 ? sourceNames[0] : `${sourceNames.length} CSV files`,
    sources: sourceNames,
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
      sources: payload.meta.sources,
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
