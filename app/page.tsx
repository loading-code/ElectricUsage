"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import CostComparison, {
  DEFAULT_SPOT_CHARGES,
  type SpotChargeSettings,
} from "./cost-comparison";

type CategoryKey = "controlled" | "peak" | "offpeak";
type DayType = "all" | "weekdays" | "weekends";
type Resolution = "auto" | "hourly" | "daily" | "weekly" | "monthly";
type DashboardView = "usage" | "cost";
type IntervalRow = [number, number, number];

type Dataset = {
  meta: {
    source: string;
    generatedAt: string;
    intervalMinutes: number;
    baseDate: string;
    firstDate: string;
    lastDate: string;
    detailRows: number;
    intervalCount: number;
    duplicateIntervalCount: number;
    skippedRows: number;
  };
  data: IntervalRow[];
};

type SeriesPoint = {
  label: string;
  controlled: number;
  peak: number;
  offpeak: number;
};

const BASE_TIMESTAMP = Date.UTC(2024, 0, 1);
const INTERVAL_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const CATEGORY_META: Record<
  CategoryKey,
  { label: string; shortLabel: string; color: string; soft: string }
> = {
  controlled: {
    label: "Controlled",
    shortLabel: "Controlled",
    color: "#176B87",
    soft: "#D9EEF2",
  },
  peak: {
    label: "Uncontrolled · peak",
    shortLabel: "Peak",
    color: "#F0715B",
    soft: "#FCE2DC",
  },
  offpeak: {
    label: "Uncontrolled · off-peak",
    shortLabel: "Off-peak",
    color: "#E3A82B",
    soft: "#F8EBCB",
  },
};

const categoryKeys: CategoryKey[] = ["controlled", "peak", "offpeak"];

