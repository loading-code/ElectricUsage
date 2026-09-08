"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

type CategoryKey = "controlled" | "peak" | "offpeak";
type DayType = "all" | "weekdays" | "weekends";
type Resolution = "auto" | "hourly" | "daily" | "weekly" | "monthly";
type IntervalRow = [number, number, number];
type SpotRow = [number, number];

export type SpotChargeKey =
  | "meteringDaily"
  | "serviceDaily"
  | "regulatoryLevy"
  | "serviceUnit"
  | "networkOffpeak"
  | "networkPeak"
  | "networkControlled"
  | "networkDaily"
  | "networkLosses";

export type SpotChargeSettings = Record<
  SpotChargeKey,
  { enabled: boolean; value: number }
>;

export const DEFAULT_SPOT_CHARGES: SpotChargeSettings = {
  meteringDaily: { enabled: true, value: 0.43 },
  serviceDaily: { enabled: true, value: 0.5 },
  regulatoryLevy: { enabled: true, value: 0.0025 },
  serviceUnit: { enabled: true, value: 0.02 },
  networkOffpeak: { enabled: true, value: 0.0251 },
  networkPeak: { enabled: true, value: 0.1451 },
  networkControlled: { enabled: true, value: 0.0325 },
  networkDaily: { enabled: true, value: 1.5951 },
  networkLosses: { enabled: true, value: 5.41 },
};

const SPOT_CHARGE_META: Record<
  SpotChargeKey,
  { label: string; basis: string; unit: string; step: string; gst: boolean }
> = {
  meteringDaily: {
    label: "Metering fee",
    basis: "Per included day",
    unit: "$/day",
    step: "0.01",
    gst: true,
  },
  serviceDaily: {
    label: "Service fee (daily)",
    basis: "Per included day",
    unit: "$/day",
    step: "0.01",
    gst: true,
  },
  regulatoryLevy: {
    label: "Regulatory levies",
    basis: "All selected usage",
    unit: "$/kWh",
    step: "0.0001",
    gst: true,
  },
  serviceUnit: {
    label: "Service fee (unit)",
    basis: "All selected usage",
    unit: "$/kWh",
    step: "0.001",
    gst: true,
  },
  networkOffpeak: {
    label: "Network delivery — off-peak",
    basis: "Off-peak uncontrolled usage",
    unit: "$/kWh",
    step: "0.0001",
    gst: true,
  },
  networkPeak: {
    label: "Network delivery — peak",
    basis: "Peak uncontrolled usage",
    unit: "$/kWh",
    step: "0.0001",
    gst: true,
  },
  networkControlled: {
    label: "Network delivery — controlled",
    basis: "All controlled-meter usage",
    unit: "$/kWh",
    step: "0.0001",
    gst: true,
  },
  networkDaily: {
    label: "Network delivery — daily charge",
    basis: "Per included day",
    unit: "$/day",
    step: "0.0001",
    gst: true,
  },
  networkLosses: {
    label: "Network losses",
    basis: "Extra spot energy on all usage",
    unit: "%",
    step: "0.01",
    gst: false,
  },
};

const spotChargeKeys = Object.keys(SPOT_CHARGE_META) as SpotChargeKey[];
const GST_MULTIPLIER = 1.15;

type UsageDataset = {
  data: IntervalRow[];
};

type SpotDataset = {
  meta: {
    source: string;
    pointOfConnection: string;
    firstDate: string;
    lastDate: string;
    intervalCount: number;
    duplicateIntervalCount: number;
    priceUnit: string;
  };
  data: SpotRow[];
};

type CostRow = {
  slot: number;
  timestamp: number;
  controlled: number;
  uncontrolled: number;
  usage: number;
  tariffLabel: string;
  tariffRate: number;
  spotRate: number;
  tariffEnergyCost: number;
  tariffDailyCost: number;
  tariffCost: number;
  spotEnergyCost: number;
  chargeCosts: Record<SpotChargeKey, number>;
  spotCost: number;
};

type CostPoint = {
  timestamp: number;
  label: string;
  tariff: number;
  spot: number;
};

type CostComparisonProps = {
  dataset: UsageDataset;
  startDate: string;
  endDate: string;
  dayType: DayType;
  startMinute: number;
  endMinute: number;
  enabled: Record<CategoryKey, boolean>;
  rates: Record<CategoryKey, number>;
  tariffDailyCharge: number;
  spotCharges: SpotChargeSettings;
  onSpotChargesChange: (settings: SpotChargeSettings) => void;
  onResetSpotCharges: () => void;
  resolution: Resolution;
  onResolutionChange: (resolution: Resolution) => void;
};

