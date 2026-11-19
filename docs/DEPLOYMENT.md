# BookMyBus CRS — manual Hostinger deployment runbook

**Status: repository implementation; not deployed.** Read the
[source audit](DEPLOYMENT-AUDIT.md) and local verification report before release.
Commands below are an operator runbook, not commands already executed on the VPS.
No step grants permission to change the shared Nginx configuration automatically.

### Authorized first-release preparation update

The owner subsequently authorized production deployment and separately approved
the exact BookMyBus routing/SSL change. The current production Compose includes
a dedicated password-protected TLS Redis service on `bookmybus-crs_data` (internal,
no host ports), with its own AOF volume. Private TLS/config files live in
`shared/redis-tls`; the CA private key is kept separately in `shared/redis-ca-private`.
The API trusts only that CA in addition to system roots via `NODE_EXTRA_CA_CERTS`.
Renew the private Redis server certificate before its one-year expiry. Redis
pre-provisioning is allowed before the first API release; existing API/web still
require a trusted release pointer.

`scripts/prepare-vps-runtime.py` prepares only this application's private runtime
files, preserves existing signing keys, backs up api.env and deduplicates origins.
`scripts/install-bookmybus-edge.sh APPROVE_BOOKMYBUS_EDGE` is a separately approved
one-time additive proxy/certificate installer. It compares hashes of pre-existing
configs before/after. It is not called by the CI/CD workflow.

Private GHCR pulls now use the deployment job's short-lived, repository-scoped
`packages:read` token over encrypted SSH stdin. Its private temporary Docker login
configuration is removed after the remote deployment; no permanent PAT is needed.
The manual registry-login section below is an alternative for out-of-band recovery.
The `production` environment requires owner review and main-only deployment;
owner self-review is allowed, so this is an explicit manual gate, not two-person
approval. Admin bypass is disabled.

## Architecture and domains

```text
push/PR to main
  -> CI: lint + strict types + synthetic config checks + all tests + builds
         isolated browser tests + Docker build/image/release-script tests
  -> merge/protected main commit with every required job successful
  -> Run workflow: Deploy production, branch main, confirmation DEPLOY
  -> verify exact main push CI run, branch, repository and required jobs
  -> build images, smoke-test those images, publish to GHCR
  -> production environment approval
  -> recheck CI -> verified SSH -> scoped Compose rollout by immutable digest
  -> Mongo/Redis readiness + three panel revision checks
  -> success, or approved safe rollback to the previous known healthy release
```

| Public hostname | Target |
| --- | --- |
| `bookmybus.pro` | Existing React Operator dashboard |
| `admin.bookmybus.pro` | Existing React Admin dashboard |
| `partner.bookmybus.pro` | Existing React Partner platform |
| `api.bookmybus.pro` | Existing Express backend, including `/api/v1/...` |

The existing edge Nginx retains ports 80/443. Our `web` service listens internally
on 8080 and binds **only `127.0.0.1:5020`**. Our API listens on 4000 with no host
port. Same-origin panel `/api` and Socket.IO requests are forwarded to the API.
All runtime secrets stay on the VPS, never in Vite assets or Docker build args.

The shared Nginx container cannot reach host `127.0.0.1:5020` through its own
loopback interface. The proposed solution is to connect it to our dedicated
`bookmybus-crs_edge` network after explicit review and approval, then route to
`bookmybus-crs-gateway:8080`. No existing app network is reused.

## 1. Read-only VPS verification first

Run the contents of `scripts/vps-diagnostics.sh` from a trusted admin SSH session.
Review its output privately; `nginx -T` contains other applications' routing.
It prints no Docker environment variables. Check:

- `/etc/os-release`, x86_64, actual free disk/RAM and Compose **>= 2.30**.
- `ss -ltn` for 80,443,5020. Recheck 5020 just before first rollout.
- No existing `/opt/bookmybus-crs`, Compose project `bookmybus-crs`, network
  `bookmybus-crs_edge` or volume `bookmybus-crs_uploads` owned by another application.
- Shared proxy mounted config/certificates, all current server names and networks.
- A records for the four domains point to `200.234.45.233`; inspect AAAA records
  too and resolve stale IPv6 records before issuing certificates.
- At least 3 GiB available RAM and 5 GiB free disk immediately before deploy.
  Actual capacity must include old images/releases, backups and current sites.

No claim of a free production port or valid TLS route is made before this review.

## 2. Provision only this application's directories and credentials

After approving the diagnostics, an administrator can run the following on the
VPS. **Stop if the user or directory already exists; inspect instead of taking it over.**

