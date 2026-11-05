# Production wireless verification

Verified2026-11-06 Asia/Bangkok against https://unigo3.vercel.app/.

## Failure and correction

The phone still used the debug loopback endpoint that depended on USB forwarding. Its private endpoint setting now points to https://unigo3.vercel.app/api/positions. The existing per-vehicle token and vehicle ID were preserved; no Supabase secret was copied to the phone.

Production API initially returned503 server_not_configured. Production had no DRIVER_TOKENS_JSON. The four app-required environment values were set from the local resolved configuration: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY and DRIVER_TOKENS_JSON. The latter two are stored as Vercel Secrets. Values are not recorded here.

Vercel CLI was explicitly authorized by the user. Linked hamzcheezes-projects/unigo, deployed current source to production, and confirmed the deployment ready with unigo3.vercel.app as its production alias. Deployment ID dpl_1vZXp1yniyfi3mTeqGY41zMDVg5q.

.vercelignore excludes .env files and local dependencies/build outputs from upload. .env.local and .vercel remain Git-ignored.

## Evidence

- Production configured-token mock probe changed from503 server_not_configured to422 mock_position without inserting synthetic data.
- After the phone was unplugged, ADB listed no device and the separate Supabase subscriber received sequential fresh SHUTTLE-01 UPDATE events.
- The user restarted the trip while moving the phone, so its session differed from the initial observer snapshot. Fresh sequential updates were authenticated by the same vehicle token. No assertion was made that the obsolete session remained current.
- Vercel production CDN request records showed consecutive POST /api/positions requests with HTTP200.
- Actual Chrome production UI showed the selected car1 marker, connection to live data and updated GPS status. This verifies wireless phone -> production Vercel -> Supabase -> resident browser. No coordinate values are stored in this document.
- TypeScript and all seven behavior tests passed before production deployment; Vercel production build passed.

USB forwarding and a running local Next server are no longer required. The phone still needs internet, GPS reception and the driver service running. If those stop, the existing stale-position indicator is expected. This inspection is not an uptime or positional-error benchmark.
