# Public repository landscape for ApexFire

Inspected 14 November 2026. Scope: six useful public repositories for a North Macedonia-first satellite-fire calendar and map, with current observations, weather and incident context. This is source inspection, not an execution or scientific-validation report. No third-party code was installed or run. Commit links below pin the inspected candidates; deployment claims are attributed to their authors.

## Decision

**Use the repositories selectively. There is no verified, licensed, complete ApexFire starter among these six.** `firms-client` is the best small ingestion candidate; Pyra provides a licensed static publishing pattern; NexFiremap offers reusable Python feed/provenance modules but would be excessive as the application base. The closest calendar and TypeScript interface references have no repository-wide reuse license in the inspected trees or README grants. Public visibility is not a code-reuse license; GitHub explains the distinction in its [licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).

| Repository | Best use for ApexFire | Code reuse at inspected revision | Main gap |
| --- | --- | --- | --- |
| [firms-client](https://github.com/agent-engineering-studio/firms-client) | Small Python archive/NRT client | Apache-2.0 | No cross-sensor scientific harmonization or web UI |
| [Pyra](https://github.com/Co973/pyra) | Scheduled Python → static JSON publishing | MIT | Heuristic weather risk; coarse grid; parser needs correction |
| [NexFiremap](https://github.com/L1-0/NexFiremap) | Selected FIRMS/provenance/cache methods | MIT, plus vendored notices | Large local operations system; no long-term harmonized calendar |
| [WildfireWatch](https://github.com/DoArtMonteiro/wildfire-watch) | Map/panel, freshness and observation-model reference | No repository-wide license found | S-NPP-only source contract; no historical calendar |
| [Ember Atlas](https://github.com/snslighting/ember-atlas) | Calendar, missing-data semantics, partitioning and replay reference | No repository-wide license found | Limited prepared historical regions; no MK archive |
| [Wildfire Calendar](https://github.com/romiisromie/wildfire-calendar) | Understandable calibration/holdout baseline | No repository-wide license found | Same-day hackathon prototype; outage inference and coarse cells |

“Best” here means fit to the current task, integration burden and rights clarity, not an independent quality certification.

## 1. firms-client — strongest small ingestion candidate

Revision [`db1f52cb44cf48d275a06cf566b8529fe6a61480`](https://github.com/agent-engineering-studio/firms-client/tree/db1f52cb44cf48d275a06cf566b8529fe6a61480), last commit 4 November 2026; created 3 November. [Package configuration](https://github.com/agent-engineering-studio/firms-client/blob/db1f52cb44cf48d275a06cf566b8529fe6a61480/pyproject.toml) identifies version 0.5.0, beta, Python ≥3.12 and one core dependency, `httpx`.

Observed: [client.py](https://github.com/agent-engineering-studio/firms-client/blob/db1f52cb44cf48d275a06cf566b8529fe6a61480/src/firms_client/client.py) supports cached country archives, atomic partial-file downloads and keyed area queries. [hotspots.py](https://github.com/agent-engineering-studio/firms-client/blob/db1f52cb44cf48d275a06cf566b8529fe6a61480/src/firms_client/hotspots.py) preserves native confidence, detection type, sensor metadata and pixel dimensions. Its scope is global FIRMS; fixtures and worked examples are Italian. Tests exercise missing archives, false-success HTTP responses and caching; they were inspected, not run.

Reuse: parsing, typed records and archive/NRT request handling, if these are still needed after using ApexFire's existing local CSVs. Avoid adding its optional AI/MCP features merely for ingestion.

Rights: actual [Apache-2.0 LICENSE](https://github.com/agent-engineering-studio/firms-client/blob/db1f52cb44cf48d275a06cf566b8529fe6a61480/LICENSE) inspected. Keep the license and applicable notices; mark modified files and retain any applicable NOTICE material. Data rights remain separate.

Gaps: new project, no MK validation or scientific sensor calibration. Parser time checking accepts HHMM values by numeric range without checking minute <60; select/filter policy also retains some unknown fields. Review these boundaries before adoption.

## 2. Pyra — useful licensed static pipeline, limited science

Revision [`d51bfd0741cc46726e20433d6add17750788ac43`](https://github.com/Co973/pyra/tree/d51bfd0741cc46726e20433d6add17750788ac43), last commit 14 November 2026; created August 2026. Actual [MIT license](https://github.com/Co973/pyra/blob/d51bfd0741cc46726e20433d6add17750788ac43/LICENSE): retain its copyright and permission notice with substantial reused code.

Observed: [FIRMS ingestion](https://github.com/Co973/pyra/blob/d51bfd0741cc46726e20433d6add17750788ac43/scripts/fetch_firms.py), [EONET ingestion](https://github.com/Co973/pyra/blob/d51bfd0741cc46726e20433d6add17750788ac43/scripts/fetch_eonet.py), POWER weather scripts, scheduled workflows and a static `docs/` app exist. Global detections become JSON; EONET adds selected curated wildfire-event context. The [README](https://github.com/Co973/pyra/blob/d51bfd0741cc46726e20433d6add17750788ac43/README.md) clearly labels the 2° regional score as a heuristic and spread cones as wind-only illustrations. Included demo data must stay visibly distinct from refreshed observations.

Reuse: the modest scheduled-fetch → atomic JSON → static-host workflow, error metadata and source attribution structure. This fits a prototype better than importing a large server.

Gaps: no historical sensor calibration. [Line 18](https://github.com/Co973/pyra/blob/d51bfd0741cc46726e20433d6add17750788ac43/scripts/fetch_firms.py#L18) excludes `low` but accepts native VIIRS `l`; correct that before reuse. Cross-sensor rounding/dedup is not harmonization and loses product identity. POWER observations and a coarse heuristic are insufficient for a local operational spread forecast; EONET's limited open-event query is not a complete MK incident register.

## 3. NexFiremap — reuse modules, not the whole operations desk

Revision [`6bbc3744f487547b9e4770a22b9aee64b5fce860`](https://github.com/L1-0/NexFiremap/tree/6bbc3744f487547b9e4770a22b9aee64b5fce860), last commit 16 August 2026; created August. Actual [MIT license](https://github.com/L1-0/NexFiremap/blob/6bbc3744f487547b9e4770a22b9aee64b5fce860/LICENSE) inspected. Preserve its existing copyright notice even though the README calls the holder a placeholder; add ApexFire's notice for our changes rather than deleting upstream attribution. Vendored libraries carry separate notices.

Observed: a substantial Python local server with SQLite, Leaflet/MapLibre, event clustering, weather/terrain analysis and incident-management modules. [firms.py](https://github.com/L1-0/NexFiremap/blob/6bbc3744f487547b9e4770a22b9aee64b5fce860/nexfiremap/firms.py) classifies body-level FIRMS errors and preserves raw rows; [provenance.py](https://github.com/L1-0/NexFiremap/blob/6bbc3744f487547b9e4770a22b9aee64b5fce860/nexfiremap/provenance.py) distinguishes model generation from input-reference time. Global FIRMS, Open-Meteo, Copernicus terrain/land-cover and optional EUMETSAT inputs are documented.

Reuse: selected feed parsing, request-window/cache concepts and provenance fields. Existing test scripts are useful adoption checks, not proof of model accuracy.

Gaps: much broader than a hackathon calendar; no demonstrated MK fuel calibration or harmonized 2000–2025 series. The [README](https://github.com/L1-0/NexFiremap/blob/6bbc3744f487547b9e4770a22b9aee64b5fce860/README.md) says EFFIS integration was not built. Treat spread/operations claims as unverified until independently tested; data, imagery and tile terms remain provider-specific.

## 4. WildfireWatch — strongest TypeScript product reference

Revision [`41e96a9c158ba63fe90078ee862b0f0b0a23c101`](https://github.com/DoArtMonteiro/wildfire-watch/tree/41e96a9c158ba63fe90078ee862b0f0b0a23c101), last commit 4 October 2026; repository pushed 12 November. These are different metadata dates. No repository-wide license found in its tree or README.

Observed: Next.js/TypeScript, MapLibre and Cloudflare Worker/KV source with hourly ingestion, map selection, details, weather, air quality and news. Global display sampling deliberately prioritizes Portugal. [types.ts](https://github.com/DoArtMonteiro/wildfire-watch/blob/41e96a9c158ba63fe90078ee862b0f0b0a23c101/src/lib/wildfire/types.ts) separates observations, inferred/estimated values and operational status. [The adapter](https://github.com/DoArtMonteiro/wildfire-watch/blob/41e96a9c158ba63fe90078ee862b0f0b0a23c101/src/lib/wildfire/firms-adapter.ts) reads cached snapshots and carries ingest health. [README](https://github.com/DoArtMonteiro/wildfire-watch/blob/41e96a9c158ba63fe90078ee862b0f0b0a23c101/README.md) reports a live portfolio deployment and automated checks; runtime was not verified here.

Reuse: behavioral specification for accessible map/list/detail flows and honest freshness states; independently implement or obtain permission before copying code.

Gaps: source contract explicitly hardcodes `VIIRS_SNPP_NRT`; ApexFire's current project record requires NOAA-20/21 for fresh observations. EFFIS/ANEPC are planned, not implemented. No long historical calendar. Cloudflare-specific server choices and direct third-party browser requests add deployment/privacy decisions that ApexFire need not inherit.

## 5. Ember Atlas — strongest historical-data semantics reference

Revision [`ff0c74754e93c05cb503d43e364bd112f997f807`](https://github.com/snslighting/ember-atlas/tree/ff0c74754e93c05cb503d43e364bd112f997f807), last commit 4 October 2026; created October. No repository-wide license found; vendored library licenses do not license the author's application code.

Observed: static JavaScript map/calendar/replay code, compressed geographic/year partitions, provenance manifests and tests. [Historical metadata](https://github.com/snslighting/ember-atlas/blob/ff0c74754e93c05cb503d43e364bd112f997f807/data/history/metadata.json) contains source URLs, timestamps and hashes. [harmonization.js](https://github.com/snslighting/ember-atlas/blob/ff0c74754e93c05cb503d43e364bd112f997f807/harmonization.js) retains product-level support and identifies approximate footprint assumptions. Prepared historical cases cover Uzbekistan plus seasonal California/Amazon windows; monitoring also documents an Australian case. A worldwide daily GIBS browser is distinct from these calibrated seasonal archives.

Reuse: missing-vs-zero coverage, SP/NRT separation, lazy partition loading, raw-versus-derived units and historical playback as design/method references.

Gaps: [README](https://github.com/snslighting/ember-atlas/blob/ff0c74754e93c05cb503d43e364bd112f997f807/README.md) says the monitoring upgrade is not deployed; global historical browsing does not provide global calibrated seasonality. It acknowledges no cloud/overpass exposure mask, incomplete regions and best-effort NRT continuity. No MK case or independent scientific validation was established. Obtain permission for code, or rebuild the behavior from a specification.

## 6. Wildfire Calendar — compact same-challenge baseline

Revision [`065fc21af6c14cc2da0b8e59acec804905e18be7`](https://github.com/romiisromie/wildfire-calendar/tree/065fc21af6c14cc2da0b8e59acec804905e18be7), created and last committed 14 November 2026. No repository-wide license found. The [README](https://github.com/romiisromie/wildfire-calendar/blob/065fc21af6c14cc2da0b8e59acec804905e18be7/README.md) identifies the same NASA Space Apps 2026 harmonization challenge; this establishes relevance, not challenge compliance or maturity.

Observed: Streamlit/Python app, monthly/weekly calendar, anomaly views and CSV export; Kazakhstan/Argentina stores are included. [harmonize.py](https://github.com/romiisromie/wildfire-calendar/blob/065fc21af6c14cc2da0b8e59acec804905e18be7/harmonize.py) implements active 0.1° cell-days, monthly ratio shrinkage, Terra-era scaling and leave-one-year-out evaluation. [climate.py](https://github.com/romiisromie/wildfire-calendar/blob/065fc21af6c14cc2da0b8e59acec804905e18be7/climate.py) uses POWER history; [nrt.py](https://github.com/romiisromie/wildfire-calendar/blob/065fc21af6c14cc2da0b8e59acec804905e18be7/nrt.py) requests NOAA-20 seven-day files and exposes retrieval time.

Reuse: a plain, explainable baseline and evaluation idea, independently implemented. No test files were present in the inspected tree.

Gaps: 0.1° cells are coarse for MK; zero-detection days are generally filled as zero, while the README infers country-wide outages from MODIS/VIIRS disagreement. Neither establishes actual observation coverage. Trust labels are prototype thresholds, not calibrated probabilities. S-NPP historical calibration does not by itself validate a switch to NOAA-20 NRT.

## What ApexFire must still supply

1. **A suitable MK calibration record.** Current `PROJECT.md` records S-NPP only for 2024–2025, NOAA-20 for 2018–2025 and missing MODIS 2013. The same-challenge prototype's 2013–2025 S-NPP calibration cannot simply be applied to that input. Either source the needed overlap or validate NOAA-20 against MODIS in the available common years. Preserve satellite/product identity and explicitly evaluate the handover.
2. **Detection/incident separation.** Maintain raw observations, derived activity, verified incident context and any forecast as distinct claims. Retain UTC acquisition, source product, processing class, original confidence, FRP units, fetch time and quality-accounting counts. Agricultural burning and industry require more than a confidence cutoff.
3. **Coverage and evaluation.** Missing files, outages and incomplete source periods must remain distinct from observed zero activity. Evaluate cross-sensor transfer on held-out periods and report error/sample size. Do not turn detector counts, occupied cells or summed pixel footprints into unique fires or burned hectares.
4. **A bounded frontend.** Preprocess existing MK data and publish small date/region partitions; never send the 302-million-row archive to the browser. A Vite/React map can consume plain versioned JSON without adopting Next.js, Cloudflare KV or an operations database solely because a reference uses them.
5. **Current weather and incident context.** Open-Meteo is the stated ApexFire direction; POWER code is useful historical-method context, not a reason to reopen that choice. No candidate supplies a complete official MK incident feed. The Mariovo case remains a bounded historical demonstration; EONET and news are supplementary context, not exhaustive incident truth.
6. **Rights and validation.** Copy licensed modules only with required notices. Re-fetch scientific inputs from their original providers and record their terms/attributions separately from code licenses. No inspected repository closes the MK fuel/moisture, dynamic perimeter or spread-validation gaps recorded in `PROJECT.md`.

## FireMap.live and screened alternatives

The [FireMap.live profile](https://firemap.live/profile.html) names FireDB and claims FIRMS/EFFIS/regional integration. No official GitHub source repository was established by this bounded search. Its service and interface can inform a behavioral specification; neither its frontend nor FireDB data is assumed reusable. The separate FireMap.live inspection owns runtime findings.

Other same-challenge projects surfaced, including [Burn Calendar](https://github.com/alfanditora/burn-calendar) and [Kiln Watch](https://github.com/Aalvee-Aarham/kiln-watch). Their trees/metadata were screened and no repository-wide licenses found; they were not promoted into additional full recommendations. [LA Times noaa-wildfires](https://github.com/datadesk/noaa-wildfires) has an inspected MIT license and simple NOAA HMS fire/smoke conversion code, but its geography does not close MK requirements, so it is not a recommended ApexFire dependency.

Status: **source inspection completed; adoption and runtime validation pending**. Only this research file was created. No cloning, installing, executing, publishing or remote changes performed.
