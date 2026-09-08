import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const baseTimestamp = Date.UTC(2024, 0, 1);
const intervalMs = 30 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

const [usage, spot] = await Promise.all([
  readFile(new URL("../public/electricity-data.json", import.meta.url), "utf8").then(
    JSON.parse,
  ),
  readFile(new URL("../public/spot-price-data.json", import.meta.url), "utf8").then(
    JSON.parse,
  ),
]);

function isPeak(timestamp) {
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (
    day >= 1 &&
    day <= 5 &&
    ((minute >= 420 && minute < 660) ||
      (minute >= 1020 && minute < 1260))
  );
}

test("processed spot prices are sorted, unique and finite", () => {
  assert.equal(spot.data.length, spot.meta.intervalCount);
  assert.ok(spot.data.length > 45_000);
  let previousSlot = Number.NEGATIVE_INFINITY;

  for (const [slot, price] of spot.data) {
    assert.ok(slot > previousSlot, `spot slot ${slot} is not unique and sorted`);
    assert.ok(Number.isFinite(price), `spot price for slot ${slot} is not finite`);
    previousSlot = slot;
  }
});

test("spot prices cover essentially all published usage intervals", () => {
  const prices = new Set(spot.data.map(([slot]) => slot));
  const matched = usage.data.filter(([slot]) => prices.has(slot)).length;
  assert.ok(matched / usage.data.length > 0.999);
});

test("default tariff and spot models produce valid comparable totals", () => {
  const prices = new Map(spot.data);
  const lastTimestamp = Date.parse(usage.meta.lastDate);
  const startTimestamp = lastTimestamp - 29 * dayMs;
  let tariffCost = 0;
  let spotEnergyCost = 0;
  let totalUsage = 0;
  let controlledUsage = 0;
  let peakUsage = 0;
  let offpeakUsage = 0;
  let matchedIntervals = 0;
  const includedDays = new Set();

  for (const [slot, controlled, uncontrolled] of usage.data) {
    const timestamp = baseTimestamp + slot * intervalMs;
    if (timestamp < startTimestamp || timestamp > lastTimestamp) continue;
    const spotRate = prices.get(slot);
    if (spotRate === undefined) continue;
    const uncontrolledRate = isPeak(timestamp) ? 39.92 : 26.12;
    tariffCost +=
      (controlled * 28.49 + uncontrolled * uncontrolledRate) / 100;
    spotEnergyCost += ((controlled + uncontrolled) * spotRate) / 100;
    totalUsage += controlled + uncontrolled;
    controlledUsage += controlled;
    if (isPeak(timestamp)) peakUsage += uncontrolled;
    else offpeakUsage += uncontrolled;
    includedDays.add(new Date(timestamp).toISOString().slice(0, 10));
    matchedIntervals += 1;
  }

  const gst = 1.15;
  const spotAddOns =
    includedDays.size * (0.43 + 0.5 + 1.5951) * gst +
    totalUsage * (0.0025 + 0.02) * gst +
    controlledUsage * 0.0325 * gst +
    peakUsage * 0.1451 * gst +
    offpeakUsage * 0.0251 * gst +
    spotEnergyCost * 0.0541;
  const spotCost = spotEnergyCost + spotAddOns;

  assert.ok(matchedIntervals > 1_300);
  assert.ok(Number.isFinite(tariffCost) && tariffCost > 0);
  assert.ok(Number.isFinite(spotCost) && spotCost > 0);
  assert.ok(spotCost > spotEnergyCost);
});
