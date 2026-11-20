# Handoff status — 20 November 2026

Development baseline, NOT release-ready certification.

## Verification during preparation

96 tests passed across 10 files on Node 26.8.1. Production build passed.
Existing warnings: auth React act(), jsdom chart dimensions, experimental localStorage, large bundle.
The legacy lint script lacks configured ESLint dependencies/config. CI runs tests and build; lint is not claimed passed.
Hosted deployment, live multi-role acceptance, and physical camera verification are not certified here.

## Outstanding first task: Milestone 5 review

- getTeachers ignores group-query errors; UI may show false Unassigned.
- Client-only user_id stripping is not a database creation boundary.
- Broad groups UPDATE and unnecessary teachers REFERENCES grants.
- JS/SQL email validation mismatch and unnecessary sanitizer definer rights.
- Submission guards/component regressions need completion.
- Historical preservation requires before/after rows, not count > 0.

These findings were not silently implemented during repository preparation. They are in Mohamed's prompt.
Do not apply ...000005 alone as a final accepted teacher-management rollout. Review its forward correction first. Already-applied history must not be rewritten.

## Team integration gates

Teacher/student/parent live authorization and parent links remain open. Parent UI still includes static data.
The legacy ali branch is Next.js and removes Vite files; keep it for reference only.
GitHub invitations and branch protection are account settings not configured by this package.
Remote publication is pending authentication until a verified push is recorded. Do not assume the remote was updated based on these local files.

## Publishing from an authenticated computer

Run `powershell -ExecutionPolicy Bypass -File scripts/publish-team-start.ps1` from this local repository after GitHub sign-in.
The script publishes the prepared branches and tags atomically, without force, and leaves the legacy ali branch untouched.
The old remote main is retained as `pre-team-start-20261120`. The new local baseline is tagged `team-start-20261120`.
After a successful push, Mohamed must add the four collaborators using their actual GitHub usernames and confirm they can fetch their branches.
Configure branch protection for main/develop and require the CI job before merging; these account settings are not automatically applied here.
Existing application changes contain trailing-whitespace findings from `git diff --check`; that check is not reported as passing.
