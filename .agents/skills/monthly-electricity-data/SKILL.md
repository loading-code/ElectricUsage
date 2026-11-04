---
name: monthly-electricity-data
description: Process a newly received monthly smart-meter CSV for the Electricity Usage dashboard, anonymize it into the dashboard data format, and prepare the refreshed collated dataset for publication.
---

# Monthly electricity data

Use this skill when a new `electricity-interval-meter-readings_YYYYMMDD_HHMMSS.csv` export arrives in `data/`.

Run these commands from the repository root:

1. `npm run data:usage` combines the legacy history with every monthly export it finds, using filename order so later exports replace earlier readings when intervals overlap. It writes the anonymized `public/electricity-data.json`.
2. `npm run data:spot:refresh` reads that meter dataset's latest date, fetches the Electricity Authority's daily final-energy-price CSVs for WIL0331 from the current spot-price tail through that date, updates `data/wilton_settled_spot_prices_since_2024.csv`, and regenerates `public/spot-price-data.json`.

The spot refresh only uses daily files marked final (without the `_I` interim suffix). If an official daily file is unavailable or lacks a complete set of WIL0331 trading periods, the refresh stops before replacing the source CSV; retry after the Authority publishes final prices.

The source export contains supply point and device identifiers. Do not copy source rows or identifiers into reports, logs, dashboard output, or commits. The processed JSON contains only interval indexes and aggregated usage values plus non-identifying processing metadata. Monthly source exports are ignored by Git.

After processing, inspect the JSON `meta` values and confirm:

- `firstDate` and `lastDate` cover the intended history and new month.
- `intervalCount` spans every half-hour slot from the first to last date; each slot appears once in `data`.
- `duplicateIntervalCount` reports source collisions that were resolved in source order. These are not duplicate output slots.
- `filledIntervalCount` is zero when source coverage is complete. Missing slots are filled with zero to preserve the dashboard's continuous interval axis; if nonzero, call out this data-quality limitation when reporting the update.
- `gapPeriods` lists each consecutive internal gap with its UTC start, exclusive end, and number of half-hour intervals. The processor can only identify gaps between the first and last observed readings.
- `skippedRows` is understood. Rows outside supported registers, malformed timestamps, or invalid values are skipped, so investigate unexpected increases before publishing.

The processed JSON is the dashboard's published data artifact. The Pages workflow deploys it when the update reaches `main`; do not push or deploy unless the user has authorized that external publication.
