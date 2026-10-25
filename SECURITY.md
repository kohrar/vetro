# Security and responsible reports

Vetro is experimental privileged software. The browser management interface uses
plain HTTP. Version 0.2.5 adds an optional password under Quick settings. Set it
before allowing other devices to reach the dashboard; no password is configured
by default. Deploy only on a trusted isolated LAN. Do not
forward its ports, expose it publicly or enable unrestricted access from other
networks. The dashboard and management APIs require a valid session after password setup.
Only the TV-local widget's status read and probe submission remain exempt.
Root-agent authentication is a separate internal protocol.

Passwords are stored as salted scrypt hashes. Session tokens are random, stored
only as hashes, and sent in HttpOnly, SameSite=Strict browser-session cookies.
Server-side sessions expire after 12 hours and survive service updates/restarts.
Changing the password revokes previous sessions; signing out revokes the current
one. Repeated failed sign-ins are rate limited. Unreadable or malformed password
settings lock access instead of disabling authentication.

HTTP does not encrypt passwords, cookies or traffic. Password protection does not
make public exposure safe or protect against someone monitoring the LAN. Keep the
trusted-network restrictions above. For forgotten-password recovery, use trusted
local access to remove `/home/owner/share/vetro/auth.json` and restart Vetro; this
also revokes all sessions. There is no unauthenticated network reset endpoint.

Use GitHub private vulnerability reporting if the repository maintainer enables
it. If no private channel is configured, ask for one in an issue without including
credentials, exploits, device identifiers, raw logs or sensitive reproduction data.
No public security contact or private-report endpoint has been configured locally.

Only use the tool on devices you own or are authorized to administer. Do not share
signing keys or developer-account credentials. Diagnostic JSON excludes many
private fields but can still reveal installed software; review it before posting.
