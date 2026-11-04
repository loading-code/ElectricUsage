---
name: monthly-electricity-data
description: Process a newly received monthly smart-meter CSV for the Electricity Usage dashboard, anonymize it into the dashboard data format, and prepare the refreshed collated dataset for publication.
---

# Monthly electricity data

Use this skill when a new `electricity-interval-meter-readings_YYYYMMDD_HHMMSS.csv` export arrives in `data/`.

Run `npm run data:usage` from the repository root. The processor combines the legacy history with every monthly export it finds, using filename order so later exports replace earlier readings when intervals overlap. It converts the source registers to the dashboard's controlled and uncontrolled values and writes `public/electricity-data.json`.

The source export contains supply point and device identifiers. Do not copy source rows or identifiers into reports, logs, dashboard output, or commits. The processed JSON contains only interval indexes and aggregated usage values plus non-identifying processing metadata. Monthly source exports are ignored by Git.

After processing, inspect the JSON `meta` values and confirm:

- `firstDate` and `lastDate` cover the intended history and new month.
- `intervalCount` spans every half-hour slot from the first to last date; each slot appears once in `data`.
- `duplicateIntervalCount` reports source collisions that were resolved in source order. These are not duplicate output slots.
- `filledIntervalCount` is zero when source coverage is complete. Missing slots are filled with zero to preserve the dashboard's continuous interval axis; if nonzero, call out this data-quality limitation when reporting the update.
- `skippedRows` is understood. Rows outside supported registers, malformed timestamps, or invalid values are skipped, so investigate unexpected increases before publishing.

The processed JSON is the dashboard's published data artifact. The Pages workflow deploys it when the update reaches `main`; do not push or deploy unless the user has authorized that external publication.
