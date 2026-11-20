# EduTrack team workspace
Read docs/TEAM_START_HERE.md, HANDOFF_STATUS.md, TEAM_OWNERSHIP.md and INTEGRATION_CONTRACT.md before editing.
Canonical application: React/Vite. Do not replace it with the legacy Next.js ali branch.
Preserve uncommitted work and historical migrations. Respect ownership and coordinate shared files.
No runtime mock fallback or fake save success. Enforce authorization at the database layer.
Test using actual migration grants. Run relevant tests and npm run build.
No secrets, force pushes, destructive resets, hosted SQL or deployment without explicit task authorization.
State local/browser/hosted/hardware verification separately.
