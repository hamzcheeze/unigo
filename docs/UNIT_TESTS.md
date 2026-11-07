# Run unit tests

From the project root, run:

```sh
./scripts/test-unit.sh
```

The command runs web type checking, the web unit tests with coverage, and three pure Java checks. Install the web dependencies in `unigo/` first. Use Node.js 22 and JDK 17. The script selects the local Homebrew JDK 17 when available, or uses `JAVA_HOME` or Java on `PATH`.

For web tests alone, run `npm test` inside `unigo/`. Run `npm run test:coverage` there to include the coverage report. These commands do not require real GPS, production credentials, Supabase, or TomTom. API unit tests replace external fetches with controlled responses, including network failures.

## Covered behaviors

| Area | Normal and edge cases |
| --- | --- |
| GPS schemas and freshness | Inclusive coordinate and measurement bounds, NaN and infinity, missing and wrong types, UUIDs and dates, safe integers, exact age and future-time cutoffs, revision merge and vehicle isolation. |
| Driver ingestion | Vehicle-bound tokens, token length and alphabet, malformed configuration, authentication, stale/future/mock positions, valid commit and rejected writes, malformed and unavailable storage replies. |
| Request body | Exact 8,192-byte boundary, UTF-8 byte count, characters split across chunks, malformed JSON and UTF-8, read errors, cancellation, released readers. |
| Resident location | Success, permission denial, retry exhaustion, exact freshness bounds, invalid coordinates and accuracy, thrown errors, hard deadlines, pre-cancellation and late callbacks. |
| Geofence and pickups | Distance symmetry, zero distance, poles, antipodes, antimeridian, radius and accuracy uncertainty, nearest pickup. |
| ETA | Stale and inaccurate GPS, wrong vehicle, route age, before/after endpoints, off-route threshold, ambiguous geometry, repeated and empty geometry, zero provider totals. |
| Route cache | Pair isolation, concurrent request sharing, reuse, explicit refresh, previous-route preservation, mismatched responses, retry limit, cancellation, recovery, exact 30-second retry boundary. |
| Route API | Strict input, unavailable storage, stale/inaccurate/out-of-area vehicle, provider errors and malformed responses, 2 MB response limit, heading selection, coalescing, cached failures, exact cache expiry. |
| USB preview API | Production disabled, preview flag, local hostname restrictions, origin checks, streamed SSE response and cancellation signal, missing or failed bridge. |
| Android pure Java | GPS ordering and rejected-fix recovery, coordinate extremes, exact 10-second and nanosecond cutoffs, monotonic-to-wall-clock conversion, invalid clocks, long integer extremes, HTTPS policy and USB endpoint lookalikes. |

## Read coverage correctly

The 7 November 2026 final run passed 97 web tests and all three Java check programs. The baseline had 35 web tests. Six redundant cases were removed during review. Type checking passed. Web coverage reported 99.80% lines and 96.03% branches for the executed source modules. The raw output is in `../../artifacts/unit-tests/results.log`.

Native Node.js coverage lists files loaded during the tests. It does not automatically count unimported source files. Coverage also counts declaration and transpiled code, so a high percentage does not establish that every possible input has been tested. The remaining uncovered line in the routing API is a defensive missing-stop check after schema validation has already restricted the stop ID to configured values.

These are unit tests of pure logic and HTTP handler behavior. React rendering and hooks, browser map interaction, SQL transactions/RLS/concurrency, Supabase Realtime delivery, Android services and uploader threads, physical GPS, and battery/background behavior require separate component, integration, or device tests. The existing SQL and live load scripts cover separate parts of that scope and are not invoked by the unit command.