const nzDate = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const nzShortDate = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const nzMonth = new Intl.DateTimeFormat("en-NZ", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

const nzWeekday = new Intl.DateTimeFormat("en-NZ", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const nzHour = new Intl.DateTimeFormat("en-NZ", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

const numberFormatter = new Intl.NumberFormat("en-NZ", {
  maximumFractionDigits: 1,
});

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toInputDate(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate(),
  )}`;
}

function inputDateToTimestamp(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function formatKwh(value: number) {
  if (value >= 1000) {
    return `${new Intl.NumberFormat("en-NZ", {
      maximumFractionDigits: 2,
    }).format(value / 1000)} MWh`;
  }

  return `${numberFormatter.format(value)} kWh`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatTime(minutes: number) {
  if (minutes === 1440) return "24:00";
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function isPeakPeriod(timestamp: number) {
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  const weekday = day >= 1 && day <= 5;
  return (
    weekday &&
    ((minute >= 7 * 60 && minute < 11 * 60) ||
      (minute >= 17 * 60 && minute < 21 * 60))
  );
}

function passesDayType(timestamp: number, dayType: DayType) {
  if (dayType === "all") return true;
  const day = new Date(timestamp).getUTCDay();
  const isWeekend = day === 0 || day === 6;
  return dayType === "weekends" ? isWeekend : !isWeekend;
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

function startOfBucket(timestamp: number, resolution: Exclude<Resolution, "auto">) {
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

function bucketLabel(
  timestamp: number,
  resolution: Exclude<Resolution, "auto">,
) {
  if (resolution === "hourly") return nzHour.format(timestamp);
  if (resolution === "monthly") return nzMonth.format(timestamp);
  if (resolution === "weekly") return `W/C ${nzShortDate.format(timestamp)}`;
  return nzShortDate.format(timestamp);
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

function shiftUtcYear(timestamp: number, yearOffset: number) {
  const date = new Date(timestamp);
  const targetYear = date.getUTCFullYear() + yearOffset;
  const targetMonth = date.getUTCMonth();
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();

  return Date.UTC(
    targetYear,
    targetMonth,
    Math.min(date.getUTCDate(), lastDayOfTargetMonth),
    date.getUTCHours(),
    date.getUTCMinutes(),
  );
}

function changePercent(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function formatChange(current: number, previous: number) {
  const change = changePercent(current, previous);
  if (change === null) return "New";
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(1)}%`;
}

function totalPoint(point: SeriesPoint, enabled: Record<CategoryKey, boolean>) {
  return categoryKeys.reduce(
    (sum, key) => sum + (enabled[key] ? point[key] : 0),
    0,
  );
}

function Chart({
  data,
  enabled,
  profile = false,
  comparisonData,
  ariaLabel,
}: {
  data: SeriesPoint[];
  enabled: Record<CategoryKey, boolean>;
  profile?: boolean;
  comparisonData?: SeriesPoint[];
  ariaLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(bounds.width, 300);
      const height = Math.max(bounds.height, 240);
      const scale = window.devicePixelRatio || 1;
      canvas.width = width * scale;
      canvas.height = height * scale;

      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(scale, scale);
      context.clearRect(0, 0, width, height);

      const padding = { top: 18, right: 12, bottom: 34, left: 52 };
      const plotWidth = width - padding.left - padding.right;
      const plotHeight = height - padding.top - padding.bottom;
      const maximum = Math.max(
        ...data.map((point) => totalPoint(point, enabled)),
        ...(comparisonData ?? []).map((point) => totalPoint(point, enabled)),
        1,
      );
      const axisMaximum = maximum * 1.12;

      context.font = "11px Arial, sans-serif";
      context.textBaseline = "middle";
      context.lineWidth = 1;

      for (let index = 0; index <= 4; index += 1) {
        const y = padding.top + (plotHeight / 4) * index;
        const value = axisMaximum * (1 - index / 4);
        context.strokeStyle = "#E3E8E7";
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();

        context.fillStyle = "#6E7D7C";
        context.textAlign = "right";
        context.fillText(
          value >= 1000
            ? `${(value / 1000).toFixed(1)}k`
            : value.toFixed(value < 10 ? 1 : 0),
          padding.left - 9,
          y,
        );
      }

      if (data.length === 0) return;

      const step = plotWidth / data.length;
      const hasComparison = Boolean(comparisonData?.length);
      const groupWidth = Math.max(
        3,
        Math.min(profile ? 11 : 28, step * 0.78),
      );
      const barGap = hasComparison
        ? Math.max(1, Math.min(3, step * 0.08))
        : 0;
      const barWidth = hasComparison
        ? Math.max(1, (groupWidth - barGap) / 2)
        : Math.max(2, Math.min(profile ? 11 : 18, step * 0.7));

      data.forEach((point, index) => {
        const centre = padding.left + step * index + step / 2;
        const drawStack = (
          stack: SeriesPoint,
          x: number,
          opacity: number,
        ) => {
          let bottom = padding.top + plotHeight;
          context.save();
          context.globalAlpha = opacity;
          categoryKeys.forEach((key) => {
            if (!enabled[key]) return;
            const barHeight = (stack[key] / axisMaximum) * plotHeight;
            if (barHeight <= 0) return;
            context.fillStyle = CATEGORY_META[key].color;
            context.fillRect(x, bottom - barHeight, barWidth, barHeight);
            bottom -= barHeight;
          });
          context.restore();
        };

        const currentX = hasComparison
          ? centre - barGap / 2 - barWidth
          : centre - barWidth / 2;
        drawStack(point, currentX, 1);

        const previousPoint = comparisonData?.[index];
        if (previousPoint) {
          drawStack(previousPoint, centre + barGap / 2, 0.42);
        }

        if (hoveredIndex === index) {
          context.fillStyle = "#163332";
          context.fillRect(
            centre - 1,
            padding.top,
            2,
            plotHeight,
          );
        }
      });

      const tickCount = Math.min(profile ? 8 : 6, data.length);
      for (let tick = 0; tick < tickCount; tick += 1) {
        const index =
          tickCount === 1
            ? 0
            : Math.round((tick / (tickCount - 1)) * (data.length - 1));
        const x = padding.left + step * index + step / 2;
        context.fillStyle = "#6E7D7C";
        context.textAlign = "center";
        context.fillText(data[index].label, x, height - 13);
      }
    };

    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [comparisonData, data, enabled, hoveredIndex, profile]);

  const onMouseMove = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (data.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const left = 52;
    const right = 12;
    const plotWidth = bounds.width - left - right;
    const relativeX = event.clientX - bounds.left - left;
    const index = Math.floor((relativeX / plotWidth) * data.length);
    setHoveredIndex(Math.max(0, Math.min(data.length - 1, index)));
  };

  const hovered =
    hoveredIndex !== null && data[hoveredIndex] ? data[hoveredIndex] : null;

  return (
    <div className="chart-wrap">
      <canvas
        ref={canvasRef}
        className="chart-canvas"
        aria-label={ariaLabel}
        role="img"
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHoveredIndex(null)}
      />
      {hovered ? (
        <div
          className={`chart-tooltip ${
            hoveredIndex !== null && hoveredIndex > data.length * 0.65
              ? "chart-tooltip-left"
              : ""
          }`}
          style={{
            left: `${(((hoveredIndex ?? 0) + 0.5) / Math.max(data.length, 1)) * 100}%`,
          }}
        >
          <strong>{hovered.label}</strong>
          {comparisonData ? (
            <em className="tooltip-period">Selected dates</em>
          ) : null}
          {categoryKeys.map(
            (key) =>
              enabled[key] && (
                <span key={key}>
                  <i style={{ background: CATEGORY_META[key].color }} />
                  {CATEGORY_META[key].shortLabel}
                  <b>{numberFormatter.format(hovered[key])} kWh</b>
                </span>
              ),
          )}
          {comparisonData && hoveredIndex !== null ? (
            <>
              <em className="tooltip-period tooltip-period-previous">
                Previous year
              </em>
              {categoryKeys.map(
                (key) =>
                  enabled[key] && (
                    <span
                      className="previous-tooltip-row"
                      key={`previous-${key}`}
                    >
                      <i style={{ background: CATEGORY_META[key].color }} />
                      {CATEGORY_META[key].shortLabel}
                      <b>
                        {numberFormatter.format(
                          comparisonData[hoveredIndex]?.[key] ?? 0,
                        )}{" "}
                        kWh
                      </b>
                    </span>
                  ),
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Toggle({
  category,
  checked,
  onChange,
}: {
  category: CategoryKey;
  checked: boolean;
  onChange: () => void;
}) {
  const meta = CATEGORY_META[category];

  return (
    <button
      type="button"
      className={`usage-toggle ${checked ? "usage-toggle-active" : ""}`}
      aria-pressed={checked}
      onClick={onChange}
      style={
        {
          "--toggle-color": meta.color,
          "--toggle-soft": meta.soft,
        } as React.CSSProperties
      }
    >
      <span className="usage-toggle-check">{checked ? "✓" : ""}</span>
      <span>
        <b>{meta.shortLabel}</b>
        <small>
          {category === "controlled"
            ? "Dedicated controlled meter"
            : category === "peak"
              ? "Weekdays · peak windows"
              : "All remaining uncontrolled use"}
        </small>
      </span>
    </button>
  );
}

export default function Home() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState("");
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-01-31");
  const [activePreset, setActivePreset] = useState("30d");
  const [dayType, setDayType] = useState<DayType>("all");
  const [startMinute, setStartMinute] = useState(0);
  const [endMinute, setEndMinute] = useState(1440);
  const [resolution, setResolution] = useState<Resolution>("auto");
  const [comparePreviousYear, setComparePreviousYear] = useState(false);
  const [activeView, setActiveView] = useState<DashboardView>("usage");
  const [enabled, setEnabled] = useState<Record<CategoryKey, boolean>>({
    controlled: true,
    peak: true,
    offpeak: true,
  });
  const [rates, setRates] = useState<Record<CategoryKey, number>>({
    controlled: 28.49,
    peak: 39.92,
    offpeak: 26.12,
  });
  const [tariffDailyCharge, setTariffDailyCharge] = useState(2.7544);
  const [spotCharges, setSpotCharges] = useState<SpotChargeSettings>(
    DEFAULT_SPOT_CHARGES,
  );
  const initialised = useRef(false);

  useEffect(() => {
    const syncViewFromHash = () => {
      setActiveView(
        window.location.hash === "#cost-comparison" ? "cost" : "usage",
      );
    };
    syncViewFromHash();
    window.addEventListener("hashchange", syncViewFromHash);
    return () => window.removeEventListener("hashchange", syncViewFromHash);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    fetch("./electricity-data.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("The usage data could not be loaded.");
        return response.json() as Promise<Dataset>;
      })
      .then((value) => setDataset(value))
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!dataset || initialised.current) return;
    const last = Date.parse(dataset.meta.lastDate);
    const first = Date.parse(dataset.meta.firstDate);
    setEndDate(toInputDate(last));
    setStartDate(toInputDate(Math.max(first, last - 29 * DAY_MS)));
    initialised.current = true;
  }, [dataset]);

  const coverageStart = dataset ? Date.parse(dataset.meta.firstDate) : 0;
  const coverageEnd = dataset ? Date.parse(dataset.meta.lastDate) : 0;

  const setPreset = (id: string, dayCount?: number) => {
    if (!dataset) return;
    const last = coverageEnd;
    const first =
      dayCount === undefined
        ? coverageStart
        : Math.max(coverageStart, last - (dayCount - 1) * DAY_MS);
    setStartDate(toInputDate(first));
    setEndDate(toInputDate(last));
    setActivePreset(id);
  };

  const setView = (view: DashboardView) => {
    setActiveView(view);
    window.history.replaceState(
      null,
      "",
      view === "cost" ? "#cost-comparison" : window.location.pathname,
    );
  };

  const billingPeriods = useMemo(() => {
    if (!dataset) return [];
    const periods: { value: string; label: string; start: number; end: number }[] = [];
    const first = new Date(coverageStart);
    const last = new Date(coverageEnd);
    let cursor = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
    const finalMonth = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1);

    while (cursor <= finalMonth) {
      const date = new Date(cursor);
      const monthEnd = Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        0,
      );
      periods.push({
        value: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`,
        label: new Intl.DateTimeFormat("en-NZ", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(cursor),
        start: Math.max(cursor, coverageStart),
        end: Math.min(monthEnd, coverageEnd),
      });
      cursor = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    }

    return periods.reverse();
  }, [coverageEnd, coverageStart, dataset]);

  const setBillingPeriod = (value: string) => {
    const period = billingPeriods.find((item) => item.value === value);
    if (!period) return;
    setStartDate(toInputDate(period.start));
    setEndDate(toInputDate(period.end));
    setActivePreset(`billing-${value}`);
  };

  const analysis = useMemo(() => {
    if (!dataset) return null;

    const startTimestamp = inputDateToTimestamp(startDate);
    const endTimestamp = inputDateToTimestamp(endDate) + DAY_MS;
    const dateSpan = Math.max(
      1,
      Math.round((endTimestamp - startTimestamp) / DAY_MS),
    );
    const requestedResolution =
      resolution === "hourly" && dateSpan > 7 ? "auto" : resolution;
    const activeResolution = resolveResolution(requestedResolution, dateSpan);
    const buckets = new Map<number, SeriesPoint>();
    const dailyTotals = new Map<number, number>();
    const profile = Array.from({ length: 48 }, (_, index) => ({
      label: formatTime(index * 30),
      controlled: 0,
      peak: 0,
      offpeak: 0,
      count: 0,
    }));
    const totals: Record<CategoryKey, number> = {
      controlled: 0,
      peak: 0,
      offpeak: 0,
    };
    const includedDays = new Set<number>();
    let maximumInterval = 0;
    let maximumTimestamp = startTimestamp;

    dataset.data.forEach(([slot, controlled, uncontrolled]) => {
      const timestamp = BASE_TIMESTAMP + slot * INTERVAL_MS;
      if (timestamp < startTimestamp || timestamp >= endTimestamp) return;
      if (!passesDayType(timestamp, dayType)) return;
      if (!passesTimeWindow(timestamp, startMinute, endMinute)) return;

      const date = new Date(timestamp);
      const minuteIndex =
        date.getUTCHours() * 2 + (date.getUTCMinutes() === 30 ? 1 : 0);
      const values: Record<CategoryKey, number> = {
        controlled: enabled.controlled ? controlled : 0,
        peak:
          enabled.peak && isPeakPeriod(timestamp) ? uncontrolled : 0,
        offpeak:
          enabled.offpeak && !isPeakPeriod(timestamp) ? uncontrolled : 0,
      };

      const intervalTotal =
        values.controlled + values.peak + values.offpeak;
      if (intervalTotal > maximumInterval) {
        maximumInterval = intervalTotal;
        maximumTimestamp = timestamp;
      }

      categoryKeys.forEach((key) => {
        totals[key] += values[key];
        profile[minuteIndex][key] += values[key];
      });
      profile[minuteIndex].count += 1;

      const dayStart = startOfBucket(timestamp, "daily");
      includedDays.add(dayStart);
      dailyTotals.set(
        dayStart,
        (dailyTotals.get(dayStart) ?? 0) + intervalTotal,
      );

      const bucketStart = startOfBucket(timestamp, activeResolution);
      const bucket =
        buckets.get(bucketStart) ??
        ({
          label: bucketLabel(bucketStart, activeResolution),
          controlled: 0,
          peak: 0,
          offpeak: 0,
        } satisfies SeriesPoint);
      categoryKeys.forEach((key) => {
        bucket[key] += values[key];
      });
      buckets.set(bucketStart, bucket);
    });

    const trendEntries = [...buckets.entries()].sort(([a], [b]) => a - b);
    const trend = trendEntries.map(([, value]) => value);

    const previousStartTimestamp = shiftUtcYear(startTimestamp, -1);
    const previousEndTimestamp = shiftUtcYear(endTimestamp, -1);
    const comparisonAvailable =
      previousStartTimestamp >= coverageStart &&
      previousEndTimestamp - INTERVAL_MS <= coverageEnd;
    const previousTotals: Record<CategoryKey, number> = {
      controlled: 0,
      peak: 0,
      offpeak: 0,
    };
    const previousBuckets = new Map<number, SeriesPoint>();
    const previousDays = new Set<number>();

    if (comparePreviousYear && comparisonAvailable) {
      dataset.data.forEach(([slot, controlled, uncontrolled]) => {
        const timestamp = BASE_TIMESTAMP + slot * INTERVAL_MS;
        if (
          timestamp < previousStartTimestamp ||
          timestamp >= previousEndTimestamp
        ) {
          return;
        }
        if (!passesDayType(timestamp, dayType)) return;
        if (!passesTimeWindow(timestamp, startMinute, endMinute)) return;

        const values: Record<CategoryKey, number> = {
          controlled: enabled.controlled ? controlled : 0,
          peak:
            enabled.peak && isPeakPeriod(timestamp) ? uncontrolled : 0,
          offpeak:
            enabled.offpeak && !isPeakPeriod(timestamp) ? uncontrolled : 0,
        };

        categoryKeys.forEach((key) => {
          previousTotals[key] += values[key];
        });
        previousDays.add(startOfBucket(timestamp, "daily"));

        const alignedTimestamp = shiftUtcYear(timestamp, 1);
        const bucketStart = startOfBucket(
          alignedTimestamp,
          activeResolution,
        );
        const bucket =
          previousBuckets.get(bucketStart) ??
          ({
            label: bucketLabel(bucketStart, activeResolution),
            controlled: 0,
            peak: 0,
            offpeak: 0,
          } satisfies SeriesPoint);
        categoryKeys.forEach((key) => {
          bucket[key] += values[key];
        });
        previousBuckets.set(bucketStart, bucket);
      });
    }

    const comparisonTotal =
      previousTotals.controlled + previousTotals.peak + previousTotals.offpeak;
    const comparisonEnergyCost =
      (previousTotals.controlled * rates.controlled +
        previousTotals.peak * rates.peak +
        previousTotals.offpeak * rates.offpeak) /
      100;
    const comparisonDailyChargeCost =
      previousDays.size * tariffDailyCharge;
    const comparisonCost =
      comparisonEnergyCost + comparisonDailyChargeCost;
    const comparisonTrend = trendEntries.map(([key, currentPoint]) => {
      const bucket = previousBuckets.get(key);
      return (
        bucket ?? {
          label: currentPoint.label,
          controlled: 0,
          peak: 0,
          offpeak: 0,
        }
      );
    });

    const averageProfile: SeriesPoint[] = profile.map(
      ({ count, ...point }) => ({
        ...point,
        controlled: count ? point.controlled / count : 0,
        peak: count ? point.peak / count : 0,
        offpeak: count ? point.offpeak / count : 0,
      }),
    );

    const highestDayEntry = [...dailyTotals.entries()].sort(
      ([, a], [, b]) => b - a,
    )[0];
    const total = totals.controlled + totals.peak + totals.offpeak;
    const dayCount = includedDays.size;
    const energyCost =
      (totals.controlled * rates.controlled +
        totals.peak * rates.peak +
        totals.offpeak * rates.offpeak) /
      100;
    const dailyChargeCost = dayCount * tariffDailyCharge;
    const cost = energyCost + dailyChargeCost;
    const uncontrolled = totals.peak + totals.offpeak;
    const peakShare = uncontrolled ? (totals.peak / uncontrolled) * 100 : 0;
    const controlledShare = total ? (totals.controlled / total) * 100 : 0;

    return {
      totals,
      total,
      cost,
      energyCost,
      dailyChargeCost,
      dayCount,
      averageDaily: dayCount ? total / dayCount : 0,
      maximumInterval,
      maximumTimestamp,
      highestDay: highestDayEntry
        ? { timestamp: highestDayEntry[0], value: highestDayEntry[1] }
        : null,
      peakShare,
      controlledShare,
      potentialShiftSaving:
        (totals.peak * Math.max(0, rates.peak - rates.offpeak)) / 100,
      trend,
      averageProfile,
      activeResolution,
      dateSpan,
      comparisonAvailable,
      comparison:
        comparePreviousYear && comparisonAvailable
          ? {
              totals: previousTotals,
              total: comparisonTotal,
              cost: comparisonCost,
              energyCost: comparisonEnergyCost,
              dailyChargeCost: comparisonDailyChargeCost,
              dayCount: previousDays.size,
              averageDaily: previousDays.size
                ? comparisonTotal / previousDays.size
                : 0,
              trend: comparisonTrend,
              dateLabel: `${nzDate.format(
                previousStartTimestamp,
              )} – ${nzDate.format(previousEndTimestamp - DAY_MS)}`,
            }
          : null,
    };
  }, [
    dataset,
    startDate,
    endDate,
    dayType,
    startMinute,
    endMinute,
    enabled,
    rates,
    tariffDailyCharge,
    resolution,
    comparePreviousYear,
    coverageEnd,
    coverageStart,
  ]);

  const timeOptions = useMemo(
    () => Array.from({ length: 49 }, (_, index) => index * 30),
    [],
  );

  const toggleCategory = (category: CategoryKey) => {
    const selectedCount = categoryKeys.filter((key) => enabled[key]).length;
    if (enabled[category] && selectedCount === 1) return;
    setEnabled((current) => ({
      ...current,
      [category]: !current[category],
    }));
  };

  if (loadError) {
    return (
      <main className="state-page">
        <div className="state-mark">!</div>
        <h1>Usage data unavailable</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  if (!dataset || !analysis) {
    return (
      <main className="state-page">
        <div className="loader" />
        <h1>Preparing your energy view</h1>
        <p>Organising the half-hour readings…</p>
      </main>
    );
  }

  const mixTotal = Math.max(analysis.total, 1);
  const controlledAngle = (analysis.totals.controlled / mixTotal) * 360;
  const peakAngle =
    controlledAngle + (analysis.totals.peak / mixTotal) * 360;

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ↯
          </span>
          <div>
            <span>Home energy</span>
            <strong>Energy explorer</strong>
          </div>
        </div>
        <div className="topbar-tools">
          <nav className="view-tabs" aria-label="Dashboard pages">
            <button
              type="button"
              className={activeView === "usage" ? "active" : ""}
              aria-current={activeView === "usage" ? "page" : undefined}
              onClick={() => setView("usage")}
            >
              Usage
            </button>
            <button
              type="button"
              className={activeView === "cost" ? "active" : ""}
              aria-current={activeView === "cost" ? "page" : undefined}
              onClick={() => setView("cost")}
            >
              Cost comparison
            </button>
          </nav>
          <div className="coverage-pill">
            <span className="status-dot" />
            {nzDate.format(coverageStart)} – {nzDate.format(coverageEnd)}
          </div>
        </div>
      </header>

      <div className="dashboard-grid">
        <aside className="filter-panel" aria-label="Dashboard filters">
          <div className="filter-heading">
            <span className="eyebrow">Refine the view</span>
            <button
              type="button"
              onClick={() => {
                setPreset("30d", 30);
                setDayType("all");
                setStartMinute(0);
                setEndMinute(1440);
                setEnabled({
                  controlled: true,
                  peak: true,
                  offpeak: true,
                });
                setRates({
                  controlled: 28.49,
                  peak: 39.92,
                  offpeak: 26.12,
                });
                setTariffDailyCharge(2.7544);
                setSpotCharges(DEFAULT_SPOT_CHARGES);
                setComparePreviousYear(false);
              }}
            >
              Reset
            </button>
          </div>

          <div className="filter-section">
            <h2>Usage type</h2>
            <div className="toggle-list">
              {categoryKeys.map((key) => (
                <Toggle
                  key={key}
                  category={key}
                  checked={enabled[key]}
                  onChange={() => toggleCategory(key)}
                />
              ))}
            </div>
          </div>

          <div className="filter-section">
            <h2>Day type</h2>
            <div className="segmented segmented-three">
              {(["all", "weekdays", "weekends"] as DayType[]).map((value) => (
                <button
                  type="button"
                  key={value}
                  className={dayType === value ? "active" : ""}
                  onClick={() => setDayType(value)}
                >
                  {value === "all"
                    ? "All"
                    : value === "weekdays"
                      ? "Weekdays"
                      : "Weekends"}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <div className="section-heading-row">
              <h2>Time of day</h2>
              <span>
                {formatTime(startMinute)}–{formatTime(endMinute)}
              </span>
            </div>
            <div className="time-selects">
              <label>
                From
                <select
                  value={startMinute}
                  onChange={(event) => setStartMinute(Number(event.target.value))}
                >
                  {timeOptions.slice(0, -1).map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {formatTime(minutes)}
                    </option>
                  ))}
                </select>
              </label>
              <span aria-hidden="true">→</span>
              <label>
                To
                <select
                  value={endMinute}
                  onChange={(event) => setEndMinute(Number(event.target.value))}
                >
                  {timeOptions.slice(1).map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {formatTime(minutes)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="microcopy">
              If the end is earlier, the selection runs overnight.
            </p>
          </div>

          <details className="rate-card">
            <summary>
              <span>
                <b>Tariff rates</b>
                <small>Default unit rates · edit as needed</small>
              </span>
              <span className="summary-symbol">+</span>
            </summary>
            <div className="rate-fields">
              {categoryKeys.map((key) => (
                <label key={key}>
                  <span>
                    <i style={{ background: CATEGORY_META[key].color }} />
                    {CATEGORY_META[key].shortLabel}
                  </span>
                  <span className="rate-input">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={rates[key]}
                      onChange={(event) =>
                        setRates((current) => ({
                          ...current,
                          [key]: Math.max(0, Number(event.target.value)),
                        }))
                      }
                      aria-label={`${CATEGORY_META[key].shortLabel} rate in cents per kilowatt-hour`}
                    />
                    c/kWh
                  </span>
                </label>
              ))}
              <label>
                <span>
                  <i style={{ background: "#163332" }} />
                  Daily charge
                </span>
                <span className="rate-input">
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={tariffDailyCharge}
                    onChange={(event) =>
                      setTariffDailyCharge(
                        Math.max(0, Number(event.target.value)),
                      )
                    }
                    aria-label="Standard tariff daily charge in dollars including GST"
                  />
                  $/day
                </span>
              </label>
              <small className="daily-charge-note">
                Daily charge includes GST and applies once per included day.
              </small>
            </div>
          </details>

          <div className="tariff-note">
            <span aria-hidden="true">i</span>
            <p>
              Peak is classified on weekdays from <b>07:00–11:00</b> and{" "}
              <b>17:00–21:00</b>. Boundary end-times are off-peak.
            </p>
          </div>
        </aside>

        <section className="content">
          <section className="date-card" aria-label="Date range">
            <div className="preset-row">
              {[
                ["7d", "7 days", 7],
                ["30d", "30 days", 30],
                ["90d", "90 days", 90],
                ["12m", "12 months", 365],
                ["all", "All data", undefined],
              ].map(([id, label, days]) => (
                <button
                  type="button"
                  key={String(id)}
                  className={activePreset === id ? "active" : ""}
                  onClick={() =>
                    setPreset(String(id), days as number | undefined)
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="date-tools">
              {activeView === "cost" ? (
                <label className="billing-period-select">
                  Calendar billing month
                  <select
                    value={
                      activePreset.startsWith("billing-")
                        ? activePreset.replace("billing-", "")
                        : ""
                    }
                    onChange={(event) => setBillingPeriod(event.target.value)}
                  >
                    <option value="">Custom / preset range</option>
                    {billingPeriods.map((period) => (
                      <option value={period.value} key={period.value}>
                        {period.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="date-inputs">
                <label>
                  From
                  <input
                    type="date"
                    value={startDate}
                    min={toInputDate(coverageStart)}
                    max={endDate}
                    onChange={(event) => {
                      setStartDate(event.target.value);
                      setActivePreset("custom");
                    }}
                  />
                </label>
                <span aria-hidden="true">→</span>
                <label>
                  To
                  <input
                    type="date"
                    value={endDate}
                    min={startDate}
                    max={toInputDate(coverageEnd)}
                    onChange={(event) => {
                      setEndDate(event.target.value);
                      setActivePreset("custom");
                    }}
                  />
                </label>
              </div>
              {activeView === "usage" ? (
                <button
                  type="button"
                  className={`compare-toggle ${
                    comparePreviousYear && analysis.comparisonAvailable
                      ? "compare-toggle-active"
                      : ""
                  }`}
                  aria-pressed={
                    comparePreviousYear && analysis.comparisonAvailable
                  }
                  disabled={!analysis.comparisonAvailable}
                  title={
                    analysis.comparisonAvailable
                      ? "Compare this date range with the same dates one year earlier"
                      : "A complete previous-year range is not available"
                  }
                  onClick={() =>
                    setComparePreviousYear((current) => !current)
                  }
                >
                  <span className="compare-switch">
                    <i />
                  </span>
                  Previous year
                </button>
              ) : null}
            </div>
          </section>

          {activeView === "usage" ? (
            <>
          <section className="kpi-grid" aria-label="Usage summary">
            <article className="kpi-card kpi-primary">
              <div className="kpi-topline">
                <span>Total usage</span>
                <span className="kpi-icon">∿</span>
              </div>
              <strong>{formatKwh(analysis.total)}</strong>
              <small>
                Across {analysis.dayCount.toLocaleString("en-NZ")} selected days
              </small>
            </article>
            <article className="kpi-card">
              <div className="kpi-topline">
                <span>Average per day</span>
                <span className="kpi-icon">÷</span>
              </div>
              <strong>{formatKwh(analysis.averageDaily)}</strong>
              <small>Within the selected time window</small>
            </article>
            <article className="kpi-card">
              <div className="kpi-topline">
                <span>Highest half-hour</span>
                <span className="kpi-icon">↑</span>
              </div>
              <strong>{formatKwh(analysis.maximumInterval)}</strong>
              <small>
                {nzWeekday.format(analysis.maximumTimestamp)} ·{" "}
                {formatTime(
                  new Date(analysis.maximumTimestamp).getUTCHours() * 60 +
                    new Date(analysis.maximumTimestamp).getUTCMinutes(),
                )}
              </small>
            </article>
            <article className="kpi-card">
              <div className="kpi-topline">
                <span>Estimated tariff cost</span>
                <span className="kpi-icon">$</span>
              </div>
              <strong>{formatMoney(analysis.cost)}</strong>
              <small className="kpi-cost-breakdown">
                {formatMoney(analysis.energyCost)} usage +{" "}
                {formatMoney(analysis.dailyChargeCost)} daily charges
              </small>
            </article>
          </section>

          {analysis.comparison ? (
            <section
              className="panel comparison-panel"
              aria-label="Previous year comparison"
            >
              <div className="comparison-heading">
                <div>
                  <span className="eyebrow">Same dates · one year earlier</span>
                  <h2>Previous year comparison</h2>
                  <p>{analysis.comparison.dateLabel}</p>
                </div>
                <div className="comparison-total">
                  <span>Total change</span>
                  <strong
                    className={
                      analysis.total > analysis.comparison.total
                        ? "change-up"
                        : "change-down"
                    }
                  >
                    {formatChange(
                      analysis.total,
                      analysis.comparison.total,
                    )}
                  </strong>
                  <small>
                    {formatKwh(analysis.comparison.total)} previously
                  </small>
                </div>
              </div>
              <div className="comparison-table" role="table">
                <div className="comparison-row comparison-row-head" role="row">
                  <span role="columnheader">Usage type</span>
                  <span role="columnheader">Selected</span>
                  <span role="columnheader">Previous year</span>
                  <span role="columnheader">Change</span>
                </div>
                {categoryKeys.map(
                  (key) =>
                    enabled[key] && (
                      <div className="comparison-row" role="row" key={key}>
                        <span role="cell">
                          <i
                            style={{
                              background: CATEGORY_META[key].color,
                            }}
                          />
                          {CATEGORY_META[key].shortLabel}
                        </span>
                        <b role="cell">
                          {formatKwh(analysis.totals[key])}
                        </b>
                        <b role="cell">
                          {formatKwh(analysis.comparison!.totals[key])}
                        </b>
                        <strong
                          role="cell"
                          className={
                            analysis.totals[key] >
                            analysis.comparison!.totals[key]
                              ? "change-up"
                              : "change-down"
                          }
                        >
                          {formatChange(
                            analysis.totals[key],
                            analysis.comparison!.totals[key],
                          )}
                        </strong>
                      </div>
                    ),
                )}
              </div>
            </section>
          ) : null}

          <section className="panel trend-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Consumption over time</span>
                <h2>Usage trend</h2>
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
                    setResolution(event.target.value as Resolution)
                  }
                >
                  <option value="auto">
                    Auto ({analysis.activeResolution})
                  </option>
                  {analysis.dateSpan <= 7 ? (
                    <option value="hourly">Hour</option>
                  ) : null}
                  <option value="daily">Day</option>
                  <option value="weekly">Week</option>
                  <option value="monthly">Month</option>
                </select>
              </label>
            </div>
            <div className="chart-legend">
              {categoryKeys.map(
                (key) =>
                  enabled[key] && (
                    <span key={key}>
                      <i style={{ background: CATEGORY_META[key].color }} />
                      {CATEGORY_META[key].shortLabel}
                    </span>
                  ),
              )}
              {analysis.comparison ? (
                <span className="comparison-legend">
                  <i />
                  Previous year · lighter bar
                </span>
              ) : null}
              <small>kWh</small>
            </div>
            <Chart
              data={analysis.trend}
              enabled={enabled}
              comparisonData={analysis.comparison?.trend}
              ariaLabel={`Stacked ${analysis.activeResolution} electricity usage chart`}
            />
          </section>

          <div className="analysis-grid">
            <section className="panel profile-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Shape of demand</span>
                  <h2>Average day profile</h2>
                </div>
                <span className="panel-unit">kWh / half-hour</span>
              </div>
              <div className="peak-band-labels" aria-hidden="true">
                <span>Morning peak 07–11</span>
                <span>Evening peak 17–21</span>
              </div>
              <Chart
                data={analysis.averageProfile}
                enabled={enabled}
                profile
                ariaLabel="Average electricity usage by half-hour of the day"
              />
            </section>

            <section className="panel mix-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Selected usage</span>
                  <h2>Energy mix</h2>
                </div>
              </div>
              <div className="donut-row">
                <div
                  className="donut"
                  role="img"
                  aria-label="Donut chart showing selected energy mix"
                  style={{
                    background: `conic-gradient(
                      ${CATEGORY_META.controlled.color} 0deg ${controlledAngle}deg,
                      ${CATEGORY_META.peak.color} ${controlledAngle}deg ${peakAngle}deg,
                      ${CATEGORY_META.offpeak.color} ${peakAngle}deg 360deg
                    )`,
                  }}
                >
                  <div>
                    <strong>{formatKwh(analysis.total)}</strong>
                    <span>Total</span>
                  </div>
                </div>
                <div className="mix-list">
                  {categoryKeys.map((key) => (
                    <div
                      key={key}
                      className={!enabled[key] ? "mix-disabled" : ""}
                    >
                      <span>
                        <i style={{ background: CATEGORY_META[key].color }} />
                        {CATEGORY_META[key].shortLabel}
                      </span>
                      <b>
                        {enabled[key]
                          ? `${Math.round(
                              (analysis.totals[key] / mixTotal) * 100,
                            )}%`
                          : "Hidden"}
                      </b>
                      <small>{formatKwh(analysis.totals[key])}</small>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <section className="panel insights-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">At a glance</span>
                <h2>What stands out</h2>
              </div>
            </div>
            <div className="insight-grid">
              <article>
                <span className="insight-number">01</span>
                <div>
                  <h3>Busiest selected day</h3>
                  <strong>
                    {analysis.highestDay
                      ? nzDate.format(analysis.highestDay.timestamp)
                      : "No usage"}
                  </strong>
                  <p>
                    {analysis.highestDay
                      ? `${formatKwh(
                          analysis.highestDay.value,
                        )} across the selected usage types.`
                      : "Adjust the filters to include usage."}
                  </p>
                </div>
              </article>
              <article>
                <span className="insight-number">02</span>
                <div>
                  <h3>Uncontrolled peak share</h3>
                  <strong>{Math.round(analysis.peakShare)}%</strong>
                  <p>
                    of uncontrolled electricity falls inside the weekday peak
                    windows.
                  </p>
                </div>
              </article>
              <article>
                <span className="insight-number">03</span>
                <div>
                  <h3>Shift-to-off-peak potential</h3>
                  <strong>{formatMoney(analysis.potentialShiftSaving)}</strong>
                  <p>
                    maximum rate difference on selected peak use, before
                    practical limits.
                  </p>
                </div>
              </article>
            </div>
          </section>

          <footer>
            <p>
              Classifications use each interval&apos;s start time. Tariff costs
              include the editable GST-inclusive daily charge and exclude other
              taxes and plan discounts.
            </p>
            <span>
              Source refreshed from {dataset.meta.source.replace(".csv", "")}
            </span>
          </footer>
            </>
          ) : (
            <CostComparison
              dataset={dataset}
              startDate={startDate}
              endDate={endDate}
              dayType={dayType}
              startMinute={startMinute}
              endMinute={endMinute}
              enabled={enabled}
              rates={rates}
              tariffDailyCharge={tariffDailyCharge}
              spotCharges={spotCharges}
              onSpotChargesChange={setSpotCharges}
              onResetSpotCharges={() =>
                setSpotCharges(DEFAULT_SPOT_CHARGES)
              }
              resolution={resolution}
              onResolutionChange={setResolution}
            />
          )}
        </section>
      </div>
    </main>
  );
}
