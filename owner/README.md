# Vehicle Owner Panel

This React workspace has its own sign-in, refresh cookie and production bundle. It shares the CRS backend through the same-origin `/api` proxy.

## Local use

Start the CRS backend and run `npm run dev:owner` from the repository root. The panel opens at `http://127.0.0.1:5177`. The proxy targets `http://127.0.0.1:4000` by default. Set `VITE_API_TARGET` if the backend uses another address. Set backend `OWNER_WEB_ORIGIN` if the browser origin differs from the default.

In Vehicle Operator, an operator admin opens **Owners → Create owner** to set up a login. The Owners page shows the login email and owner sign-in link. Share the initial password privately. Use **Vehicles → Assign owner** to link vehicles to the account.

Scheduled trips record the vehicle's owner at creation. Reassigning a vehicle updates current fleet access and preserves ownership of recorded trips. Trips scheduled before this feature have no ownership snapshot and are excluded.

## Hosting

Build with `npm run build -w owner`. The production web image already contains the resulting `owner/dist` bundle and routes `owner.bookmybus.pro` to it. For a live rollout, configure DNS, a TLS certificate covering that hostname, and the VPS edge proxy to pass the original hostname through to the web gateway. Configure `OWNER_WEB_ORIGIN=https://owner.bookmybus.pro` in the backend's private environment. For another domain, update both the gateway host mapping and backend origin.

Apply the normal reviewed index procedure before rollout. This release adds an owner-account unique index and vehicle and trip owner lookup indexes. It does not require a data backfill to serve newly scheduled trips.
