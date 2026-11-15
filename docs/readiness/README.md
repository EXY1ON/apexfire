# ApexFire input proofs

**Build entry point:** [complete Claude handoff](../../CLAUDE_HANDOFF.md) → [authoritative roadmap/current state](../../PROJECT.md) → [website structure and stack specification](../website-spec.md). This page owns the dated input-proof evidence, not the build roadmap.

**Later source extension, 14 November:** [Watch Fire/WildfireSignal follow-up proofs](additional-sources.md) add sixteen original-provider assets, national-service research, practical API/download/key routes and a new Mariovo perimeter discrepancy. Roadmap/spec/handoff now include the new findings. The original preparation record below remains evidence for its unchanged inputs.

Completed 14 November 2026. Scope: close data/model preparation gaps for Claude's website build. **Inputs and bounded model experiment locally verified; website, live service, alert delivery and real-fire predictive accuracy are not implemented/validated by this work.** No website implementation or deployment.

| Order | Task | Required evidence | State |
| --- | --- | --- | --- |
| 1 | Inspect Firebase/Cloud setup and credential availability | Active project and matching web app; ADC metadata reads; zero Realtime Database instances; Firestore API disabled; no local init files | Locally verified; provisioning pending |
| 2 | Test current FIRMS and Open-Meteo | NASA NOAA-20/21 HTTP 200, 3+1 bbox detections; current weather for two MK points; 576 historical ERA5 hours | Locally verified |
| 3 | Compare weather and Earthdata access | Provider comparison; supplied bearer unlocked a protected VIIRS scientific-file prefix via credential-free CDN request | Locally verified access; forecast skill/current LANCE pending |
| 4 | Acquire Macedonian numeric fuels and inspect 2017 progression | Two numeric WCS crops; verified NFFL crosswalk; eight valid steps; official EFFIS Brvenica identity | Locally verified; field fuel/moisture accuracy pending |
| 5 | Execute real spread scenario | Compiled Pyretechnics; real terrain/fuels/weather; 3 h, final 17 modeled ha; sensitivity/barrier/orientation checks | Locally verified experimental scenario |
| 6 | Verify and hand off | Parent tests, finalized input/output hashes, visual artifacts, secret scan and scoped archive inventory | Locally verified |

Execution: weather/Earthdata, fuels/progression and spread engine work in parallel on separate paths. Main session owns FIRMS/Cloud inspection, integration judgment and final verification. Total worker budget: 60 minutes, at most four assignments, at most three active workers; no nested delegation.

Computer use refused access to Terminal, so the existing `firebase init` prompt cannot be inspected through that route. Local config/CLI inspection is the supported alternative. No `firebase.json`, `.firebaserc`, Firebase rules or app package was present in this folder at initial inspection. CLI installation alone does not establish completed project initialization.

Credentials: the user supplied a local credential-file path after initial inspection. Its permissions are owner read/write and it is ignored by Git. NASA credentials were consumed privately for the requested tests and were not copied into reports, source, command arguments, signed URLs or browser bundles. A final scan checked retained readiness text/code for the actual secret values without displaying them.

## Evidence and artifact map

| Component | Read first | Data/contract |
| --- | --- | --- |
| FIRMS + cloud/Firebase | [Access and platform report](firms-and-cloud.md) | [FIRMS manifest](../../Data/readiness/firms/manifest.json), [Cloud state](../../Data/readiness/cloud/project-state.json), [Firebase state](../../Data/readiness/cloud/firebase-state.json) |
| Weather + Earthdata | [Weather/provider/authentication report](weather-and-earthdata.md) | [Weather manifest](../../Data/readiness/weather/manifest.json), [2017 hourly CSV](../../Data/readiness/weather/event-12376-era5-2017-07-23_2017-08-15.csv), [protected-file proof](../../Data/readiness/weather/earthdata-auth-proof.json) |
| Fuels + real progression | [Numeric fuels and Brvenica report](fuels-and-progression.md) | [Fuel manifest](../../Data/readiness/fuels/manifest.json), [observed perimeters](../../Data/readiness/progression-2017/observed-perimeters.geojson), [progression manifest](../../Data/readiness/progression-2017/manifest.json) |
| Spread experiment | [Model assumptions, checks and reproduction](spread-scenario.md) | [Final manifest](../../Data/readiness/spread-scenario/manifest.json), [scenario perimeters](../../Data/readiness/spread-scenario/mariovo-perimeters.geojson), [arrival raster](../../Data/readiness/spread-scenario/mariovo-arrival-minutes.tif), [figure](../../Data/readiness/spread-scenario/mariovo-scenario.png) |
| Added source/context proofs | [Access routes, contracts and discrepancies](additional-sources.md) | [16 original assets](../../Data/readiness/additional-sources/manifest.json), [national-service research](../../Data/readiness/additional-sources/mkffis-research-manifest.json), [Mariovo comparison](../../Data/readiness/additional-sources/mariovo-official-comparison.json) |

