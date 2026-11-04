# Electricity Usage Explorer

An interactive dashboard for exploring controlled, peak, and off-peak electricity consumption in half-hour intervals, and comparing tariff costs with Wellington half-hour spot prices.

## Tariff classification

- Register ID `2` is controlled consumption.
- Register ID `1` is uncontrolled consumption.
- Uncontrolled usage is peak on weekdays from 07:00-11:00 and 17:00-21:00.
- All remaining uncontrolled usage is off-peak.

## Cost comparison

- The tariff model applies the editable controlled, peak, and off-peak unit rates.
- The tariff model also applies an editable daily charge, defaulting to $2.7544
  per included day including GST.
- The spot model applies the settled Wilton (`WIL0331`) half-hour price to all
  selected usage with a matching final price.
- Optional spot-plan metering, service, levy, network delivery, daily and loss
  charges can be edited or disabled independently.
- The configured fee and delivery defaults are GST-exclusive; the dashboard
  applies 15% GST to lines marked `+ GST`.
- Network losses add the configured percentage to each interval's spot-energy
  component.
- Both models are compared only where a meter reading and spot price overlap.
- Costs exclude any retailer margin, tax, hedge or discount not represented by
  the configurable spot-plan inputs.

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

To process the local meter and spot-price CSVs:

```bash
npm run data
```

When a new monthly meter export arrives, update the meter dataset and extend the official settled spot-price data to the same date:

```bash
npm run data:usage
npm run data:spot:refresh
```

The stored Wilton prices come from the Electricity Authority's official
[final energy prices dataset](https://www.ea.govt.nz/data-and-insights/datasets/wholesale/dispatch-and-pricing/final-energy-prices/).

## Deployment

The workflow in `.github/workflows/pages.yml` builds and deploys the dashboard to GitHub Pages whenever `main` is updated. It can also be run manually from the Actions tab.

The dashboard loads the processed data in `public/electricity-data.json` and `public/spot-price-data.json`.

## Project documentation

- [Architecture](docs/architecture.md)
- [File structure](docs/file-structure.md)
- [Deployment and monthly data refresh](docs/deployment.md)
