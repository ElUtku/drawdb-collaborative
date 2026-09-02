<div align="center">
  <sup>Special thanks to:</sup>
  <br>
  <a href="https://www.warp.dev/drawdb/" target="_blank">
    <img alt="Warp sponsorship" width="280" src="https://github.com/user-attachments/assets/c7f141e7-9751-407d-bb0e-d6f2c487b34f">
    <br>
    <b>Next-gen AI-powered intelligent terminal for all platforms</b>
  </a>
</div>

<br/>
<br/>

<div align="center">
    <img width="64" alt="drawDB logo" src="./src/assets/icon-dark.png">
    <h1>drawDB Collaborative</h1>
</div>

<h3 align="center">A self-hosted, real-time collaborative database schema editor.</h3>

<div align="center" style="margin-bottom:12px;">
    <a href="https://github.com/yms2772/drawdb-collaborative" style="display: flex; align-items: center;">
        <img src="https://img.shields.io/badge/Source-GitHub-grey?logo=github" alt="Source code"/>
    </a>
    <a href="./LICENSE" style="display: flex; align-items: center;">
        <img src="https://img.shields.io/badge/License-AGPL--3.0-blue" alt="AGPL-3.0 license"/>
    </a>
</div>

<h3 align="center"><img width="700" style="border-radius:5px;" alt="drawDB screenshot demo" src="drawdb.png"></h3>

drawDB Collaborative is an unofficial fork of
[drawDB](https://github.com/drawdb-io/drawdb). It adds centralized SQLite
storage and real-time WebSocket collaboration while retaining drawDB's
browser-based ERD editing and SQL import/export features.

This fork is independently maintained and is not affiliated with or endorsed
by the original drawDB maintainers.

Key additions include:

- Invite-only accounts with server-side sessions, managed by an administrator
- Centralized diagram storage backed by SQLite
- Real-time table movement and editing between participants
- Participant presence and viewport-aware collaborative cursors
- Optimistic version checks that prevent stale clients from overwriting changes
- A single-container setup for the frontend, API, WebSocket server, and storage

## Getting Started

### Local Development

```bash
git clone https://github.com/yms2772/drawdb-collaborative.git
cd drawdb-collaborative
npm install
npm run dev
```

This starts both the Vite frontend on port `5173` and the API/WebSocket server
on port `3000`. Use `npm run dev:client` or `npm run dev:server` when only one
side is needed.

### Build

```bash
git clone https://github.com/yms2772/drawdb-collaborative.git
cd drawdb-collaborative
npm install
npm run build
```

### Docker Build

```bash
docker compose up --build
```

Open `http://localhost:3000`. The single application container serves the
frontend, diagram API, WebSocket collaboration endpoint, and SQLite storage.
The Compose configuration persists the database in the `drawdb-data` volume.

### Collaborative self-hosting

Diagrams are stored centrally in SQLite; IndexedDB is not used for diagram
storage. `DATABASE_PATH` controls the database location and defaults to
`./data/drawdb.sqlite` outside the container. Diagram URLs use
`/diagrams/:diagramId`, and everyone opening the same URL joins the same live
session automatically.

The application exposes:

- `GET /api/auth/status`, `POST /api/auth/register`, `POST /api/auth/login`,
  `POST /api/auth/logout`, `GET /api/auth/me`
- `GET|POST /api/admin/users` (administrator only)
- `GET|POST /api/diagrams`
- `GET|PUT|DELETE /api/diagrams/:diagramId`
- `/ws/diagrams/:diagramId` (WebSocket)

### Accounts

Every diagram endpoint and the WebSocket handshake require a signed-in user.

There is no open registration. The first visit to a fresh instance offers
`/register` once: that first account claims the instance and becomes its
administrator. From then on `/register` returns `403` and accounts are created
only by the administrator, through the people icon in the editor toolbar (or
`POST /api/admin/users`). Accounts created that way are always regular users —
the administrator role cannot be granted over the API, so an instance has
exactly one administrator. Upgrading an instance that already had accounts
promotes its earliest account to administrator.

If the administrator account is lost, the recovery path is direct SQL against
the database, for example
`UPDATE users SET is_admin = 1 WHERE username = '<name>';`.

Passwords are hashed with scrypt and sessions are stored in SQLite, referenced
by an `HttpOnly`, `SameSite=Lax` session cookie that is marked `Secure` when the
request arrives over HTTPS. Sessions last 30 days and slide forward as they are
used, so make sure the reverse proxy forwards `X-Forwarded-Proto` (see below)
for the `Secure` flag to be set correctly.

Access follows an owner-plus-link model:

- The creator owns a diagram, sees it in their diagram list, and is the only
  one who can delete it.
- Any signed-in user who has the diagram URL can open, edit, and collaborate on
  it. Treat diagram URLs as shareable secrets.
- Diagrams created before authentication was added have no owner. They stay
  visible and deletable for every signed-in user so no data is stranded.

Collaborator names shown in presence and on cursors come from the signed-in
account, not from the browser, so clients cannot spoof each other.

Snapshot saves are debounced and guarded by an optimistic version. Stale
clients receive the current snapshot instead of silently overwriting it.
Reconnects send the last known version and converge on the server snapshot.

When running behind a reverse proxy, forward `X-Forwarded-For` and
`X-Forwarded-Proto`, and allow WebSocket `Upgrade`/`Connection` headers on the
`/ws` path. The browser derives `ws://` or `wss://` from the current origin, so
no public hostname or `localhost` value is required in production.

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## License and source availability

This project is distributed under the
[GNU Affero General Public License v3.0](LICENSE). It is based on
[drawDB](https://github.com/drawdb-io/drawdb), which is also distributed under
the GNU AGPL v3.0.

If you interact with a deployed, modified version of this application over a
network, you are entitled to receive the Corresponding Source for that version
under section 13 of the GNU AGPL. The source for this version is available at:

https://github.com/yms2772/drawdb-collaborative

Copyright and attribution notices from the original project are retained. See
the repository history for changes made by this fork.

## Upstream project

- Original source: [drawdb-io/drawdb](https://github.com/drawdb-io/drawdb)
- Original project website: [drawdb.app](https://drawdb.app/)
- Upstream community: [Discord](https://discord.gg/BrjZgNrmR6)
