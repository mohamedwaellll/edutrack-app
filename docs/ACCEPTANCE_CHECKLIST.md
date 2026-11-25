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
- [ ] Tested the commit or ZIP shared with the team and recorded its version.

## Printed QR on iPhone Safari

Use an HTTPS test deployment that the iPhone can reach, with synthetic data, a test admin, and an active student assigned to a group. Use a freshly printed card from that deployment. Start with no attendance record for the student that day.

1. Open Safari and sign in as the test admin. Select **Attendance** from the mobile section menu, then open **QR Attendance Scanner** and select the student's group.
2. Tap **Start Camera**, allow camera access, and hold the printed QR in view. Record whether check-in succeeds and note the arrival time.
3. Wait at least three seconds and scan again. Expect **Already Recorded**, one attendance row, and the same arrival time in **Manual Roster**.
4. Tap **Stop Camera** before leaving the scanner. Record the iPhone model, iOS version, test URL, and PASS, FAIL, or BLOCKED.

Story: admin setup -> QR attendance -> teacher assessment -> student view -> parent view.
A local mock/PGlite test is not a hosted/browser/physical-hardware test.