const BASE_TIMESTAMP = Date.UTC(2024, 0, 1);
const INTERVAL_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const money = new Intl.NumberFormat("en-NZ", {
  style: "currency",
  currency: "NZD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactMoney = new Intl.NumberFormat("en-NZ", {
  style: "currency",
  currency: "NZD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const decimal = new Intl.NumberFormat("en-NZ", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const intervalMoney = new Intl.NumberFormat("en-NZ", {
  style: "currency",
  currency: "NZD",
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

const dateFormat = new Intl.DateTimeFormat("en-NZ", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const shortDate = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const monthFormat = new Intl.DateTimeFormat("en-NZ", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function inputDateToTimestamp(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function toInputDate(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate(),
  )}`;
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function isPeakPeriod(timestamp: number) {
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (
    day >= 1 &&
    day <= 5 &&
    ((minute >= 7 * 60 && minute < 11 * 60) ||
      (minute >= 17 * 60 && minute < 21 * 60))
  );
}

function passesDayType(timestamp: number, dayType: DayType) {
  if (dayType === "all") return true;
  const day = new Date(timestamp).getUTCDay();
  const weekend = day === 0 || day === 6;
  return dayType === "weekends" ? weekend : !weekend;
}

function passesTimeWindow(
  timestamp: number,
  startMinute: number,
  endMinute: number,
) {
  if (startMinute === 0 && endMinute === 1440) return true;
  const date = new Date(timestamp);
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (startMinute < endMinute) {
    return minute >= startMinute && minute < endMinute;
  }
  return minute >= startMinute || minute < endMinute;
}

function startOfBucket(
  timestamp: number,
  resolution: Exclude<Resolution, "auto">,
) {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  if (resolution === "hourly") {
    return Date.UTC(year, month, day, date.getUTCHours());
  }
  if (resolution === "monthly") return Date.UTC(year, month, 1);
  if (resolution === "weekly") {
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    return Date.UTC(year, month, day - mondayOffset);
  }
  return Date.UTC(year, month, day);
}

function resolveResolution(
  resolution: Resolution,
  dateSpan: number,
): Exclude<Resolution, "auto"> {
  if (resolution !== "auto") return resolution;
  if (dateSpan > 420) return "monthly";
  if (dateSpan > 100) return "weekly";
  return "daily";
}

function bucketLabel(
  timestamp: number,
  resolution: Exclude<Resolution, "auto">,
) {
  if (resolution === "hourly") {
    return `${shortDate.format(timestamp)} ${pad(
      new Date(timestamp).getUTCHours(),
    )}:00`;
  }
  if (resolution === "monthly") return monthFormat.format(timestamp);
  if (resolution === "weekly") return `W/C ${shortDate.format(timestamp)}`;
  return shortDate.format(timestamp);
}

function selectedValues(
  timestamp: number,
  controlled: number,
  uncontrolled: number,
  enabled: Record<CategoryKey, boolean>,
) {
  const peak = isPeakPeriod(timestamp);
  const selectedControlled = enabled.controlled ? controlled : 0;
  const selectedUncontrolled = peak
    ? enabled.peak
      ? uncontrolled
      : 0
    : enabled.offpeak
      ? uncontrolled
      : 0;
  return {
    controlled: selectedControlled,
    uncontrolled: selectedUncontrolled,
    peak,
    usage: selectedControlled + selectedUncontrolled,
  };
}

function emptyChargeCosts() {
  return Object.fromEntries(
    spotChargeKeys.map((key) => [key, 0]),
  ) as Record<SpotChargeKey, number>;
}

function createCostRow(
  row: IntervalRow,
  spotRate: number,
  enabled: Record<CategoryKey, boolean>,
  rates: Record<CategoryKey, number>,
  tariffDailyCharge: number,
  spotCharges: SpotChargeSettings,
  dailyDivisor = 0,
): CostRow {
  const [slot, controlled, uncontrolled] = row;
  const timestamp = BASE_TIMESTAMP + slot * INTERVAL_MS;
  const selected = selectedValues(
    timestamp,
    controlled,
    uncontrolled,
    enabled,
  );
  const uncontrolledRate = selected.peak ? rates.peak : rates.offpeak;
  const tariffEnergyCost =
      (selected.controlled * rates.controlled +
        selected.uncontrolled * uncontrolledRate) /
      100;
  const tariffDailyCost =
    dailyDivisor > 0 ? tariffDailyCharge / dailyDivisor : 0;
  const tariffCost = tariffEnergyCost + tariffDailyCost;
  const spotEnergyCost = (selected.usage * spotRate) / 100;
  const chargeCosts = emptyChargeCosts();
  const withGst = (key: SpotChargeKey, amount: number) =>
    spotCharges[key].enabled
      ? amount * (SPOT_CHARGE_META[key].gst ? GST_MULTIPLIER : 1)
      : 0;

  chargeCosts.regulatoryLevy = withGst(
    "regulatoryLevy",
    selected.usage * spotCharges.regulatoryLevy.value,
  );
  chargeCosts.serviceUnit = withGst(
    "serviceUnit",
    selected.usage * spotCharges.serviceUnit.value,
  );
  chargeCosts.networkControlled = withGst(
    "networkControlled",
    selected.controlled * spotCharges.networkControlled.value,
  );
  chargeCosts.networkPeak = withGst(
    "networkPeak",
    (selected.peak ? selected.uncontrolled : 0) * spotCharges.networkPeak.value,
  );
  chargeCosts.networkOffpeak = withGst(
    "networkOffpeak",
    (!selected.peak ? selected.uncontrolled : 0) *
      spotCharges.networkOffpeak.value,
  );
  chargeCosts.networkLosses = spotCharges.networkLosses.enabled
    ? spotEnergyCost * (spotCharges.networkLosses.value / 100)
    : 0;

  if (dailyDivisor > 0) {
    chargeCosts.meteringDaily = withGst(
      "meteringDaily",
      spotCharges.meteringDaily.value / dailyDivisor,
    );
    chargeCosts.serviceDaily = withGst(
      "serviceDaily",
      spotCharges.serviceDaily.value / dailyDivisor,
    );
    chargeCosts.networkDaily = withGst(
      "networkDaily",
      spotCharges.networkDaily.value / dailyDivisor,
    );
  }

  const spotCost =
    spotEnergyCost +
    spotChargeKeys.reduce((total, key) => total + chargeCosts[key], 0);
  const labels = [];
  if (selected.controlled > 0) labels.push("Controlled");
  if (selected.uncontrolled > 0) {
    labels.push(selected.peak ? "Peak" : "Off-peak");
  }

  return {
    slot,
    timestamp,
    controlled: selected.controlled,
    uncontrolled: selected.uncontrolled,
    usage: selected.usage,
    tariffLabel: labels.join(" + ") || (selected.peak ? "Peak" : "Off-peak"),
    tariffRate:
      selected.usage > 0
        ? (tariffEnergyCost * 100) / selected.usage
        : uncontrolledRate,
    spotRate,
    tariffEnergyCost,
    tariffDailyCost,
    tariffCost,
    spotEnergyCost,
    chargeCosts,
    spotCost,
  };
}

function CostTrendChart({
  data,
  selectedDay,
  onSelectDay,
  daily,
}: {
  data: CostPoint[];
  selectedDay: string;
  onSelectDay: (date: string) => void;
  daily: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(bounds.width, 300);
      const height = Math.max(bounds.height, 280);
      const scale = window.devicePixelRatio || 1;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(scale, scale);
      context.clearRect(0, 0, width, height);

      const padding = { top: 18, right: 12, bottom: 38, left: 58 };
      const plotWidth = width - padding.left - padding.right;
      const plotHeight = height - padding.top - padding.bottom;
      const maximum = Math.max(
        1,
        ...data.flatMap((point) => [point.tariff, point.spot]),
      );
      const axisMaximum = maximum * 1.12;

      context.font = "11px Arial, sans-serif";
      context.textBaseline = "middle";
      for (let index = 0; index <= 4; index += 1) {
        const y = padding.top + (plotHeight / 4) * index;
        const value = axisMaximum * (1 - index / 4);
        context.strokeStyle = "#E3E8E7";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();
        context.fillStyle = "#6E7D7C";
        context.textAlign = "right";
        context.fillText(compactMoney.format(value), padding.left - 9, y);
      }

      if (data.length === 0) return;
      const step = plotWidth / data.length;
      const groupWidth = Math.max(4, Math.min(30, step * 0.78));
      const gap = Math.max(1, Math.min(3, step * 0.08));
      const barWidth = Math.max(1, (groupWidth - gap) / 2);

      data.forEach((point, index) => {
        const centre = padding.left + step * index + step / 2;
        const values = [
          { value: point.tariff, color: "#176B87", x: centre - gap / 2 - barWidth },
          { value: point.spot, color: "#E3A82B", x: centre + gap / 2 },
        ];
        values.forEach(({ value, color, x }) => {
          const barHeight = (value / axisMaximum) * plotHeight;
          context.fillStyle = color;
          context.fillRect(
            x,
            padding.top + plotHeight - barHeight,
            barWidth,
            barHeight,
          );
        });

        if (
          daily &&
          toInputDate(point.timestamp) === selectedDay
        ) {
          context.strokeStyle = "#163332";
          context.lineWidth = 2;
          context.strokeRect(
            centre - groupWidth / 2 - 2,
            padding.top + 1,
            groupWidth + 4,
            plotHeight - 1,
          );
        }

        if (hoveredIndex === index) {
          context.fillStyle = "rgba(22, 51, 50, 0.08)";
          context.fillRect(
            centre - step / 2,
            padding.top,
            step,
            plotHeight,
          );
        }
      });

      const tickCount = Math.min(6, data.length);
      for (let tick = 0; tick < tickCount; tick += 1) {
        const index =
          tickCount === 1
            ? 0
            : Math.round((tick / (tickCount - 1)) * (data.length - 1));
        const x = padding.left + step * index + step / 2;
        context.fillStyle = "#6E7D7C";
        context.textAlign = "center";
        context.fillText(data[index].label, x, height - 14);
      }
    };

    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [data, hoveredIndex, selectedDay, daily]);

  const indexAtEvent = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (data.length === 0) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    const relative = event.clientX - bounds.left - 58;
    const plotWidth = bounds.width - 58 - 12;
    return Math.max(
      0,
      Math.min(data.length - 1, Math.floor((relative / plotWidth) * data.length)),
    );
  };

  const hovered =
    hoveredIndex !== null && data[hoveredIndex] ? data[hoveredIndex] : null;

  return (
    <div className="chart-wrap cost-chart-wrap">
      <canvas
        ref={canvasRef}
        className={`chart-canvas cost-chart ${daily ? "cost-chart-clickable" : ""}`}
        role="img"
        aria-label="Grouped chart comparing tariff and spot-price electricity costs"
        onMouseMove={(event) => setHoveredIndex(indexAtEvent(event))}
        onMouseLeave={() => setHoveredIndex(null)}
        onClick={(event) => {
          if (!daily) return;
          const index = indexAtEvent(event);
          if (index !== null) onSelectDay(toInputDate(data[index].timestamp));
        }}
      />
      {hovered ? (
        <div
          className={`chart-tooltip cost-chart-tooltip ${
            hoveredIndex !== null && hoveredIndex > data.length * 0.65
              ? "chart-tooltip-left"
              : ""
          }`}
          style={{
            left: `${(((hoveredIndex ?? 0) + 0.5) / Math.max(data.length, 1)) * 100}%`,
          }}
        >
          <strong>{hovered.label}</strong>
          <span>
            <i style={{ background: "#176B87" }} />Tariff
            <b>{money.format(hovered.tariff)}</b>
          </span>
          <span>
            <i style={{ background: "#E3A82B" }} />Spot
            <b>{money.format(hovered.spot)}</b>
          </span>
          {daily ? <em>Click to inspect this day</em> : null}
        </div>
      ) : null}
    </div>
  );
}

function IntervalRanking({
  title,
  eyebrow,
  rows,
}: {
  title: string;
  eyebrow: string;
  rows: CostRow[];
}) {
  return (
    <section className="panel interval-ranking">
      <span className="eyebrow">{eyebrow}</span>
      <h3>{title}</h3>
      <p>Ranked by spot total after filters and allocated daily charges.</p>
      <div className="cost-table-wrap">
        <table className="cost-table compact-cost-table">
          <thead>
            <tr>
              <th>Interval</th>
              <th className="numeric">Usage</th>
              <th className="numeric">Spot rate</th>
              <th className="numeric">Tariff</th>
              <th className="numeric">Spot total</th>
              <th className="numeric">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.slot}>
                <td>
                  <strong>{shortDate.format(row.timestamp)}</strong>
                  <small>{formatTime(row.timestamp)}</small>
                </td>
                <td className="numeric">{decimal.format(row.usage)} kWh</td>
                <td className="numeric">{decimal.format(row.spotRate)}c</td>
                <td className="numeric">{intervalMoney.format(row.tariffCost)}</td>
                <td className="numeric">{intervalMoney.format(row.spotCost)}</td>
                <td
                  className={`numeric ${
                    row.spotCost > row.tariffCost ? "change-up" : "change-down"
                  }`}
                >
                  {intervalMoney.format(row.spotCost - row.tariffCost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SpotChargeControls({
  settings,
  totals,
  spotEnergyCost,
  onChange,
  onReset,
}: {
  settings: SpotChargeSettings;
  totals: Record<SpotChargeKey, number>;
  spotEnergyCost: number;
  onChange: (settings: SpotChargeSettings) => void;
  onReset: () => void;
}) {
  const enabledChargeTotal = spotChargeKeys.reduce(
    (total, key) => total + totals[key],
    0,
  );

  return (
    <section className="panel spot-charge-panel">
      <div className="charge-panel-heading">
        <div>
          <span className="eyebrow">Spot-plan inputs</span>
          <h2>Fees, delivery and losses</h2>
          <p>
            Toggle any line on or off and edit its rate. Dollar inputs marked
            + GST have 15% added in the calculation.
          </p>
        </div>
        <button type="button" className="charge-reset" onClick={onReset}>
          Restore defaults
        </button>
      </div>

      <div className="charge-control-grid">
        {spotChargeKeys.map((key) => {
          const meta = SPOT_CHARGE_META[key];
          const setting = settings[key];
          return (
            <article
              className={`charge-control ${
                setting.enabled ? "charge-control-enabled" : ""
              }`}
              key={key}
            >
              <button
                type="button"
                className="charge-switch"
                aria-pressed={setting.enabled}
                aria-label={`${setting.enabled ? "Disable" : "Enable"} ${meta.label}`}
                onClick={() =>
                  onChange({
                    ...settings,
                    [key]: { ...setting, enabled: !setting.enabled },
                  })
                }
              >
                <span>{setting.enabled ? "✓" : ""}</span>
              </button>
              <div className="charge-control-copy">
                <strong>{meta.label}</strong>
                <small>
                  {meta.basis}{meta.gst ? " · + GST" : ""}
                </small>
              </div>
              <label className="charge-value">
                <span className="sr-only">{meta.label} rate</span>
                <input
                  type="number"
                  min="0"
                  step={meta.step}
                  value={setting.value}
                  disabled={!setting.enabled}
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      [key]: {
                        ...setting,
                        value: Math.max(0, Number(event.target.value)),
                      },
                    })
                  }
                />
                <span>{meta.unit}</span>
              </label>
              <b className="charge-contribution">
                {setting.enabled ? money.format(totals[key]) : "Excluded"}
              </b>
            </article>
          );
        })}
      </div>

      <div className="spot-cost-reconciliation">
        <span>
          <small>Settled spot energy</small>
          <strong>{money.format(spotEnergyCost)}</strong>
        </span>
        <i aria-hidden="true">+</i>
        <span>
          <small>Enabled fees and losses</small>
          <strong>{money.format(enabledChargeTotal)}</strong>
        </span>
        <i aria-hidden="true">=</i>
        <span className="reconciliation-total">
          <small>Spot model total</small>
          <strong>{money.format(spotEnergyCost + enabledChargeTotal)}</strong>
        </span>
      </div>
    </section>
  );
}

export default function CostComparison({
  dataset,
  startDate,
  endDate,
  dayType,
  startMinute,
  endMinute,
  enabled,
  rates,
  tariffDailyCharge,
  spotCharges,
  onSpotChargesChange,
  onResetSpotCharges,
  resolution,
  onResolutionChange,
}: CostComparisonProps) {
  const [spotDataset, setSpotDataset] = useState<SpotDataset | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selectedDay, setSelectedDay] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("./spot-price-data.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("The spot-price data could not be loaded.");
        return response.json() as Promise<SpotDataset>;
      })
      .then(setSpotDataset)
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      });
    return () => controller.abort();
  }, []);

  const analysis = useMemo(() => {
    if (!spotDataset) return null;
    const startTimestamp = inputDateToTimestamp(startDate);
    const endTimestamp = inputDateToTimestamp(endDate) + DAY_MS;
    const dateSpan = Math.max(1, Math.round((endTimestamp - startTimestamp) / DAY_MS));
    const requestedResolution =
      resolution === "hourly" && dateSpan > 7 ? "auto" : resolution;
    const activeResolution = resolveResolution(requestedResolution, dateSpan);
    const priceMap = new Map<number, number>(spotDataset.data);
    const usageMap = new Map<number, IntervalRow>(
      dataset.data.map((row) => [row[0], row]),
    );
    const matchedRows: { row: IntervalRow; spotRate: number }[] = [];
    let eligibleIntervals = 0;

    dataset.data.forEach((row) => {
      const timestamp = BASE_TIMESTAMP + row[0] * INTERVAL_MS;
      if (timestamp < startTimestamp || timestamp >= endTimestamp) return;
      if (!passesDayType(timestamp, dayType)) return;
      if (!passesTimeWindow(timestamp, startMinute, endMinute)) return;
      eligibleIntervals += 1;
      const spotRate = priceMap.get(row[0]);
      if (spotRate === undefined) return;
      matchedRows.push({ row, spotRate });
    });

    const dailyIntervalCounts = new Map<number, number>();
    matchedRows.forEach(({ row }) => {
      const timestamp = BASE_TIMESTAMP + row[0] * INTERVAL_MS;
      const dayStart = startOfBucket(timestamp, "daily");
      dailyIntervalCounts.set(
        dayStart,
        (dailyIntervalCounts.get(dayStart) ?? 0) + 1,
      );
    });
    const rows = matchedRows.map(({ row, spotRate }) => {
      const timestamp = BASE_TIMESTAMP + row[0] * INTERVAL_MS;
      const dayStart = startOfBucket(timestamp, "daily");
      return createCostRow(
        row,
        spotRate,
        enabled,
        rates,
        tariffDailyCharge,
        spotCharges,
        dailyIntervalCounts.get(dayStart) ?? 0,
      );
    });

    const buckets = new Map<number, CostPoint>();
    const availableDaySet = new Set<number>();
    rows.forEach((row) => {
      const dayStart = startOfBucket(row.timestamp, "daily");
      availableDaySet.add(dayStart);
      const key = startOfBucket(row.timestamp, activeResolution);
      const bucket = buckets.get(key) ?? {
        timestamp: key,
        label: bucketLabel(key, activeResolution),
        tariff: 0,
        spot: 0,
      };
      bucket.tariff += row.tariffCost;
      bucket.spot += row.spotCost;
      buckets.set(key, bucket);
    });

    const tariffCost = rows.reduce((total, row) => total + row.tariffCost, 0);
    const tariffEnergyCost = rows.reduce(
      (total, row) => total + row.tariffEnergyCost,
      0,
    );
    const tariffDailyCost = rows.reduce(
      (total, row) => total + row.tariffDailyCost,
      0,
    );
    const spotEnergyCost = rows.reduce(
      (total, row) => total + row.spotEnergyCost,
      0,
    );
    const chargeTotals = Object.fromEntries(
      spotChargeKeys.map((key) => [
        key,
        rows.reduce((total, row) => total + row.chargeCosts[key], 0),
      ]),
    ) as Record<SpotChargeKey, number>;
    const spotCost = rows.reduce((total, row) => total + row.spotCost, 0);
    const totalUsage = rows.reduce((total, row) => total + row.usage, 0);
    const ranked = rows.filter((row) => row.usage > 0);
    const highest = [...ranked]
      .sort((a, b) => b.spotCost - a.spotCost)
      .slice(0, 5);
    const lowest = [...ranked]
      .sort((a, b) => a.spotCost - b.spotCost)
      .slice(0, 5);
    const availableDays = [...availableDaySet]
      .sort((a, b) => a - b)
      .map(toInputDate);

    return {
      rows,
      priceMap,
      usageMap,
      tariffCost,
      tariffEnergyCost,
      tariffDailyCost,
      spotEnergyCost,
      chargeTotals,
      spotCost,
      difference: spotCost - tariffCost,
      totalUsage,
      tariffUnitCost: totalUsage ? (tariffCost * 100) / totalUsage : 0,
      spotUnitCost: totalUsage ? (spotCost * 100) / totalUsage : 0,
      coverage: eligibleIntervals ? (rows.length / eligibleIntervals) * 100 : 0,
      pricedIntervals: rows.length,
      eligibleIntervals,
      trend: [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp),
      activeResolution,
      dateSpan,
      availableDays,
      highest,
      lowest,
    };
  }, [
    dataset,
    spotDataset,
    startDate,
    endDate,
    dayType,
    startMinute,
    endMinute,
    enabled,
    rates,
    tariffDailyCharge,
    spotCharges,
    resolution,
  ]);

  const effectiveSelectedDay = analysis?.availableDays.includes(selectedDay)
    ? selectedDay
    : (analysis?.availableDays.at(-1) ?? "");

  const dayRows = useMemo(() => {
    if (!analysis || !effectiveSelectedDay) return [];
    const dayStart = inputDateToTimestamp(effectiveSelectedDay);
    const candidates = Array.from({ length: 48 }, (_, index) => {
      const timestamp = dayStart + index * INTERVAL_MS;
      const slot = Math.round((timestamp - BASE_TIMESTAMP) / INTERVAL_MS);
      const usageRow = analysis.usageMap.get(slot) ?? ([slot, 0, 0] as IntervalRow);
      const price = analysis.priceMap.get(slot);
      return { usageRow, price };
    });
    const pricedIntervalCount = candidates.filter(
      ({ price }) => price !== undefined,
    ).length;

    return candidates.map(({ usageRow, price }) => {
      return price === undefined
        ? {
            ...createCostRow(
              usageRow,
              0,
              enabled,
              rates,
              tariffDailyCharge,
              spotCharges,
            ),
            spotRate: Number.NaN,
            spotEnergyCost: Number.NaN,
            chargeCosts: emptyChargeCosts(),
            spotCost: Number.NaN,
          }
        : createCostRow(
            usageRow,
            price,
            enabled,
            rates,
            tariffDailyCharge,
            spotCharges,
            pricedIntervalCount,
          );
    });
  }, [
    analysis,
    effectiveSelectedDay,
    enabled,
    rates,
    tariffDailyCharge,
    spotCharges,
  ]);

  const dayTotals = useMemo(
    () => ({
      usage: dayRows.reduce((total, row) => total + row.usage, 0),
      tariff: dayRows.reduce((total, row) => total + row.tariffCost, 0),
      spotEnergy: dayRows.reduce(
        (total, row) =>
          total + (Number.isFinite(row.spotEnergyCost) ? row.spotEnergyCost : 0),
        0,
      ),
      spot: dayRows.reduce(
        (total, row) => total + (Number.isFinite(row.spotCost) ? row.spotCost : 0),
        0,
      ),
    }),
    [dayRows],
  );

  if (loadError) {
    return (
      <section className="panel cost-state">
        <span className="state-mark">!</span>
        <div>
          <h2>Spot prices unavailable</h2>
          <p>{loadError}</p>
        </div>
      </section>
    );
  }

  if (!spotDataset || !analysis) {
    return (
      <section className="panel cost-state">
        <span className="loader" />
        <div>
          <h2>Matching prices to your usage</h2>
          <p>Aligning each half-hour meter reading with Wellington spot prices…</p>
        </div>
      </section>
    );
  }

  if (analysis.pricedIntervals === 0) {
    const noEligibleUsage = analysis.eligibleIntervals === 0;
    return (
      <section className="panel cost-state">
        <span className="state-mark">i</span>
        <div>
          <h2>
            {noEligibleUsage
              ? "No usage matches these filters"
              : "No matching spot prices for these dates"}
          </h2>
          {noEligibleUsage ? (
            <p>Adjust the date, day or time filters to include usage intervals.</p>
          ) : (
            <p>
              Usage is available for the selected period, but the supplied
              spot-price data currently ends on{" "}
              {dateFormat.format(Date.parse(spotDataset.meta.lastDate))}. Choose an
              earlier date range to compare the two cost models.
            </p>
          )}
        </div>
      </section>
    );
  }

  const spotIsCheaper = analysis.spotCost < analysis.tariffCost;
  const winner = spotIsCheaper ? "Spot pricing" : "Peak / off-peak tariff";
  const saving = Math.abs(analysis.difference);
  const selectedDayIndex = analysis.availableDays.indexOf(effectiveSelectedDay);

  return (
    <div className="cost-comparison-view">
      <section className="cost-hero panel">
        <div>
          <span className="eyebrow">Full spot-plan cost comparison</span>
          <h1>Which pricing model costs less?</h1>
          <p>
            Every selected half-hour with a matching settled Wellington spot price
            is priced once with each model, including enabled fees, network delivery
            and losses.
          </p>
        </div>
        <div className={`winner-card ${spotIsCheaper ? "winner-spot" : "winner-tariff"}`}>
          <span>Lower-cost model</span>
          <strong>{winner}</strong>
          <b>{money.format(saving)} less</b>
        </div>
      </section>

      <section className="kpi-grid cost-kpi-grid" aria-label="Cost comparison summary">
        <article className="kpi-card kpi-primary">
          <div className="kpi-topline">
            <span>Tariff model</span>
            <span className="kpi-icon">T</span>
          </div>
          <strong>{money.format(analysis.tariffCost)}</strong>
          <small className="kpi-cost-breakdown">
            {money.format(analysis.tariffEnergyCost)} usage +{" "}
            {money.format(analysis.tariffDailyCost)} daily ·{" "}
            {decimal.format(analysis.tariffUnitCost)} c/kWh effective
          </small>
        </article>
        <article className="kpi-card cost-kpi-spot">
          <div className="kpi-topline">
            <span>Spot-price model</span>
            <span className="kpi-icon">S</span>
          </div>
          <strong>{money.format(analysis.spotCost)}</strong>
          <small>{decimal.format(analysis.spotUnitCost)} c/kWh effective rate</small>
        </article>
        <article className="kpi-card">
          <div className="kpi-topline">
            <span>Cost difference</span>
            <span className="kpi-icon">Δ</span>
          </div>
          <strong className={spotIsCheaper ? "change-down" : "change-up"}>
            {money.format(saving)}
          </strong>
          <small>{winner} is cheaper for the matched usage</small>
        </article>
        <article className="kpi-card">
          <div className="kpi-topline">
            <span>Matched coverage</span>
            <span className="kpi-icon">✓</span>
          </div>
          <strong>{analysis.coverage.toFixed(1)}%</strong>
          <small>
            {analysis.pricedIntervals.toLocaleString("en-NZ")} of{" "}
            {analysis.eligibleIntervals.toLocaleString("en-NZ")} intervals
          </small>
        </article>
      </section>

      <SpotChargeControls
        settings={spotCharges}
        totals={analysis.chargeTotals}
        spotEnergyCost={analysis.spotEnergyCost}
        onChange={onSpotChargesChange}
        onReset={onResetSpotCharges}
      />

      <section className="panel trend-panel cost-trend-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Cost over time</span>
            <h2>Tariff vs spot cost</h2>
          </div>
          <label className="resolution-select">
            Group by
            <select
              value={
                resolution === "hourly" && analysis.dateSpan > 7
                  ? "auto"
                  : resolution
              }
              onChange={(event) =>
                onResolutionChange(event.target.value as Resolution)
              }
            >
              <option value="auto">Auto ({analysis.activeResolution})</option>
              {analysis.dateSpan <= 7 ? <option value="hourly">Hour</option> : null}
              <option value="daily">Day</option>
              <option value="weekly">Week</option>
              <option value="monthly">Month</option>
            </select>
          </label>
        </div>
        <div className="chart-legend cost-chart-legend">
          <span><i style={{ background: "#176B87" }} />Tariff model</span>
          <span><i style={{ background: "#E3A82B" }} />Spot-price model</span>
          <small>NZD</small>
        </div>
        <CostTrendChart
          data={analysis.trend}
          selectedDay={effectiveSelectedDay}
          onSelectDay={setSelectedDay}
          daily={analysis.activeResolution === "daily"}
        />
        <p className="chart-help">
          {analysis.activeResolution === "daily"
            ? "Click any pair of bars to open that day’s half-hour breakdown."
            : "Choose a day below to inspect every half-hour, or group this chart by day."}
        </p>
      </section>

      <section className="panel day-drill-panel">
        <div className="day-drill-heading">
          <div>
            <span className="eyebrow">Daily drill-down</span>
            <h2>Half-hour cost breakdown</h2>
            <p>The full day is shown here, even when a time-of-day filter is active.</p>
          </div>
          <div className="day-picker">
            <button
              type="button"
              aria-label="Previous available day"
              disabled={selectedDayIndex <= 0}
              onClick={() => setSelectedDay(analysis.availableDays[selectedDayIndex - 1])}
            >
              ←
            </button>
            <label>
              Selected day
              <select
                value={effectiveSelectedDay}
                onChange={(event) => setSelectedDay(event.target.value)}
              >
                {analysis.availableDays.map((day) => (
                  <option value={day} key={day}>
                    {dateFormat.format(inputDateToTimestamp(day))}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              aria-label="Next available day"
              disabled={
                selectedDayIndex === -1 ||
                selectedDayIndex >= analysis.availableDays.length - 1
              }
              onClick={() => setSelectedDay(analysis.availableDays[selectedDayIndex + 1])}
            >
              →
            </button>
          </div>
        </div>

        <div className="day-summary" aria-label="Selected day totals">
          <span><b>{decimal.format(dayTotals.usage)} kWh</b>Total usage</span>
          <span><b>{money.format(dayTotals.tariff)}</b>Tariff cost</span>
          <span><b>{money.format(dayTotals.spot)}</b>Spot cost</span>
          <span className={dayTotals.spot > dayTotals.tariff ? "change-up" : "change-down"}>
            <b>{money.format(Math.abs(dayTotals.spot - dayTotals.tariff))}</b>
            {dayTotals.spot > dayTotals.tariff ? "Tariff cheaper" : "Spot cheaper"}
          </span>
        </div>

        <div className="cost-table-wrap day-cost-table-wrap">
          <table className="cost-table day-cost-table">
            <thead>
              <tr>
                <th>Half-hour</th>
                <th>Tariff period</th>
                <th className="numeric">Controlled</th>
                <th className="numeric">Uncontrolled</th>
                <th className="numeric">Tariff rate</th>
                <th className="numeric">Spot rate</th>
                <th className="numeric">Tariff energy</th>
                <th className="numeric">Tariff daily</th>
                <th className="numeric">Tariff total</th>
                <th className="numeric">Spot energy</th>
                <th className="numeric">Add-ons</th>
                <th className="numeric">Spot total</th>
                <th className="numeric">Difference</th>
              </tr>
            </thead>
            <tbody>
              {dayRows.map((row) => (
                <tr key={row.slot}>
                  <td><strong>{formatTime(row.timestamp)}</strong></td>
                  <td><span className={`period-tag period-${isPeakPeriod(row.timestamp) ? "peak" : "offpeak"}`}>{row.tariffLabel}</span></td>
                  <td className="numeric">{decimal.format(row.controlled)}</td>
                  <td className="numeric">{decimal.format(row.uncontrolled)}</td>
                  <td className="numeric">{decimal.format(row.tariffRate)}c</td>
                  <td className="numeric">
                    {Number.isFinite(row.spotRate) ? `${decimal.format(row.spotRate)}c` : "—"}
                  </td>
                  <td className="numeric">
                    {intervalMoney.format(row.tariffEnergyCost)}
                  </td>
                  <td className="numeric">
                    {intervalMoney.format(row.tariffDailyCost)}
                  </td>
                  <td className="numeric">{intervalMoney.format(row.tariffCost)}</td>
                  <td className="numeric">
                    {Number.isFinite(row.spotEnergyCost)
                      ? intervalMoney.format(row.spotEnergyCost)
                      : "—"}
                  </td>
                  <td className="numeric">
                    {Number.isFinite(row.spotCost)
                      ? intervalMoney.format(row.spotCost - row.spotEnergyCost)
                      : "—"}
                  </td>
                  <td className="numeric">
                    {Number.isFinite(row.spotCost) ? intervalMoney.format(row.spotCost) : "—"}
                  </td>
                  <td
                    className={`numeric ${
                      Number.isFinite(row.spotCost) && row.spotCost > row.tariffCost
                        ? "change-up"
                        : "change-down"
                    }`}
                  >
                    {Number.isFinite(row.spotCost)
                      ? intervalMoney.format(row.spotCost - row.tariffCost)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="interval-extremes-grid">
        <IntervalRanking
          eyebrow="Highest cost"
          title="Most expensive spot half-hours"
          rows={analysis.highest}
        />
        <IntervalRanking
          eyebrow="Lowest cost"
          title="Least expensive spot half-hours"
          rows={analysis.lowest}
        />
      </div>

      <footer className="cost-footer">
        <p>
          Spot pricing applies the settled {spotDataset.meta.pointOfConnection}
          price to selected usage with a matching half-hour price.
          The tariff applies controlled, peak and off-peak rates plus its editable
          GST-inclusive daily charge. All daily charges are charged once per
          included day and allocated evenly across its displayed half-hours. GST is
          applied only to spot add-ons marked + GST; base spot and tariff rates are
          unchanged.
        </p>
        <span>
          Spot source: {spotDataset.meta.pointOfConnection} · through{" "}
          {dateFormat.format(Date.parse(spotDataset.meta.lastDate))}
        </span>
      </footer>
    </div>
  );
}
