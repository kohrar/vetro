# Install Vetro on your TV

[Back to Vetro](../../README.md) · [Compatibility and root](../../README.md#root-on-the-tv)

## The short version

Vetro has two packages. They are built from the same sources and differ in one thing:

| Package | Built with | What you get |
| --- | --- | --- |
| **App only** | `node build.cjs` in `app/` | The dashboard, unsigned. It shows the TV's apps but cannot change anything: no root. Good for a first look. |
| **With the root integration** | `node build.cjs` in `rooting/` (step 3) | Everything. This is the package this guide installs, and it has to be signed with your own certificate. |

What you do, once, from a computer on the same network as the TV:

1. Turn on Developer Mode on the TV and point it at your computer (step 2).
2. Build the integration package and sign it with your own Samsung certificate (step 3).
3. Install it on the TV and open **Vetro** once (step 4).
4. Change the TV's **Host PC IP** to `127.0.0.1` and restart the TV (step 5).

What you do **not** do: run any C# file, DLL or "archive chain" yourself. Those are the root integration's own parts. After step 5 the Vetro service starts with the TV, uses the TV's own SDB service to start a small root helper (the *root agent*), and the helper connects back to the service. The dashboard says *Root agent: connected* when that worked. You will not see it happen; you only see the result.

Expect the whole thing to need a computer with Tizen Studio and a certificate, and some patience. There is no signed installer that you can just download, because a Samsung certificate is tied to its owner.


### 1. Check requirements

Use only a TV you own or are authorized to administer. Read the compatibility table first. Install Tizen Studio's TV extension and Samsung Certificate Extension from the official tools. Create your own author/distributor certificate profile bound to your TV. The integration's on-boot service has been investigated with Partner-level distribution privileges; ordinary public signing is not evidence that boot execution is supported.

Do not reuse someone else's signed package or certificates. Historical signing material is excluded from the release. Review [Samsung's TV-device setup guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html) for your model's installation workflow.

If Certificate Manager fails with `ArrayIndexOutOfBoundsException`, check whether a DNS filter or ad blocker on the computer blocks `svdca.samsungqbe.com`. A community report found that the plugin then saved the block page as `author.crt`; allowing the domain made the official certificate flow work.

### 2. Enable Developer Mode

On the tested TV, open **Apps**, enter **12345** using the remote, enable Developer Mode, enter the installation computer's LAN IP in **Host PC IP**, and restart the TV. Menu names can vary by model. Connect the TV and computer to the same trusted LAN.

There are two different addresses to keep separate:

| Address | Meaning | Where to use it |
| --- | --- | --- |
| `TV_IP`, for example `192.168.1.100` | TV's LAN address | SDB connection and browser dashboard |
| `127.0.0.1` | Loopback of the machine using it | TV's autonomous integration talks to its own SDB service; a PC using this address talks to itself |

During installation, **Host PC IP** is the computer's LAN address. Once Vetro is installed you change it to `127.0.0.1` (step 5): that is what lets the TV start its own root helper. Do not change the TV's custom DNS to accomplish this.

```sh
export TV_IP=192.168.1.100  # replace with your TV address
sdb connect "$TV_IP:26101"
sdb devices
```

### 3. Build and sign the package with the root integration

Install signing dependencies with `npm ci` in `rooting/on-boot-probe`. Despite its historical name, only its dependency manifests are required by the current builder. Set `AUTHOR_P12`, `DIST_P12`, `AUTHOR_PW` and `DIST_PW` to your own certificate paths and passwords outside the repository. Use your shell or secret manager to supply passwords without committing them.

```sh
cd rooting/on-boot-probe
npm ci
cd ..
# Supply certificate variables securely before running this command.
OUT=/tmp/vetro.wgt node build.cjs
```

