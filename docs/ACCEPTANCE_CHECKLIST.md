# Demo acceptance

Record PASS / FAIL / BLOCKED, tester/date/environment/evidence for every item.

- [ ] Reviewed teacher-management correction applied in order.
- [ ] Admin creates teacher/group/student and links demo accounts securely.
- [ ] Duplicate-case teacher email rejected; failed forms retain data.
- [ ] Assign/reassign/unassign persists without changing historical rows.
- [ ] Card prints/scans; repeated QR preserves first arrival time.
- [ ] Wrong group, inactive student and manual-absence conflict rejected.
- [ ] Real camera permission/start/stop verified.
- [ ] Teacher sees assigned groups and saves an authorized grade/note.
- [ ] Another teacher cannot access unrelated group records.
- [ ] Student sees own records after reload; arbitrary IDs cannot bypass access.
- [ ] Parent sees linked children only; internal notes cannot be read through API.
- [ ] Sign-out/account change/role removal revoke access.
- [ ] Pending repeated submits do not repeat writes.
- [ ] Tests/build pass after each merge.
- [ ] Desktop/mobile navigation and Arabic rendering checked.
- [ ] No secrets in Git; synthetic demo data only.
- [ ] Presentation rehearsed with backup video and stated limitations.
- [ ] Release PR develop -> main reviewed by Mohamed.

Story: admin setup -> QR attendance -> teacher assessment -> student view -> parent view.
A local mock/PGlite test is not a hosted/browser/physical-hardware test.
