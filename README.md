# Value Finder

SEC-based intrinsic-value research with a ten-year FCFF model, independent operating scenarios, WACC sensitivity, reverse DCF, and source evidence. The website needs no account. Forecast accuracy is not calibrated.

Public site: https://value-finder-research.vercel.app

Model `fcff-2.0.0` uses accepted SEC records collected on November 2, 2026. All seven record checks and the production build pass. Estimates remain provisional until the stated accounting and forecast reviews are complete.

## Architecture

One repository contains:

- A scheduled Python collector. EdgarTools parses local SEC XBRL instances.
- One TypeScript accounting module for fiscal periods, fact selection, D&A components, debt scope, and TTM.
- One TypeScript forecast and valuation engine, shared by the server and analyst editor.
- Accepted JSON research records and compressed original source bodies.
- The existing Next.js, TypeScript, and Tailwind interface on Vercel.

Search reads deployed records. It does not call financial providers. No database, separate Python web service, quote provider, or AI forecast service is used. See [ownership and data flow](docs/ARCHITECTURE.md).

Initial coverage is AMD, AAPL, MSFT, CAT, TXN, AGX, and AMZN. CAT receives a specialized-model refusal because its financing business requires separate treatment. Other symbols receive an explicit coverage message. Add companies only after their accounting and industry mappings pass filing checks.

## Local setup

Use Node.js 22 and Python 3.13. Install collector dependencies in an isolated environment.

PowerShell:

```powershell
npm ci
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-collector.txt
npm test
npm run test:collector
npm run typecheck
npm run dev
```

On Linux/macOS, activate with `source .venv/bin/activate`.

Existing accepted records can be served without Python. Python is required for collection, parser tests, and source packaging. A fresh checkout with no accepted records must complete collection before a production build.

## Collect and accept data

Set `SEC_USER_AGENT` in the job or your local process to the application name and a real contact email. Do not commit its actual value. No SEC API key is required. `.env.example` contains a rejected example identity, not working credentials. The command-line collector does not load `.env.local` automatically.

```sh
python scripts/collect.py
npm run refresh:references
npm run build:records
npm run verify:records
python scripts/package-source.py
npm run build
```

The collector downloads five annual filings and the latest subsequent quarterly filing, plus relevant amendments. Company Facts supplies up to ten years of available standard history. Older annual metadata is retrieved from additional submissions files when needed. Archived filing bodies are reused. SEC requests run serially, at less than two requests per second, with bounded retries for transient errors.

The source archive is `public/filings/<SHA-256>.gz`. Decompress a body and hash its original bytes to verify it. `src/data/collection-state.json` records source URLs, hashes, retrieval times, and HTTP validators. It contains no request headers or credentials. Reference captures have their own state file.

Collection candidates stay in ignored `output/collection`. `build:records` verifies issuer identity, parser version, five annual periods, source hashes, model eligibility, required inputs, and a usable base calculation. All seven candidates must pass before `src/data/research-records.json` is replaced. A collection or build failure leaves the deployed record set unchanged. `src/data/collection-report.json` records the accepted run.

`npm run build` runs the accepted-record gate first. Do not bypass that gate for a release. A direct `npx next build` is a compilation diagnostic only.

## Scheduled updates

[The GitHub Actions workflow](.github/workflows/research.yml) runs checks on source changes. Scheduled and manual runs also collect, refresh references, accept records, build, and commit the accepted data. The schedule is 12:17 UTC daily; GitHub can delay scheduled runs.

The workflow is limited to public repositories so standard hosted runners remain free. It requires a repository secret named `SEC_USER_AGENT`. Local collection has passed. Hosted collection and automatic deployment require separate verification; a successful local run does not prove runner access to the SEC.

Deploy this repository's tested commit to the existing Vercel project `value-finder-research`. Confirm the accepted record hashes and model version with `npm run verify:live`. The website requires no financial-provider environment variables. Connect Git deployments before relying on a scheduled data commit to update the public site.

At this coverage size, deployed files are sufficient. A larger universe or materially larger archive is a reason to reassess storage. No paid service is required by this design.

## Sources

