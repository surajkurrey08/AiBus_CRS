# Aibus React frontend

React 19, TypeScript, Vite, Tailwind CSS, Lucide and Recharts. The existing eleven operator screens and the new Booking Counter preserve the original design system and consume the Node API in ../backend.

Run from the repository root with `npm run dev:frontend`, or from this folder with `npm run dev`. The Vite proxy forwards /api and Socket.IO to http://127.0.0.1:4000. Use http://127.0.0.1:5173 to match the backend origin. Docker uses nginx at http://localhost:8080.

The default app requires login. Access tokens live in memory, refresh tokens in HttpOnly cookies. API errors stay visible with retry; network failures never cause a mock-data fallback. Permission-based controls supplement server RBAC. Tables use server pagination, search and status filters. Socket.IO events invalidate server records.

Register your company and have the platform administrator approve it. Add buses, open bus details to configure layouts, add routes and schedule trips. Seat inventory displays configured positions, fares and states. Hold seats and enter passengers to create a pending booking. Razorpay Test Mode can confirm internal bookings and issue test tickets after server verification; live payments and external reservation adapters are still required before real operations.

For Booking Counter, configure the operator's tax/charge rules, search an authorized route/date, select seats, hold them, enter passenger and contact details, then review the server quote. Booking sources are recorded by trusted channels. Quotas and booking acceptance controls require the appropriate permissions. Ticket print/download is available only for authoritative confirmed tickets. Unknown booking responses can be recovered using the same request/key instead of creating another booking.

`npm run build` validates TypeScript and creates dist. `npm test` uses explicit fixtures or mocked HTTP transport; normal runtime never enables fixtures. See src/api/client.ts, src/context/WorkspaceContext.tsx, src/utils/normalize.ts and src/features/ for integration boundaries. Setup and API documentation are in ../backend/README.md.

See [folder structure](../FOLDER-STRUCTURE.md) for source responsibilities and entrypoints.