The resulting integration WGT contains privileged components. There is no universal certificate or guaranteed root compatibility. The bundled integration derives from [Samsung TV root research](https://github.com/chris-ritsen/samsung-tv-root); consult its compatibility information and [integration notes](../../rooting/README.md). Do not treat successful signing as successful privilege acquisition.

### 4. Install and verify

Select the connected TV target in Tizen Studio Device Manager, permit app installation for your certificate profile, and install `/tmp/vetro.wgt`. Alternatively, use the configured Tizen CLI target:

```sh
tizen install -n /tmp/vetro.wgt -t YOUR_TV_TARGET
```

Open **Vetro** once to run the public API probe. Visit `http://TV_IP:8099/` from a browser on the same LAN. Check app inventory, probe status and platform connectivity. A visible icon or accepted installation is not proof that the background service or root agent works.

### 5. Let the TV reach its own SDB service

The root helper is started through the TV's own SDB service, so the TV has to talk to itself. On the TV, open the Developer Mode screen again (**Apps**, then **12345**), set **Host PC IP** to `127.0.0.1`, and restart the TV. Then wait up to 90 seconds and open the dashboard.

The integration has been tested with this setting on a Q80A, and community reports from other models describe the same step as the one that made the TV root itself. While it is set, a computer can no longer use SDB on this TV. To work from the computer again (for example to install a new build), put the computer's IP back, restart the TV, and repeat this step afterwards.

### 6. Check that it starts by itself

After a cold boot, Vetro’s background startup and root reacquisition can take **up to 90 seconds**. Wait before treating an unavailable dashboard or agent as a failure.

To test unattended startup, record a boot checkpoint privately, fully power off the TV, unplug it for 30 seconds, turn it on, and check `/status` and `/monitor?scope=summary` without opening Vetro or issuing a launch command. Confirm a new boot, running service and authenticated UID-0 agent. Keep boot identifiers private. Standby is not a cold boot. See [release audit](RELEASE-AUDIT.md) for current results.

### If the dashboard says the root agent is not connected

Open `http://TV_IP:8099/status` in a browser and read these fields:

| What you see | What it means | What to do |
| --- | --- | --- |
| `"mode": "app-only"` | The package on the TV is the app-only one, with no root integration. | Build with `rooting/build.cjs` (step 3) and install that package. |
| `"mode": "tv-integration"` and `"agent": {"connected": false}` | The integration is there but the helper has not connected. | Check that Developer Mode is on and **Host PC IP** is `127.0.0.1` (step 5), that you restarted the TV afterwards, and that you waited 90 seconds. |
| The page does not load at all | The background service is not running. | Open **Vetro** on the TV once, wait 10 seconds and reload. If that does not help, see the [service notes](../../README.md#root-on-the-tv). |
| `"attempts"` lists launches that end without `agent-connected` | Root did not work on this firmware, or SDB refused the connection. | Download the report from **Diagnostics** and attach it to a new issue; it contains no addresses or serial numbers. |

Several sections of the diagnostic report say *unavailable: no root agent connected* until the helper is up. That is expected during those first 90 seconds, and it is the usual picture for a TV where step 5 was skipped.

## Install another signed app from the dashboard

Open **Install app**, choose a `.wgt` signed for this TV (up to 32 MiB), and select
**Upload and review**. Check its app name, package ID and version, then select
**Install on TV**. Uploading alone never submits an installation.

Vetro requires a connected root agent to read the native package inventory. It
checks the installer response and freshly reads that inventory to confirm the
uploaded version. **Installation verified** confirms the installed version, not
that the app opens or behaves correctly. A failed or disconnected request never
automatically retries an installation. Reopen **Install app** or use **Check status**
to recover the result after reloading the browser. Results survive browser reloads,
but ordinary app results do not survive a Vetro service restart. Self-update results are persisted separately.

Vetro checks for author/distributor signature files; the TV validates the actual
signatures and certificate permissions. This screen does not sign packages or
accept certificates. Uploaded files expire after 15 minutes and are deleted after
an ordinary installation attempt. Self-update uploads are retained while the update is pending.


## Update Vetro without changing Host PC IP

Starting with version 0.2.4, **Install app** also accepts a newer signed Vetro TV
integration package. Install this initial self-update-capable version from the
computer once. Keep the original author certificate and its password backed up;
future update packages must use the exact same author certificate. Update the
versions in `config.xml`, `package.json` and `service/build-info.js` together when
building a newer package. Equal-version reinstalls and downgrades are rejected by
the self-update screen; use desktop recovery for those cases.

1. First confirm that Vetro's service and root agent return without manually
   opening the app after a TV restart. A certificate alone does not guarantee this.
2. Open **Install app**, upload the newer integration WGT, and review the versions.
3. Read the recovery instructions and check the acknowledgement. Select
   **Update Vetro and restart** once. Keep the TV powered on.
4. Leave the browser open. The connection may disappear while the service is
   replaced. The browser polls for its return for up to four minutes, without
   repeating the installation command.
5. The new service reads a durable checkpoint and checks its running version,
   author certificate, SHA-256 hashes of the uploaded payload files, and a fresh
   native package inventory. **Installation verified** means these checks passed;
   it is not validation of every feature of the new release. Select
   **Reload updated dashboard** to load the new interface.

The checkpoint is flushed to storage before submitting an update. A crash between
saving it and submitting the command therefore leaves an uncertain result, never
an automatically repeated installation. If startup/root access is not confirmed
within three minutes, the result becomes **Installation not verified**. **Check
status** may subsequently recheck the installed build when root access returns;
it never retries installation. Self-update results survive browser and service
restarts. Signing is still done outside Vetro; the TV validates package signatures.

There is no automatic rollback. If the new service cannot start, restore Developer
Mode's **Host PC IP** to the computer's LAN address, restart the TV, and reinstall a
known-good signed integration WGT with Tizen Studio. Once it works, restore Host PC
IP to `127.0.0.1`. If only root access is missing, opening Vetro once on the TV can
start its service; then check Developer Mode and wait for the root agent.

Self-update lifecycle and failure recovery have automated fixture coverage. A
controlled 0.2.4 → 0.2.5 self-update succeeded on a QN70Q60AAVXZC: the service
restarted, its installed payload hashes, author certificate and native package
version matched the saved checkpoint, and authenticated UID-0 access returned.
This is one successful update, not a power-loss or rollback test. Manual recovery
and repeated update cycles remain unverified.


## Protect the dashboard with a password

In **Quick settings → Dashboard password**, enter a password of 8–256 characters
in the single password field and select **Save password**. The password is masked
while typing and cleared after submission. No password is set automatically.
Once saved, a new browser must sign in before receiving the dashboard or accessing
its management APIs. Your current browser remains signed in. Use **Sign out** to
end that browser's session. Saving a new password signs out every other browser;
no second password field is needed while you are already signed in.

Password hashes and session digests persist in
`/home/owner/share/vetro/auth.json`, outside the application package. Updates and
service restarts preserve them. Sessions expire after 12 hours or when revoked;
the cookie lasts for the browser session. A browser that restores session cookies
may restore the session too. The service rate limits repeated wrong passwords.

Only TV-local widget status/probe traffic is exempt, so opening Vetro on the TV
still works. LAN clients cannot bypass login by supplying forwarded-IP headers.
HTTP does not encrypt the password or session traffic: keep the TV on a trusted,
isolated LAN and never expose the dashboard publicly.

If the password is forgotten, use trusted local access to remove the auth file and
restart the service, then immediately set a new password. There is no remote reset
endpoint. Local development uses `~/.config/vetro/auth.json` instead; the
`VETRO_AUTH_FILE` environment variable can select a separate test file. Corrupt or
unreadable settings fail closed and require local repair.
