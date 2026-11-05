# Physical sender verification

Verified2026-11-05 with ASUS_X008D Android7 and APK0.2.0. Three distinct private vehicle tokens are configured. SHUTTLE-01 token only is on the phone. The ignored .env.local contains server secrets; none are embedded in APK or this document.

The real Android sender reached local Next /api/positions through adb reverse. API returned200, Supabase emitted INSERT and UPDATE events, and row session/sequence/coordinates matched the phone's actual captured fix. Frontend position schema accepted the row and actual browser displayed car1 marker and capture/receipt times. No coordinate values are persisted in this verification document.

GPS raw provider time had a1024-week rollover. CaptureClock normalizes with system wall time minus monotonic age and preserves raw providerTimeMs. Three pure Java behavior checks, debug/release builds, TypeScript and seven web tests pass. Android lint has one unresolved preexisting permission-range annotation issue at removeUpdates; it was not suppressed or represented as passed.

When physical GPS stops updating, the browser marks the last point stale. This is expected and does not imply a websocket failure. Continuous road reception, all OEM battery behavior, zero-error accuracy and wireless Vercel endpoint have not been verified. The current test requires USB and a running local Next server. Change driver endpoint to the real HTTPS deployment to remove that dependency.