```bash
getent passwd bookmybus-deploy && { echo 'User already exists: inspect first'; exit 1; }
test ! -e /opt/bookmybus-crs || { echo 'Directory already exists: inspect first'; exit 1; }
sudo useradd --create-home --shell /bin/bash bookmybus-deploy
sudo install -d -m 0750 -o bookmybus-deploy -g bookmybus-deploy /opt/bookmybus-crs
sudo install -d -m 0700 -o bookmybus-deploy -g bookmybus-deploy \
  /opt/bookmybus-crs/shared /opt/bookmybus-crs/releases \
  /opt/bookmybus-crs/incoming /opt/bookmybus-crs/logs
printf 'bookmybus-crs\n' | sudo tee /opt/bookmybus-crs/.project-owner >/dev/null
sudo chmod 0644 /opt/bookmybus-crs/.project-owner
printf 'ghcr.io/surajkurrey08/aibus_crs\n' | sudo tee /opt/bookmybus-crs/shared/registry-prefix >/dev/null
sudo chown bookmybus-deploy:bookmybus-deploy /opt/bookmybus-crs/shared/registry-prefix
sudo chmod 0600 /opt/bookmybus-crs/shared/registry-prefix
sudo install -d -m 0700 -o bookmybus-deploy -g bookmybus-deploy /home/bookmybus-deploy/.ssh
```

Install a dedicated public deploy key in that user's `authorized_keys`, mode0600,
owner `bookmybus-deploy`; use key options
`restrict` (disables forwarding/PTY, allows the required exec/SCP operations).
Generate the private key off-server using `ssh-keygen -t ed25519 -f bookmybus-deploy`;
store it as the environment secret, not in this repository. Restrict access to
the workflow/environment and rotate the key regularly. Do not replace any
other user's SSH configuration or authorized keys.

Docker access must be approved explicitly by the administrator:

```bash
sudo usermod -aG docker bookmybus-deploy
```

**Docker-group membership is root-equivalent, despite a dedicated Unix user.**
This baseline scopes our commands but is not a host-level authorization sandbox.
For a stronger boundary use an independently reviewed rootless Docker setup or
a root-owned forced-command deployment service. Do not grant broad passwordless
sudo or change SSH/firewall/daemon settings as part of this runbook.

Copy `.env.production.example` securely to
`/opt/bookmybus-crs/shared/api.env`, owned by `bookmybus-deploy`, mode0600; replace
every example value with the actual credentials using a private editor/secret
manager. Values are **bare**, unquoted, single-line values; Compose `format: raw`
preserves dollar signs. Never source this file as shell code. URL-encode password
components in database/Redis URLs. Generate fresh independent signing keys, e.g.
`openssl rand -hex 48` and webhook key `openssl rand -hex 32`, in a private session.
Do not paste their output into a ticket or commit it.

Use a dedicated Redis TLS endpoint/credentials; MongoDB must support transactions
and required indexes. Do not reuse any unrelated service's database or cache.
Keep sandbox/test financial switches false. Set payment and SMTP settings only
when the corresponding feature is configured. Dashboard secure cookies depend
on verified external HTTPS and the two trusted proxy hops.

### GHCR pull authentication (no VPS Git fetch)

Publishing uses the ephemeral workflow `GITHUB_TOKEN`. If the two GHCR packages
are private, provision a separate read-only package token for the deploy user:

```bash
sudo -iu bookmybus-deploy
read -r -p 'GHCR read-only username: ' GHCR_USER
read -r -s -p 'GHCR read:packages token: ' GHCR_READ_TOKEN; printf '\n'
printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
unset GHCR_READ_TOKEN GHCR_USER
chmod 0700 ~/.docker
chmod 0600 ~/.docker/config.json
exit
```

Use an OS credential helper where available: Docker's plain config stores
credentials encoded, not encrypted. Package access must include both images;
authorize SSO where required. Public packages need no pull token. No interactive
Git HTTPS authentication or access to the OnlineGo repository is needed.

## 3. GitHub configuration

Protect `main`: pull-request review, no force pushes, enforce the three status
checks **`quality`, `browser`, `docker`**, restrict workflow changes via review.
Repository administrators can bypass weak protections; configure them deliberately.

Create an environment named **`production`** before the first dispatch. Restrict
deployment branches to main; require reviewers, prevent self-review and disable
admin bypass where supported. Confirm protection is actually active. GitHub's
plan/repository visibility controls reviewer availability; if unavailable, manual
dispatch plus `DEPLOY` and server revision approval remain, but do **not** provide
independent two-person approval. Document acceptance of that limitation or change
the plan/approval system before production. Never auto-approve the environment.

**Environment secrets (exact names):**

| Name | Value |
| --- | --- |
| `SSH_HOST` | `200.234.45.233` after identity verification |
| `SSH_PORT` | `22` |
| `SSH_USER` | `bookmybus-deploy` |
| `SSH_PRIVATE_KEY` | Dedicated full OpenSSH private key; no repository file |
| `SSH_KNOWN_HOSTS` | Independently verified known_hosts entry for host/port |

