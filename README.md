# Multiplayer Snake Battle

A room based Snake game for 2–8 players. The Node.js server owns each room's game loop and broadcasts one authoritative state to all clients over Socket.IO.

## Requirements

- Node.js 18 or later
- npm

## Run locally

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). Use the same address from other devices on the same Wi-Fi, replacing `localhost` with the host computer's LAN IP. For internet play, deploy the server or tunnel the port through a secure tunnel service.

Development mode (restarts on server file changes): `npm run dev`.

Run the multiplayer smoke test against a running server with `npm test`. It connects two independent Socket.IO clients and checks that they receive identical room and tick state.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP and Socket.IO listener port. Hosting providers usually set this automatically. |
| `CORS_ORIGIN` | `true` (allow all origins) | Optional Socket.IO CORS origin. Set to your public frontend origin if hosting frontend and server separately. |

The included app serves the frontend and real-time server from one origin, so no environment file is required locally.

## How to play

Create a room, share the invite link or six-character room code, and wait for at least one other player. The host starts the match. Steer using arrow keys or WASD; mobile browsers have on-screen controls. Collect the glowing snack for 10 points, avoid walls and other snake bodies. The last snake alive wins. There are no player accounts; disconnected players are removed from active play, and a player can rejoin a waiting room using their name and room code.

## Deploy

The server needs a persistent Node.js process and WebSocket support. Render, Railway, Fly.io, and similar Node hosts are suitable. This repository includes a Render Blueprint (`render.yaml`). For deployment:

1. Push this directory to a Git repository.
2. In Render, choose **New → Blueprint** and connect the repository, or create a Node web service manually.
3. The Blueprint sets the build command to `npm install`, start command to `npm start`, and health check to `/health`.
4. The provider supplies `PORT`; add `CORS_ORIGIN` only if the frontend is hosted separately.
5. Open the HTTPS service URL and test a room from two devices. Socket.IO negotiates WebSocket or polling through the same origin.

No public deployment has been created from this workspace. A hosting account and repository connection are needed to publish it.

## Notes

- Up to eight players can join a room.
- Rooms live in server memory and disappear after their final player disconnects or the server restarts.
- This starter prioritizes a single-process deploy. For multi-instance hosting, add a shared Socket.IO adapter and durable room storage.
