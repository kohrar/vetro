# Changelog

## Unreleased

- **Vetro 0.2.4 self-updates:** Install app accepts newer TV integration packages
  signed by the same author. Updates require an explicit recovery acknowledgement,
  persist a checkpoint before submission, and never automatically retry. After a
  restart Vetro checks payload hashes, author identity, running version and native
  inventory. The browser reconnects and offers to reload the updated dashboard.
  Fixture tests cover failures and restart recovery; physical-TV self-update and
  manual recovery remain unverified. There is no automatic rollback.

- **Diagnostics read from seven community reports:** two things had never worked outside the Q80A. The SoC temperature was empty in every report, because Samsung's TVs have no Linux thermal zones; Vetro now reads the driver's own file (`/sys/devices/platform/soc/*thermal/temperature`, whole degrees), which also fills the MQTT temperature sensor. And the CPU rate was empty in four of seven, because its second sample waited behind the slow startup listing in the TV's one-at-a-time command queue; the other reads now start after it.
- **Startup listing no longer times out on slower TVs:** it was one command that needed 13–17 s of `systemctl list-unit-files` work on a Q80A, against a 15 s limit, and the Diagnostics `startup` section came back *unavailable: command timed out* in the QN55Q65, Q65S95C and QN55S95B reports. The running states and the boot states are now two commands (the second with a 60 s limit); if the second fails, the listing still shows what runs, with the boot state unknown. The report gives this section a longer deadline.
- **Compatibility:** community report from a Samsung QN55Q65DAGXZS (2024, firmware T-NKLDUABC-0090-2123.9) on Vetro 0.2.3 (issue #10): built unsigned and loaded with apps2samsung, reported working; the export shows an authenticated UID-0 agent, the service running on Node v18.18.2 and 29 confirmed controls. Cold-boot persistence was not reported.
- **Compatibility:** community report from a Samsung Q65S95C (2023, firmware T-PTMCDEUC-0090-2220.4) on Vetro 0.2.3 (issue #13): service running on Node v18.18.2 with an authenticated UID-0 agent, 23 voice-assistant and ACR components disabled from Quick settings, button remaps in use, and 29 of 29 controls confirmed.
- **Compatibility:** community report from a Samsung QN55S95BAFXZA (2022, Tizen 6.5, firmware T-PTMAKUC-1720.7) on Vetro 0.2.3 (issue #14): root on the first try, the TV rooted itself after the Host PC IP step, and 15 of 17 ad and analytics packages were disabled and verified. Only 267 of its 368 packages are in the Q80A-based catalog.
- **Installation guide** (issues #11 and #12): a short version at the top (the two packages, what you do and what you do not do), the TV's *Host PC IP → 127.0.0.1* step as its own step 5, and a table for "root agent not connected" that starts from what `/status` shows.
- **TV page:** opening Vetro now also tries to start the background service (`tizen.application.launch('vetrotvapp.svc')`) and retries the service check for about 12 seconds, because a public-level certificate may not get the on-boot start honored (issue #2). No extra privilege is declared. Tested by a contributor on a Q60A (Tizen 6, personal certificate), where the service started on every launch. On the Q80A the call is accepted, but the system restarts the stopped service by itself within a second, so starting from a stopped service could not be reproduced there. The page also says when the service did not answer.
- **TV page:** the small Vetro page on the TV closes itself 5 seconds after the report reaches the service (or when it is hidden after that), instead of staying resident. On the Q80A its web app and web process held about 100 MiB of resident memory (RSS, which includes shared pages) in a benchmark sample; the service keeps running. A failed report leaves the page open so the error can be read. The Debloater keeps Ambient Mode (`org.tizen.ambientapp`) off the disable list, with a test, because the firmware's boot script relaunches it in a retry loop.
- **TV picture controls:** blur reduction, judder reduction, LED Clear Motion and HDMI black level can now be changed from Settings. They are firmware-derived: the D-Bus signatures come from the Q80A `avocd` handlers, and for HDMI black level (0–2) and LED Clear Motion (0–2) the decompiled menu provider passes the menu value straight to the call; for blur reduction the call is visible but not its arguments, and judder reduction was not decompiled. None has been written on a TV by the maintainer. Each is editable only after the TV's own `busctl introspect` lists the exact method and signature; otherwise the row stays read-only with the reason, and a failed check never touches the six controls verified earlier. Writes keep the read-back and rollback of the existing controls. The method list is fetched once per service run. The diagnostic export now records, for every control, whether the TV exposes it (`confirmed`, `missing`, `signature-mismatch`) and how many methods it offers, so a report from another model shows which controls it supports.
- **Diagnostic export:** sections that fail now carry a fixed-list `reason` and, for failed commands, the numeric exit code, so a missing section such as `startup` can be diagnosed from the file. Startup listing now tells a command timeout from a command failure.
- **Diagnostic export:** model, firmware and API probe are labelled as widget-reported with their age; settings write paths are reported as `implemented` instead of `verified`; the monitor takes two samples so CPU rates are filled in; the temperature is searched across all thermal zones; kernel threads are counted instead of listed; the dead `runtimeAvailability` field and idle Wi-Fi services are no longer exported; `anynet+(hdmicec)`-style menu ids are kept; `sourceDirty` records whether the package matched its revision.
- `POST /probe` is accepted only from the TV itself.
- **Domain filter candidates** now come from hostnames found in the Q80A firmware (advertising, analytics and KPI, diagnostic logs), shown in groups with their evidence; the earlier public-report names stay in a separate group. The filter refuses the names the TV uses for its internet check and clock, and `/blocklist` no longer lists the `samsungcloudsolution.com` parent domain, which external blockers would apply to those names. See [domain filter candidates](app/docs/DOMAIN-FILTER.md). Other write routes are unchanged.
- **Community report analysis:** structured reports no longer match text error signatures, and the review names the sections that were not collected and why.
- **Compatibility:** community report from a Samsung Q70A (QE55Q70AATXXC, firmware T-NKM2DEUC-2301.1) on Vetro 0.2.3: setup with root access completed, Quick settings, the Debloater and domain blocking used, and the diagnostic export confirmed 29 controls against the TV's own method list. The reporter also turned the red standby LED off and on again through the firmware's `micom_set_standby_led_state` (libmicom), outside Vetro; this is not a Vetro feature yet, and the library has no matching getter, so a switch could not read the state back. Turning off the Enlightenment effects module did not remove the Home and Settings animations.
- **Compatibility:** community report from a Samsung QN85A (GQ65QN85AATXZG, firmware T-NKM2DEUC-2301.1) on Vetro 0.2.3: app, service and UID-0 agent working and recovered after a reboot, once the reporter had enabled the service's on-boot and auto-restart flags. Installation guide: a DNS filter blocking `svdca.samsungqbe.com` makes Certificate Manager fail.
- **Compatibility:** first community diagnostic report from a second model, a Samsung Q67B (QE43Q67BAUXXH, firmware T-NKLBDEUC-1720.7), on Vetro 0.2.3. The app and service were running, the authenticated root agent was connected with UID 0, and 32 components were disabled through the registry. Not confirmed: cold-boot persistence and the system service listing, which was unavailable in that report.
- **Quick settings** is the first panel: switches for HbbTV, ACR viewing data, domain blocking, Alexa, Google Assistant, Bixby and voice services, with in-page confirmation for voice switches (the remote microphone button stops working). Groups apply the disabled flag to every installed member in one step, verify it in the registry, roll back on failure and stop members still running.
- **Install leftovers** cleanup ported from Apps2Samsung (MIT): package files in the install staging folder, deleted one at a time, with bytes freed and storage before and after. Refused while an installation is running.
- **App catalog** from the firmware manifests: area, role and purpose for each package; references from other packages, event and key-sequence launches and microphone/camera/location access in the component drawer. `app/scripts/build-app-catalog.py` regenerates `service/app-facts.js` from a private dump.
- **Debloater** layout: role filters with counts, one State column, Startup listing only flags that are on, CPU/RAM only while sampled, duplicate names disambiguated, startup flags as switches.
- The Remote panel polls only while listening; stopping capture returns to the saved interception choice.
- Navigation grouped by task; HbbTV, domain blocking and MQTT use switches; privacy values use words instead of Yes/No.
- Dashboard live sampling starts off. **Start live** samples the TV for 2 minutes and stops by itself; opening a component drawer takes one sample when process data is stale.
- CPU, network and paging rates restart after a gap of more than 60 seconds instead of reporting an average over the idle period.

## 0.2.3 — unreleased

- English-only service messages: MQTT validation and event log, MQTT rule results, local domain filter errors.
- Removed an unused MQTT storage publication that telemetry never supplied.
- Read-only startup delay recorder (`app/scripts/boot-test.py`) with fixture tests and [instructions](app/docs/BOOT-TEST.md). The TV address comes from `--base` or `TV_IP`; no device address is built in.
- English benchmark script messages and report text.
- README corrections: saved remote interception resumes automatically after rule edits, helper reconnection and service restarts; current test-suite count; final RAM difference matches the performance summary.

Not yet installed or verified on the test TV.

## Source preview — 2026-10-11

- Minimal dark dashboard with English product copy and explicit app/process/startup states.
- Grouped component inventory with package/family boundaries and unknown-state handling.
- Redacted JSON diagnostic downloader and current platform/root status fields.
- Issue form, deterministic community report analysis and bot-comment workflow.
- Separate app-only and privileged integration packaging, with integration-boundary tests.
- Explicit signing credentials, original-code MIT license and upstream notices.
- Public installation/compatibility documentation with measured performance limitations.
- Private raw reports, device certificates and signed test packages excluded from the current tracked snapshot.

Vetro 0.2.0 is installed on the test TV. Dashboard contents, all 14 diagnostic sections and continued background operation after closing the app are verified. Unattended cold boot of this version remains to be tested. Private historical Git data is archived outside the fresh publication repository.