The workflow also accepts `VPS_KNOWN_HOSTS` as an alias, matching the existing
repository secret setup. If both are present, `SSH_KNOWN_HOSTS` takes precedence.
This is still a verified known_hosts entry, never a private key or just an IP.

No repository variables are required. All deployment names/domains are explicit,
reviewed source configuration. `GITHUB_TOKEN` is supplied by GitHub, not manually
created; package write permission exists only in the publish job. No application
production secret is required in CI. `GHCR_USER`/`GHCR_READ_TOKEN` above are
VPS provisioning inputs, not additional workflow secrets.

Verify the server's ED25519 host fingerprint through Hostinger console:
`sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`.
On a trusted workstation collect with `ssh-keyscan -p 22 200.234.45.233`, then
compare fingerprints **before** storing `SSH_KNOWN_HOSTS`. `ssh-keyscan` alone is
not identity verification. For nonstandard ports use `[host]:port` entries.
The workflow never disables host-key checking. Future host-key changes must be
verified out of band, not automatically accepted.

## 4. Backups, schema review and per-release authorization

Production uses `autoIndex:false`. The application has manual index/migration
scripts; **this pipeline does not run them**. Before authorizing a release:

1. Review all application changes, index definitions and compatibility with the
   existing database. Run the documented read-only preflight checks using a
   separately secured admin session/tooling, not a production image with dev tools.
2. Confirm Atlas snapshots/PITR and retention, take an approved backup if required,
   and verify restore to an isolated database. Include the dedicated upload volume
   in the backup plan. Protect backups as passenger/financial data.
3. Obtain separate approval for any migration/index build; use expand/contract
   changes, bounded operations and a restore drill. No destructive reset/drop.
4. Decide whether the *previous* code can safely run against data written by this
   candidate. An image rollback cannot undo bookings, payments, schema or uploads.
5. As the deploy user, record the reviewed full main commit:

```bash
read -r -p 'Approved 40-character main commit SHA: ' REVISION
[[ $REVISION =~ ^[a-f0-9]{40}$ ]] || exit 1
printf '%s\n' "$REVISION" > /opt/bookmybus-crs/shared/approved-revision
# Only if rollback compatibility has ALSO been reviewed:
printf '%s\n' "$REVISION" > /opt/bookmybus-crs/shared/rollback-safe-revision
unset REVISION
```

Without `approved-revision` matching exactly, rollout stops. Without matching
`rollback-safe-revision`, automatic/manual rollback is refused. The files contain
commit IDs, not secrets. Do not approve rollback for an incompatible migration.

## 5. Reverse proxy and SSL — separate approval required

`deploy/nginx/edge-proposal.conf` is a **proposal only** and is not transferred by
the workflow. First inspect the current proxy using the read-only diagnostics.
Confirm none of these hostnames already serves a different application. Identify
the actual include directory and certificate-manager renewal mechanism.

After explicit approval, an administrator can connect only the edge proxy to the
new stack's network (created on the first deployment):

```bash
docker network connect bookmybus-crs_edge gymproplus-nginx-1
```

Persist this connection in the proxy owner's Compose definition through its own
approved change; a manual connection is lost when that container is recreated.
Do not attach the API directly to other apps' networks. Obtain a certificate
covering **all four hostnames** through the existing manager, preferably DNS-01
when it avoids changes to shared ACME challenge paths. Verify the actual mounted
certificate paths; those in the proposal are not assumed to exist.

Add a uniquely named new include file alongside existing domains. Back up the
affected proxy configuration first; preserve all other routes. Validate using
`docker exec gymproplus-nginx-1 nginx -t`. Only after another explicit proxy-change
approval use the existing owner's controlled reload procedure; do not restart
that container or bind a new listener to host 80/443. Recheck every pre-existing
website after any approved reload. Certificate renewal must revalidate/reload
using the established process. The deployment workflow never edits/reloads this
proxy and never manages certificates.

The edge overwrites client forwarded headers, the private gateway adds the
second hop, and Express uses `TRUST_PROXY=2`. If a CDN/load-balancer adds a hop,
review trusted proxies and client-IP normalization before using it. Do not expose
the private gateway publicly or let arbitrary containers join its network.

## 6. Manual deploy

1. Commit/review the prepared changes and push to GitHub. No push is performed by
   this implementation. Let automatic CI finish for the exact main commit.
2. Complete VPS, GHCR, environment, backup and revision authorization setup above.
3. GitHub **Actions → Deploy production (manual) → Run workflow → main**.
4. Enter **`DEPLOY`** exactly. No push or CI-completion event can deploy.
5. Review the image digests/commit in the run summary; approve the production
   environment deployment if enabled. Image publishing happens before approval;
   VPS access happens only afterward. CI is rechecked after that wait.