- [SEC submissions and Company Facts](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), original extracted XBRL, and filing documents.
- [US Treasury daily yield XML](https://home.treasury.gov/treasury-daily-interest-rate-xml-feed): ten-year par yield, with its observation date.
- [Damodaran datasets](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/data.html): industry beta, target capital structure, margins, ROIC, capital productivity, and borrowing-cost references.
- [Damodaran monthly implied ERP](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/home.htm): trailing twelve-month adjusted-payout variant on the Treasury convention.
- [Synthetic credit spreads](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ratings.html): a credit estimate when company interest coverage and the reported public float support the selected table.

No automatic public market-price feed is used. Enter a price and its date. Software licenses do not establish market-data redistribution rights.

## Accounting and forecast rules

Facts retain their original units, currency, fiscal dates, accession, filing date, source, retrieval time, and available XBRL context and precision. Segment facts are not added to consolidated facts. Conflicting consolidated duplicates are not selected arbitrarily. Missing amounts remain missing.

Fiscal dates control annual and YTD matching. TTM = annual + current fiscal YTD − prior comparable YTD. A standalone quarter cannot replace YTD. Diluted share counts use share-days. D&A can combine compatible separate components; an existing aggregate is not added again. AMD's other D&A and intangible amortization are handled separately from depreciation alone.

Broad current borrowing tags can include short-term debt and current leases. Lease coverage is tracked separately for current and noncurrent obligations. Overlapping claims are not deducted twice. Operating rent stays in EBIT. A missing claim can remain an explicit provisional exclusion, but is never called a reported zero.

[Dated accounting rules](src/data/accounting-review.json) can use an explicit qualitative disclosure. The AGX July 31, 2026 no-debt statement is one such rule. The collector checks its source text and accession. It does not carry that zero into a later period.

Automatic growth blends comparable annual history with current YTD year-over-year growth. It is a model policy, not consensus. Margins retain a company-specific starting point. Growth requires reinvestment. Industry capital productivity is a provisional fallback when complete company operating-capital history is missing. Unknown CapEx, D&A, or working-capital forecast allocations stay blank; total investment and FCFF remain separately calculated.

Current excess investment is held through ten years unless an analyst supports another capital plan. This can be too severe for a temporary capital cycle. GAAP EBIT retains SBC and acquisition amortization. Segment economics, normalization duration, management guidance, operating cash requirements, and omitted financing claims require analyst work.

The Treasury proxy and monthly ERP use a consistent convention. A company synthetic spread is an estimate, not an observed current bond yield. Dated industry borrowing cost is the fallback. Target capital weights do not change when the entered share price changes.

## Tests and calculation references

```sh
npm test
npm run test:collector
npm run typecheck
npm run verify:records
npm run build
npm run verify:live
```

Activate the Python environment before `test:collector`.

The suite covers normalization, matching fiscal periods, amendments, TTM, D&A, debt and lease scope, missing values, currency/share conversion, FCFF, WACC, terminal reinvestment, equity adjustments, scenarios, sensitivity, reverse DCF, saved research, and market-price independence.

`scripts/reference-dcf.py` is an independent Decimal calculation that imports no application code. Its test fixture is synthetic and is never used as company data.

`tests/damodaran-benchmark.json` retains the source workbook URL, hash, worksheet, and cached cell values. Tests compare terminal reinvestment, terminal value, the equity bridge, and share value. Regenerate the capture with `python scripts/capture-benchmark.py --file <original-workbook>`. The published workbook's tax schedule, investment timing, and changing WACC differ from this application's forecast. These tests do not claim a full forecast match or a current professional fair-value comparison.

See [verification evidence and remaining limits](docs/VERIFICATION.md). Passing arithmetic tests does not prove financial completeness or forecast accuracy.

## Save and reproduce

Initial calculations run on the server. Analyst changes use the same TypeScript engine in the browser. Saved and exported results retain inputs, assumptions, source metadata, model version, and price date. Saved records from the previous model remain in the old browser storage key; this refactor uses a new key. Incompatible model exports are rejected rather than recalculated silently.

`python scripts/package-source.py` creates `public/source.zip`. It includes source, tests, workflow, captured data, and public source archives. It excludes credentials, dependencies, local output, and browser state.