The final scenario has 2, 4, 11 and 17 modeled hectares at 30, 60, 120 and 180 minutes. A preliminary 25 ha run used an earlier fuel preparation and was superseded after parent verification found mismatched input hashes. The model was rerun once against final inputs; every recorded input/output hash now matches. Ignition/moisture remain explicit assumptions; canopy is deliberately zero for a surface-only experiment. This is not a reconstruction of the historical fire or a validated forecast.

## Readiness boundaries for Claude

- **Ready to integrate:** dated historical detections; actual NOAA-20/21 response examples and a credential-safe fetch tool; current weather samples and a provider-neutral hourly contract; numeric local fuels; eight sourced Brvenica observations; a real engine's precomputed scenario and outputs.
- **Weather choice:** retain Open-Meteo for prototype access/cost/integration fit, not a claim of superior local accuracy. Choose/test a supported explicit model at integration; the legacy ICON alias used in this dated proof is documented to retire on 30 November 2026. Meteomatics account entitlements remain untested.
- **Firebase/Cloud choice:** existing web app/Hosting registration is confirmed, but no local init config or realtime database exists. Firebase distributes updates written by an ingestion process; it does not supply satellite data. The Firebase and research GCP projects have different billing states. Select project, region, ingestion refresh and security rules before provisioning; do not assume the reported credit applies to both.
- **Not established:** live fuel moisture/canopy, fine-scale winds, calibrated spread skill/probabilities/arrival forecasts, notification delivery, uptime/availability, public deployment or ongoing automated ingestion. These remain implementation/research/release work, not a hidden claim that every ambition is complete.
- **Secrets:** use trusted ingestion for NASA/Meteomatics credentials. Keep the local private credential file and raw 24 GB archive outside any public website/deployment boundary. Retain attribution and current engine/data licenses.
- **Observed vs modeled:** Brvenica GeoJSON is observed satellite-derived burned area at actual acquisition times (timezone convention labeled). Mariovo scenario GeoJSON is model output from hypothetical ignition/moisture. Their schemas label the distinction; do not merge them into one factual growth timeline.

## Checks and reproduction

```sh
python3 -m unittest discover -s tests -p test_check_firms.py -v
python3 -m unittest discover -s tests -p test_audit_scope.py -v
python3 tools/check_weather.py --self-test
python3 tools/check_weather.py --verify-saved
.venv/bin/python tools/prepare_spread_inputs.py --self-test
MPLCONFIGDIR=/private/tmp/firewatch-mpl /private/tmp/firewatch-spread-py311/bin/python -m unittest discover -s tests -p test_spread_scenario.py -v
```

The separate model environment and pinned requirements are described in the scenario report; the project environment was preserved. Parent independently ran the focused tests, checked data/hash contracts and inspected the figures. The raw archive audit now selects original MODIS/VIIRS batch paths so new weather/progression CSVs cannot be mistaken for sensor downloads. Its path set exactly matches the previous 7,263-file inventory; the 24 GB archive was not re-read.

## Website continuation

Use the [complete Council handoff](../../CLAUDE_HANDOFF.md) for the next build session. Its recommended screens/stack and the roadmap supersede the earlier short handoff; the scientific evidence and reproduction commands above remain valid for unchanged inputs.

Used: standard-library FIRMS/weather tools, EFFIS WCS/WFS, Earthdata token proof, Pyretechnics, read-only Firebase/Cloud checks and three subagents requested at GPT-6.1-sol/medium (applied settings unverified). Friction: Terminal UI access blocked; supported CLI checks used; expired EFFIS ZIP-host certificate avoided through valid-TLS WCS; model build isolated to Python 3.11. Unverified: real-fire accuracy, local fuel/moisture/canopy truth, live LANCE, Meteomatics entitlements, cloud credits, alert delivery and deployment.
