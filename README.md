# Parent Portal dashboard handoff

This folder contains the first-week parent dashboard UI for EduTrack.

## Included

- `ParentDashboard.tsx`: responsive Arabic RTL parent dashboard styled with the approved Parent Portal palette.
- The student, grade, report, and activity values are demonstration data so the layout can be reviewed before backend integration.

## Integration requirements

- React and TypeScript
- Tailwind CSS configured in the host app
- `recharts` for the subject performance chart

Import `ParentDashboard` into the parent route/page when the application scaffold is available. Keep the sample arrays separate or replace them with the agreed data interface during the database integration work.

## Scope

This is the dashboard UI only. Supabase queries, parent/student authorization, attendance Realtime subscriptions, and PDF export belong to later integration work and are not implemented here.

The repository currently has no application scaffold or `package.json`, so this component cannot be run from this repository until the team adds the app setup.
