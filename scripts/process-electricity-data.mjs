import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
    sourcePaths: (sourcePaths.length ? sourcePaths : discoverSources()).map((path) =>
      resolve(path),
    ),
    outputPath: resolve(outputPath),
  };
}

function discoverSources() {
  const monthlyExports = readdirSync("data")
    .filter((name) => /^electricity-interval-meter-readings_\d{8}_\d{6}\.csv$/i.test(name))
    .sort()
    .map((name) => `data/${name}`);

  return [...DEFAULT_SOURCE_PATHS, ...monthlyExports];
}

function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  fields.push(field);
  return fields;
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

function parseLegacyRow(fields) {
  if (fields[0] !== "DET") return null;

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

function parseCurrentRow(fields, columns) {
  const register = fields[columns.register];
  const timestamp = parseCurrentTimestamp(fields[1] ?? "");
  const value = Number(fields[columns.value]);

  if (register !== "1" && register !== "2") return false;

  return {
    timestamp,
    value,
    valueIndex: register === "2" ? 1 : 2,
  };
}

const { sourcePaths, outputPath } = parseArguments(process.argv.slice(2));
const intervals = new Map();
const populatedReadings = new Set();
const duplicateSlots = new Set();
const missingSlots = [];
let detailRows = 0;
let skippedRows = 0;

for (const sourcePath of sourcePaths) {
  let columns = { register: 6, value: 3 };
  for (const line of readFileSync(sourcePath, "utf8").split(/\r?\n/)) {
    if (!line) continue;
    const fields = parseCsvLine(line);
    fields[0] = fields[0].replace(/^\uFEFF/, "");
    if (fields[0] === "Supply Point Identifier") {
      columns = {
        register: fields.indexOf("Register ID"),
        value: fields.indexOf("Value"),
      };
      if (columns.register === -1 || columns.value === -1) {
        throw new Error(`Unsupported meter CSV header in ${sourcePath}`);
      }
      continue;
    }
    const reading = fields[0] === "DET"
      ? parseLegacyRow(fields)
      : parseCurrentRow(fields, columns);
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

const populatedData = [...intervals.values()].sort((a, b) => a[0] - b[0]);

if (populatedData.length === 0) {
  throw new Error(
    `No usable interval rows were found in ${sourcePaths.join(", ")}`,
  );
}

const data = [];
for (let slot = populatedData[0][0]; slot <= populatedData.at(-1)[0]; slot += 1) {
  const reading = intervals.get(slot);
  if (reading) {
    data.push(reading);
  } else {
    data.push([slot, 0, 0]);
    missingSlots.push(slot);
  }
}

const firstTimestamp = baseTimestamp + data[0][0] * intervalMs;
const lastTimestamp =
  baseTimestamp + data[data.length - 1][0] * intervalMs;
const sourceNames = sourcePaths.map((path) => basename(path));
const gapPeriods = [];

for (const slot of missingSlots) {
  const previousPeriod = gapPeriods.at(-1);
  if (previousPeriod && previousPeriod.endSlot === slot) {
    previousPeriod.endSlot += 1;
    previousPeriod.intervalCount += 1;
    previousPeriod.endDate = new Date(
      baseTimestamp + (slot + 1) * intervalMs,
    ).toISOString();
  } else {
    gapPeriods.push({
      startSlot: slot,
      endSlot: slot + 1,
      startDate: new Date(baseTimestamp + slot * intervalMs).toISOString(),
      endDate: new Date(baseTimestamp + (slot + 1) * intervalMs).toISOString(),
      intervalCount: 1,
    });
  }
}

for (const period of gapPeriods) {
  delete period.startSlot;
  delete period.endSlot;
}

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
    filledIntervalCount: missingSlots.length,
    gapPeriods,
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
      filledIntervals: payload.meta.filledIntervalCount,
      skippedRows,
    },
    null,
    2,
  ),
);
