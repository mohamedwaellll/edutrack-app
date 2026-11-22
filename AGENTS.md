# EduTrack Developer Workspace & Operating Model

## Working Model & Ownership
- **Sole Developer:** Mohamed now owns the entire project and all files across the repository.
- **Superseded Assignments:** Previous task distributions to Ali, Abdelrahman, Mina, and Youssef are superseded. No teammate coordination or multi-agent handoff is required.
- **Branch & Baseline:** Work proceeds sequentially on `feature/admin-teacher-workflows` preserving all historical records and uncommitted work.
- **Canonical Stack:** React 18 / Vite / TypeScript / Supabase. Do not replace with or wholesale merge legacy Next.js code.
- **Documentation:** Start with README.md for the local test demo and docs/INTEGRATION_CONTRACT.md for the database contract.

## Sequential Work Sequence
1. **Stage A (Milestone 5.1 - CURRENT TASK):** Teacher-management integrity, database permissions, error handling, input validation, submission guards, and regression test coverage.
2. **Stage B:** Authentication, account linking, role routing, and database authorization (fail-closed, no mock fallback).
3. **Stage C:** Teacher workflows scoped to assigned groups (server-enforced group ownership, server-derived feedback author).
4. **Stage D:** Student portal using real authorized data (read-only profile, attendance, grades).
5. **Stage E:** Parent portal using explicit child links (`parent_student_links`) and parent-visible notes.
6. **Stage F:** Final QR/camera checks, full integration testing, presentation rehearsal, and verification.

*Note: Proposed architecture must be strictly distinguished from implemented functionality in all documentation.*

## Core Development Rules
- Enforce authorization at the database layer (PostgreSQL RLS + minimal column/table privileges).
- No runtime mock fallbacks or fake save successes. Failed queries must never appear as empty data or "Unassigned".
- Test using real migration grants and isolated PostgreSQL engines (e.g. PGlite).
- Run `npm test -- --run` and `npm run build` after changes.
- Distinguish local automated test results from actual browser, hosted Supabase, or physical hardware verification.
- No secrets, force pushes, destructive resets, hosted SQL execution, or unapproved deployments.
