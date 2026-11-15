# ApexFire website preparation: research and remaining proofs

**Current build plan:** PROJECT.md (local-only), [website specification](../website-spec.md) and complete Claude handoff (local-only). The text below is a discovery-stage snapshot; its original open tasks do not override later readiness evidence or current implementation status.

**Published repository note:** the capture folders `wildfiresignal/`, `firemap-live/` and `watch-fire/` hold third-party pages, scripts, API responses and images; they are kept locally as evidence and are not in the public repository. Links to them from these reports resolve only in the local working copy.

**Competitive review (15 Nov 2026):** [ApexFire against nine wildfire maps](competitive-review-2026-11-15.md): capability matrix and ranked missing features.

**Follow-up site investigations:** [Watch Fire](watch-fire.md) and [WildfireSignal North Macedonia](wildfiresignal.md) examine actual public implementation/features and original providers. [Additional-source proofs](../readiness/additional-sources.md) record the resulting downloads, exact access/credential paths, EFFIS discrepancy and national FWI adoption limits. These are current extensions, rather than unexecuted discovery suggestions.

Checked 14 November 2026. **Research findings consolidated; selected public interfaces and one new reference dataset locally verified. Full website/model readiness is not yet established.**

**Subsequent execution:** the [current readiness evidence and Claude handoff](../readiness/README.md) now records tested FIRMS/weather/Earthdata access, acquired numeric fuels, verified Brvenica progression and a real bounded spread run. The discovery-stage readiness table below is retained as the original investigation plan; use the current readiness record for implementation state.

## Scope and decisions carried forward

ApexFire is a North Macedonia-first NASA Space Apps web prototype using real satellite and environmental data. Historical activity/calendar, current detections, weather/wind, incident context and an experimental spread scenario are objectives; not every advanced proposal is a first-release requirement. The user agreed to Mariovo 2024 replay plus an experimental what-if as the initial spread demonstration. Website first, presentation second; last stated deadline 15 November 2026, 15:00 Europe/Skopje. Claude builds the website; Codex researches and independently reviews it. Technology choices remain open; Open-Meteo and OpenStreetMap are the stated source directions.

This investigation answers the user's request to examine similar projects, GitHub reuse and Firemap Live's public sources before building. It did not create a website, adopt a framework, enable services, publish a repository or install a spread model.

## Read these in order

1. [Firemap Live investigation](firemap-live.md): observed capabilities, public layer registry, REA evidence, bounded samples, source conflicts and reuse boundaries.
2. [Repository landscape](repository-landscape.md): six pinned source reviews, licenses, reusable components, concrete adoption defects and scientific gaps.
3. [Spread engines and data](spread-models-and-data.md): models, current licenses, European fuels/fire weather, observed progression and rapid MTG/SLSTR observations.
4. Existing [data audit/research](../data-research.md) and [Mariovo findings](../case-studies/mariovo-2024/README.md) remain the evidence for earlier downloads.

## Results that change the build plan

- **Firemap demonstrates monitoring overlap, not every ApexFire objective.** Its pass forecast is satellite observation timing, not modeled fire growth. Wind visualization does not implement combustion propagation.
- **Public Firemap interfaces are inspectable.** Saved WFS metadata advertises 24 feature types; selected samples and live browser responses were verified. Private ETL, all historical holdings, scientific accuracy and every transformed layer's reuse terms remain unknown. An aggregator should not become our sole source of truth by default.
- **Small licensed reuse exists.** `firms-client` (Apache-2.0) is an ingestion candidate; Pyra and NexFiremap (MIT) offer selected patterns/modules. Several close historical/TypeScript prototypes have no repository-wide license. Source inspection found defects, stale S-NPP assumptions and unvalidated heuristics; none is an adopted complete base.
- **New local progression reference acquired.** FireSpread_MedEU v2: 2.75 MB ZIP, CC BY 4.0, verified source checksum, 103 events. Event 12376 geographically matches North Macedonia and has eight burned-area steps in July–August 2017. Geometry/quality inspection and weather alignment are still required before predictive evaluation. [Manifest](../../Data/reference/fire-spread-medeu/manifest.json).
- **Rapid European observations identified.** LSA SAF MTG FCI FRP offers 10-minute nominal sampling and published demonstration-status latency, with explicit CC BY terms. North Macedonia is in the geographic footprint; numeric access, local sensitivity and authentication still require a sample test. SLSTR is a complementary polar source. Neither is a spread model.
- **Fuel and engine readiness remain decisive.** EFFIS/FIRE-RES have more relevant fuel inputs than WorldCover alone; no valid local numeric fuel/moisture stack or executed spread engine was established. Pyretechnics currently has custom noncommercial/commercial terms, not an unrestricted permissive license.