6. The workflow securely transfers only the production Compose and three release
   scripts, creates a fresh release directory, records both exact image digests,
   then runs the scoped deploy script. No source checkout or build on the VPS.
7. Read the final job summary and private server log. Never paste raw runtime logs
   or environment configuration publicly. Keep deployment logs/releases until
   retention is approved; there is no automatic prune/volume cleanup.

Release layout:

```text
/opt/bookmybus-crs/
  .project-owner
  deployment.lock
  shared/api.env                    # private runtime secrets, 0600
  shared/registry-prefix            # allowed GHCR repository prefix
  shared/approved-revision          # reviewed backup/schema authorization
  shared/rollback-safe-revision     # separate backward-compatibility decision
  incoming/<sha>-<run>-<attempt>.tar.gz
  releases/<sha>-<run>-<attempt>/
    images.env                     # immutable API/web digest + revision
    docker-compose.prod.yml
    scripts/{deploy,rollback,release-common}.sh
  current -> releases/<last successful release>
  previous -> releases/<previous successful release>
  logs/deploy-<release>.log
```

Every Compose operation explicitly uses `-p bookmybus-crs`, that release's file,
project directory and image environment. Only our services are recreated. This
single-stack update can briefly interrupt **this application**; it is not a
zero-downtime/blue-green claim and must never recreate another project.

## 7. Health, rollback and incident handling

Before mutation the script verifies namespace ownership, platform/version,
resource thresholds, private env permissions, manifest digests/labels, Docker
configuration and registry pulls. On first deploy it checks port5020. On later
deploys it requires the previous release to be healthy before replacing it.

Readiness is checked at `http://127.0.0.1:5020/health/ready` with
`Host: api.bookmybus.pro`; each panel's `/deployment-revision` must match the
candidate SHA and its root must respond successfully. Compose also waits on
container health. After approved DNS/TLS routing, independently test all four
public HTTPS hosts, login/session refresh, a test-safe booking path and webhook
delivery. Local readiness does not prove external TLS/payment functionality.

On rollout failure the job remains **failed**, even when recovery succeeds. If
the old release was healthy and the candidate has a matching rollback approval,
it restores the old Compose/images and rechecks readiness; it reports recovery
success/failure. No financial or database data is undone.

For an explicitly requested rollback of a successful deployment:

```bash
sudo -iu bookmybus-deploy
bash /opt/bookmybus-crs/current/scripts/rollback.sh ROLLBACK
```

This shares the deployment `flock`, requires current revision rollback approval,
pulls the previous recorded digests, verifies health and swaps pointers only after
success. Runtime `api.env` is shared and **not versioned**: separately review env
compatibility. Preserve old GHCR digests; deleting them can make rollback fail.

If the first deployment fails, no prior release exists. The script leaves only
this app's failed containers/logs for investigation and refuses to take over an
untrusted existing project on retry. Inspect the exact failed release and use
its explicitly scoped Compose file to stop/remove **only its api/web containers**
after incident approval; retain uploads, network, database and logs. Never run
global cleanup or `down -v`. If a rollback fails, investigate dependency health,
credentials, disk and logs; do not loop financial operations or reset data.

Use an external HTTPS uptime monitor and the existing operations health/report
features. Alert on readiness failure, dependency disconnects, reconciliation lag,
failed payments/refunds, disk growth and container restart counts. Logs rotate at
10MB ×3 per container; application release logs need a separately approved
retention plan. No monitoring service has been installed on the VPS by this task.

## Release checklist

- [ ] Resolve/assess the audit's dependency advisories before production approval.
- [ ] All three required CI jobs pass for this exact main commit; branch protected.
- [ ] VPS diagnostics, architecture, namespace, port, disk and RAM verified.
- [ ] Dedicated deploy user/key, verified host key and private GHCR pull tested.
- [ ] Production environment reviewers/limitations verified; secrets configured.
- [ ] MongoDB transaction/index readiness, dedicated TLS Redis and backups verified.
- [ ] Private api.env complete; test/sandbox flags false; no secrets in Git/images.
- [ ] Backup/schema approval and rollback decision match this exact commit.
- [ ] Edge config/certificate/network plan separately approved and verified.
- [ ] Manual dispatch DEPLOY; review commit/digests; approve environment.
- [ ] Local health and external HTTPS/business smoke checks pass; existing sites healthy.

Official references: [GitHub environment protections](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments),
[deployment reviews](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments),
[Compose readiness](https://docs.docker.com/compose/how-tos/startup-order/),
[Compose up --wait](https://docs.docker.com/reference/cli/docker/compose/up/).
