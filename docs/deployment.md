# Deployment

## GitHub Pages flow

The site is deployed by [`.github/workflows/pages.yml`](../.github/workflows/pages.yml):

1. A push to `main` starts the workflow. It can also be started manually with `workflow_dispatch` from the repository's Actions tab.
2. GitHub Actions checks out the repository, installs Node.js 22.13.0, and runs `npm ci`.
3. `npm run build:pages` builds the static dashboard into `dist-pages/`.
4. The workflow uploads `dist-pages/` as a Pages artifact and deploys it to the configured GitHub Pages environment.

The Vite Pages config sets the site base path to `/ElectricUsage/`. Asset requests use relative paths so the JSON datasets load under that project-site path. The workflow uses the `github-pages` environment, grants only the `contents: read`, `pages: write`, and `id-token: write` permissions, and cancels an older in-progress Pages run when a newer one starts.

The Pages workflow builds and deploys committed files. It does **not** process meter CSVs or download spot-price data. Refresh and commit the generated `public/` JSON files before pushing to `main` if the live dashboard should include new data.

## Refreshing monthly data

With the new monthly meter export in `data/`, run:

```bash
npm run data:usage
npm run data:spot:refresh
```

The first command updates `public/electricity-data.json` from historical and monthly meter sources. The second uses that JSON's latest date to refresh the official final WIL0331 prices in `data/wilton_settled_spot_prices_since_2024.csv` and regenerates `public/spot-price-data.json`. It requires network access to the Electricity Authority's published daily final-price files. If a required date is not yet published as final, the command stops without replacing the collated CSV; run it again after the final file is available.

`npm run data` only processes the local meter and spot CSVs already present. It does not fetch new Electricity Authority price files. Use `npm run data:spot:refresh` when extending spot coverage to a newer meter period.

Before pushing, check the generated metadata. The usage and spot datasets should reach the intended date. The meter metadata includes any zero-filled gap periods; spot coverage can omit nonexistent local intervals on daylight-saving transitions. Do not add ignored raw smart-meter exports to Git.

## Local build and preview

```bash
npm ci
npm run dev
```

To build and preview the same static bundle used by Pages:

```bash
npm run build:pages
npm run preview:pages
```

The build output is `dist-pages/`; it is generated locally and uploaded by the deployment workflow rather than committed.