## Bounded readiness checks before each feature is handed to Claude

| Website capability | Available foundation | Small proof still needed | Safe behavior if proof is pending |
| --- | --- | --- | --- |
| Historical map/calendar | 47,046 MK detections; audit and coverage records | Export a small attributed sample/partition; verify filters, dates and sensor distinctions | Ship observed activity with gaps; no unsupported combined trend |
| MODIS/VIIRS harmonization | NOAA-20/MODIS overlap 2018–2025; NPP 2024–2025 | Choose statistic, quality/coverage policy and held-out evaluation | Separate sensor series rather than claim scientific comparability |
| Current detections | FIRMS documented; licensed ingest candidates | One working NOAA-20/21 request with correct parsing, source age and failure handling; keep key outside browser | Explicit stale/unavailable state; historical mode remains usable |
| Weather/wind | Open-Meteo selected; Mariovo historic sample | One actual current/forecast request for MK, units/time/model and cache behavior | Historical weather visibly dated; never fabricate current values |
| Incident details/extent | Mariovo report, source geometry and imagery | Choose displayed measurements and source each claim; first-observed separate from ignition | Show observations and source-reported dates/extent with limits |
| Historical progression | New 2017 MK candidate; eight dated steps | Inspect geometries/quality and absence rows; export only real acquired observations | Replay at observed dates without invented hourly growth |
| Fire-danger layer | EFFIS FWI/WMS access documented | One valid MK layer/point response, legend, issue/valid time and selected-layer terms | Mark pending; no arbitrary weather score named FWI |
| Experimental spread | Candidate engines; terrain and broad cover | Engine smoke test + aligned fuels/moisture/ignition/weather; output and assumptions inspected | Keep feature pending; do not replace with a wind cone called prediction |
| Notifications | User objective; no implementation | Define channel/trigger, deduplication and a delivery test | In-site new-detection indicator only if implemented/tested |
| Exposure/context | OSM direction; public map/reference patterns | Acquire bounded roads/settlements/protected-area extracts and verify attribution/coverage | Basemap context; no calculated exposure totals |
| MTG/SLSTR enhancement | Original products and terms located | Numeric product access and valid MK sample; revisit/latency/QA check | Optional later observation track, not a core blocker |
| Public release | Website absent, repo planned | Select stack, deploy path, attribution, credentials, compact data and essential journey checks | No ready-for-release claim |

These are proofs, not a demand to collect every global dataset. Mark a feature ready only when its selected input contract works. A feature may remain explicitly pending without blocking unrelated interface work.

## Acquisition and verification boundaries

- New scientific download: `Data/reference/fire-spread-medeu/`, preserving the original ZIP, record metadata, checksum manifest and inspection summaries. A small Natural Earth MKD outline supports coarse geographic screening; its public-domain source/scale is recorded in the manifest.
- Firemap research samples: `docs/research/firemap-live/`. They are small point/polygon/metadata observations, not a worldwide archive or approved production dependency. No application code was copied from Firemap.
- Two bounded browser scenarios ran in an owned temporary Brave/Chromium profile; the provider terminated it afterward. One global capture had network-body limitations; the MK metadata/accessibility capture reported complete selected coverage.
- No authenticated NASA/LSA SAF live integration, model installation, numeric fuel download, alert delivery, source accuracy or full app journey was verified. Existing raw archive was preserved; no 24 GB rehash was performed.

Used: REA, public GitHub connector, primary-source web research, local manifests and two read-only research subagents (requested GPT-6.1-sol/medium; applied values unverified). Friction: ordinary shell DNS restriction, browser-scenario schema detail and partial network-body capture; public HTTPS acquisition succeeded through approved access. Unverified: remaining feature proofs in the table, operational predictive accuracy and selected transformed-feed adoption terms.
