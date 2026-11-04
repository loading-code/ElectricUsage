import {
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";

const SPOT_CSV_PATH = "data/wilton_settled_spot_prices_since_2024.csv";
const USAGE_JSON_PATH = "public/electricity-data.json";
const POINT_OF_CONNECTION = "WIL0331";
const BASE_TIMESTAMP = Date.UTC(2024, 0, 1);
const INTERVAL_MS = 30 * 60 * 1000;
const SOURCE_BASE_URL =
  "https://emidatasets.blob.core.windows.net/publicdata/Datasets/Wholesale/DispatchAndPricing/FinalEnergyPrices";
const HEADERS = [
  "Interval start (NZ)",
  "Interval end (NZ)",
  "Interval start (UTC)",
  "Trading date",
  "Trading period",
  "Point of connection",
  "Final price ($/MWh)",
  "Source file",
  "Final price ($/kWh)",
  "Final price (c/kWh)",
  "Source URL",
];

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

function csvEscape(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function dateParts(dateText) {
  const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid trading date: ${dateText}`);
  return match.slice(1).map(Number);
}

function lastSunday(year, monthIndex) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  return lastDay.getUTCDate() - lastDay.getUTCDay();
}

function firstSunday(year, monthIndex) {
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  return 1 + ((7 - firstDay.getUTCDay()) % 7);
}

function expectedTradingPeriods(dateText) {
  const [year, month, day] = dateParts(dateText);
  if (month === 9 && day === lastSunday(year, 8)) return 46;
  if (month === 4 && day === firstSunday(year, 3)) return 50;
  return 48;
}

function isDaylightTime(dateText, period, periodCount) {
  const [year, month, day] = dateParts(dateText);
  if (periodCount === 46) return period >= 5;
  if (periodCount === 50) return period <= 6;

  return (
    month >= 10 ||
    month <= 2 ||
    (month === 3 && day < firstSunday(year, 2))
  );
}

function getLocalPeriodStart(dateText, period, periodCount) {
  const [year, month, day] = dateParts(dateText);
  let localSlot = period - 1;
  if (periodCount === 46 && period >= 5) localSlot += 2;
  if (periodCount === 50 && period > 6) localSlot -= 2;

  const localStart = Date.UTC(year, month - 1, day) + localSlot * INTERVAL_MS;
  const daylight = isDaylightTime(dateText, period, periodCount);
  const offsetMinutes = daylight ? 13 * 60 : 12 * 60;
  return {
    localStart,
    utcStart: localStart - offsetMinutes * 60 * 1000,
    zone: daylight ? "NZDT" : "NZST",
  };
}

function formatLocal(timestamp, zone) {
  return `${new Date(timestamp).toISOString().slice(0, 16).replace("T", " ")} ${zone}`;
}

function asSourceRow(dateText, period, periodCount, price, filename, sourceUrl) {
  const interval = getLocalPeriodStart(dateText, period, periodCount);
  const nextPeriod = period < periodCount
    ? getLocalPeriodStart(dateText, period + 1, periodCount)
    : { localStart: interval.localStart + INTERVAL_MS, zone: interval.zone };
  const pricePerKwh = price / 1000;
  return [
    formatLocal(interval.localStart, interval.zone),
    formatLocal(nextPeriod.localStart, nextPeriod.zone),
    new Date(interval.utcStart).toISOString().slice(0, 16).replace("T", " "),
    dateText,
    period,
    POINT_OF_CONNECTION,
    `$${price.toFixed(2)}`,
    filename,
    `$${pricePerKwh.toFixed(5)}`,
    (pricePerKwh * 100).toFixed(4),
    sourceUrl,
  ].map(csvEscape).join(",");
}

function dateRange(startDate, endDate) {
  const result = [];
  for (
    let day = Date.parse(`${startDate}T00:00:00Z`);
    day <= Date.parse(`${endDate}T00:00:00Z`);
    day += 24 * 60 * 60 * 1000
  ) {
    result.push(new Date(day).toISOString().slice(0, 10));
  }
  return result;
}

function parseSourceCsv(csvText, dateText, sourceUrl) {
  const [headerLine, ...lines] = csvText.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headings = parseCsvLine(headerLine ?? "");
  const dateIndex = headings.indexOf("TradingDate");
  const periodIndex = headings.indexOf("TradingPeriod");
  const pointIndex = headings.indexOf("PointOfConnection");
  const priceIndex = headings.indexOf("DollarsPerMegawattHour");
  if ([dateIndex, periodIndex, pointIndex, priceIndex].includes(-1)) {
    throw new Error(`Unexpected Electricity Authority CSV columns for ${dateText}`);
  }

  const periodCount = expectedTradingPeriods(dateText);
  const records = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    if (fields[pointIndex] !== POINT_OF_CONNECTION) continue;
    if (fields[dateIndex] !== dateText) {
      throw new Error(`Unexpected trading date in official price file for ${dateText}`);
    }

    const period = Number(fields[periodIndex]);
    const price = Number(fields[priceIndex]);
    if (
      !Number.isInteger(period) ||
      period < 1 ||
      period > periodCount ||
      !Number.isFinite(price)
    ) {
      throw new Error(`Invalid WIL0331 price row in official file for ${dateText}`);
    }

    const filename = `${dateText.replaceAll("-", "")}_FinalEnergyPrices.csv`;
    records.set(
      `${dateText}:${period}`,
      asSourceRow(dateText, period, periodCount, price, filename, sourceUrl),
    );
  }

  if (records.size !== periodCount) {
    throw new Error(
      `Expected ${periodCount} final WIL0331 intervals for ${dateText}, received ${records.size}. The source may not be final yet.`,
    );
  }
  return records;
}

const usage = JSON.parse(readFileSync(USAGE_JSON_PATH, "utf8"));
const meterLastSlot = usage.data.at(-1)?.[0];
if (!Number.isInteger(meterLastSlot)) {
  throw new Error(`No final meter interval was found in ${USAGE_JSON_PATH}`);
}
const targetDate = new Date(BASE_TIMESTAMP + meterLastSlot * INTERVAL_MS)
  .toISOString()
  .slice(0, 10);

const sourceText = readFileSync(SPOT_CSV_PATH, "utf8").replace(/^\uFEFF/, "");
const [headerLine, ...existingLines] = sourceText.split(/\r?\n/);
const existingHeaders = parseCsvLine(headerLine ?? "");
if (existingHeaders.join("\u0000") !== HEADERS.join("\u0000")) {
  throw new Error(`${SPOT_CSV_PATH} has an unexpected header`);
}

const dateIndex = existingHeaders.indexOf("Trading date");
const pointIndex = existingHeaders.indexOf("Point of connection");
const existingRows = new Map();
let latestExistingDate = "0000-00-00";
for (const line of existingLines) {
  if (!line.trim()) continue;
  const fields = parseCsvLine(line);
  if (fields[pointIndex] !== POINT_OF_CONNECTION) continue;
  const dateText = fields[dateIndex];
  if (dateText > latestExistingDate) latestExistingDate = dateText;
  const periodIndex = existingHeaders.indexOf("Trading period");
  existingRows.set(`${dateText}:${fields[periodIndex]}`, line);
}

const requestedStart = process.argv.indexOf("--from-date");
const anchorDate = latestExistingDate < targetDate ? latestExistingDate : targetDate;
const defaultStartDate = new Date(
  Date.parse(`${anchorDate}T00:00:00Z`) - 7 * 24 * 60 * 60 * 1000,
).toISOString().slice(0, 10);
const startDate = requestedStart === -1
  ? defaultStartDate
  : process.argv[requestedStart + 1];
if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || startDate > targetDate) {
  throw new Error("--from-date must be a valid date no later than the latest meter date");
}

const dates = dateRange(startDate, targetDate);
const downloadedRecords = new Map();
for (let index = 0; index < dates.length; index += 5) {
  const batch = dates.slice(index, index + 5);
  const result = await Promise.all(batch.map(async (dateText) => {
    const filename = `${dateText.replaceAll("-", "")}_FinalEnergyPrices.csv`;
    const sourceUrl = `${SOURCE_BASE_URL}/${filename}`;
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(
        `Could not download final spot prices for ${dateText} (HTTP ${response.status}); no source data was changed.`,
      );
    }
    const records = parseSourceCsv(await response.text(), dateText, sourceUrl);
    return [dateText, records];
  }));
  for (const [dateText, records] of result) {
    for (const [key, row] of records) downloadedRecords.set(key, row);
  }
  console.log(`Downloaded final WIL0331 prices for ${Math.min(index + batch.length, dates.length)}/${dates.length} days.`);
}

for (const [key, row] of downloadedRecords) existingRows.set(key, row);
const orderedRows = [...existingRows.entries()]
  .sort(([a], [b]) => {
    const [dateA, periodA] = a.split(":");
    const [dateB, periodB] = b.split(":");
    return dateA.localeCompare(dateB) || Number(periodA) - Number(periodB);
  })
  .map(([, row]) => row);

const temporaryPath = `${SPOT_CSV_PATH}.tmp`;
writeFileSync(temporaryPath, `${headerLine}\n${orderedRows.join("\n")}\n`);
renameSync(temporaryPath, SPOT_CSV_PATH);

console.log(
  JSON.stringify(
    {
      source: SPOT_CSV_PATH,
      downloadedOfficialDays: dates.length,
      addedOrRefreshedIntervals: downloadedRecords.size,
      meterThrough: targetDate,
      spotThrough: latestExistingDate > targetDate ? latestExistingDate : targetDate,
      latestSourceFile: `${targetDate.replaceAll("-", "")}_FinalEnergyPrices.csv`,
    },
    null,
    2,
  ),
);
