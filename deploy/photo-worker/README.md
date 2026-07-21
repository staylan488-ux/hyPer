# Private photo worker

The CPX21 runs the CLI clients and queue. Frontier inference remains remote.

1. Create an unprivileged `hyper-photo` Linux user and clone a reviewed release to `/opt/hyper`.
2. Install the supported Linux Codex and Claude CLIs. Log in interactively as `hyper-photo`; never copy their auth files into the repository or environment file.
3. Copy `photo-worker.env.example` to `/etc/hyper/photo-worker.env`, mode `0600`, and set the two Supabase user UUIDs, private origin, staging URL, and public anon key.
4. Copy `hyper-photo-worker.service` to `/etc/systemd/system/`, create `/opt/hyper/.tmp`, and make it writable only by `hyper-photo`.
5. Start the service, then expose `127.0.0.1:8788` only through a private authenticated ingress such as Tailscale Serve. Do not open port 8788 to the public internet.
6. Verify `/health`, a valid-user request, a denied-user request, queue saturation, service restart, auth expiry, and temporary-image cleanup before enabling it in Hyper-Dev.

One worker process has one Codex identity and one Claude identity. If both testers must use their own consumer subscriptions, run isolated service users/instances and route each authenticated Supabase user to their own instance. Do not pool one consumer login across users. For durable production availability, retain a budget-capped official API adapter as a fallback.

