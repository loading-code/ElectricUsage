# Electricity Usage Explorer

An interactive dashboard for exploring controlled, peak, and off-peak electricity consumption in half-hour intervals.

## Tariff classification

- Register ID `2` is controlled consumption.
- Register ID `1` is uncontrolled consumption.
- Uncontrolled usage is peak on weekdays from 07:00-11:00 and 17:00-21:00.
- All remaining uncontrolled usage is off-peak.

## Local development

```bash
npm ci
npm run dev
```

To create the static GitHub Pages build:

```bash
npm run build:pages
```

The output is written to `dist-pages/`.

## Deployment

The workflow in `.github/workflows/pages.yml` builds and deploys the dashboard to GitHub Pages whenever `main` is updated. It can also be run manually from the Actions tab.

The raw CSV exports are intentionally excluded from version control. The dashboard publishes only the processed data in `public/electricity-data.json`.
