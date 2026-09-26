# THROW DOWN

A mobile-first Rock Paper Scissors fighting game with a real Three.js arena, six procedural fighters, animated attacks, and first-to-two scoring. Play with up to six friends in a live room: two fight, everyone else watches, and the winner faces the next queued challenger. An instant CPU mode is also available.

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open http://localhost:5173. One command starts Vite on port 5173 and the Node/Socket.IO server on port 3001. Vite proxies `/socket.io` and `/api` to the game server. Both listen on the local network. Invite links created on localhost use the computer's private Wi-Fi address when available. Friends must be on the same network until the app is publicly deployed.

```sh
npm test
npm run build
npm start
```

## Play

**Play with friends:** enter a name (or use the fighter's name), pick a fighter, and create an invite. Share `/fight/ABC234`. Friends choose their fighters and join ready. The host starts when two players are ready; additional players join the challenger queue and watch live. Six seats is a server-enforced limit, including disconnected seats held for reconnection.

Tap a move once to lock it. First to two wins; draws don't score. Multiplayer rounds advance automatically. Waiting ready challengers get priority: the winner stays and the loser goes to the end of the queue. When no challenger is ready, both fighters may consent to a rematch. Players can unready while waiting.

**Play with a random stranger:** intentionally uses the existing local CPU match, labeled "CPU opponent" on the button, fighter selection, and match HUD. It does not pretend to match with an unknown human. CPU rounds use Next Round; Run It Back preserves the opponent.

R / P / S are desktop shortcuts. A missing move times out after 45 seconds, returns the room to the lobby, and marks the idle fighter unready without inventing a move for them. A disconnected fighter pauses the match for up to 60 seconds. Refreshing the same tab restores the seat using a private reconnect token. On explicit exit or grace-period expiry, an interrupted fight returns to the lobby and remaining players may start another fight. The host role transfers to an available player.

Sound is synthesized with Web Audio. The announcer uses the device's speech synthesis when available; voice quality varies by device. Sound unlocks after a user gesture and can be muted. Camera shake can be reduced in How to Play, and system reduced-motion preferences are respected. There are no external image or model assets and no runtime third-party requests.

## Architecture

- `src/game.ts`: pure round resolver, isolated local match authority, roster, and avatar descriptor. CPU chooses independently before player input is enabled. Private fields do not appear in serialized match snapshots. This is local fairness, not a multiplayer security boundary.
- `src/arena.ts`: one Three.js canvas, procedural stadium and articulated fighters, instanced crowd, shared lighting, pre-rendered fighter portraits, camera and move effects. Pixel ratio is capped at 1.5. No expensive postprocessing or dynamic shadow maps. Resource disposal runs when fighters/effects are replaced. Rendering pauses in background tabs.
- `src/main.ts`: screen flow, presentation timing, accessible HTML controls, keyboard shortcuts, score HUD, selfie handling, and result sharing. A sequence token cancels stale asynchronous flow after leaving/restarting a match.
- `src/audio.ts`: short synthesized effects and optional browser speech.
- `src/style.css`: portrait-first controls, smaller-height phone rules, safe-area support, desktop expansion.
- `src/protocol.ts`: shared public room snapshots, membership, and action types.
- `server/rooms.ts`: authoritative room lifecycle, private choices, scoring, queue, timeouts, rematch consent, and reconnect sessions. The same rules run locally and in Cloudflare Durable Objects.
- `server/app.ts`: Socket.IO transport, input error responses, rate limits, same-origin browser connection checks, expiry loop, and production static/deep-link serving.
- `src/multiplayer.ts`: acknowledged commands, reconnect/resync, and per-tab session storage.
- `cloudflare/worker.ts` and `src/cloud-multiplayer.ts`: persistent Cloudflare room coordinator and browser WebSocket transport for public play.
- `src/friends.ts` / `src/friends.css`: lobby, invitations, spectators, synchronized match presentation, and winner/queue UI.

Direct Three.js was chosen over React Three Fiber because this prototype needs a small imperative scene and a simple UI; React would add a second state/rendering model without a current benefit. Vite and TypeScript provide a fast dev loop and type-checked build.

Selfie portraits remain available in CPU mode. They are decoded, center-cropped and resized to a 512px JPEG in memory, are not uploaded or persisted, and do not change the 3D model. Friends rooms currently use preset portraits. Invalid formats and files over 8MB are rejected. `AvatarDescriptor` separates preset identity, portrait, optional future model URL, and generation status. Generated model loading and AI jobs are not implemented yet.

## Multiplayer integrity and hosting

Pending choices and session tokens never enter public room snapshots. Before reveal, other clients see only each player's lock status. The server reveals both choices together after both lock and the countdown completes. It validates socket identity, active-player membership, phase, move, match ID and round number, rejecting spectators, duplicates, stale submissions, and invalid values. Clients receive current snapshots on reconnect instead of depending on replay of missed events. The browser cannot award itself points.

For local development, `npm run dev` uses the Node/Socket.IO server. `npm run build && npm start` serves both parts from one Node process on port 3001. The Cloudflare deployment uses a Worker with a Durable Object per room. To publish it, authenticate Wrangler, run `npx wrangler deploy`, then build Pages with `VITE_REALTIME_URL=https://<your-worker>.workers.dev npm run build` and deploy `dist` using `npx wrangler pages deploy dist --project-name throwdown-rps --branch main`. `npm run check:worker` typechecks and validates the Worker. With `npm run dev:worker` running locally, `npm run test:worker:live` exercises its WebSocket flow. The production frontend must be built with `VITE_REALTIME_URL`; a static Pages upload without that setting cannot create online rooms.

The local Node server keeps rooms in memory. Cloudflare rooms persist in Durable Object storage, so a Worker restart can restore room state and reconnecting seats. Rooms expire after two hours without activity. Cloudflare limits each room to six players, 35 actions per socket per ten seconds, and 16KB inbound messages. The local Node server also caps room creation by IP. Invitations grant entry to anyone holding the code until the six seats fill. No account, chat, global matchmaking, or tournament bracket is included.

## Background music

Use the ♫ button to choose a local MP3, M4A, WAV, or OGG under 30MB. It loops under the game, has a separate volume control and play/pause, follows master mute, and pauses when the page is hidden. Playback starts after a user action to satisfy mobile autoplay restrictions. The audio file remains on that device and is released on removal/reload. It is not uploaded to the room server or streamed to other players.

The requested "Gonna Fly Now" instrumental is **not included**: no licensed recording was supplied. The audio player is ready to play a user-provided file. To distribute that recording to all players as a default soundtrack, supply an appropriately licensed asset for integration. `tests/audio-fixture.ts` generates an original short tone for testing playback; it is not a substitute soundtrack.

## Verification status

- TypeScript and production build pass.
- `npm test` first builds the production app, then runs 29 automated tests covering CPU rules and the multiplayer lifecycle, including a real Socket.IO integration test connecting six independent clients. Checks include full-room rejection, room isolation, hidden choices, spectators, stale/duplicate locks, draws, victory, rematch consent, FIFO challenger rotation, reconnect identity, pause/resume, host transfer, choice timeout, room expiry, and production deep-link routing.
- Browser playthrough across three separate tabs verified creating/joining a room, spectators, hidden locks, all three winning move types, draws, KO, winner/next challenger, mutually accepted rematch, refresh/reconnection, copying invitations, and leaving a fight.
- Phone-size checks at 390×844 and 360×640 and desktop checks were performed. A front lighting support obstructing the portrait camera was removed. The small-phone lobby scrolls vertically without horizontal overflow.
- Background audio loading, playback, pause, and removal were exercised with a generated original test tone.
- The retained CPU mode was played through draws, attacks, KO, and a 2–0 winner screen. No game runtime errors appeared in the fresh invited-client console; the original tab recorded one Vite development reconnect warning during server restart.

Still needed before public launch: deploy the Cloudflare Worker and rebuild Pages with its URL; real-device Safari/Android performance and audio checks; cross-network/mobile-data playtesting; and a licensed soundtrack file if that recording should be included. Selfie generation and tournament mode remain future work.

All fighters, arena geometry, and presentation are original. No Tekken, Street Fighter, or UFC assets or branding are used. Dependencies retain their respective licenses; fonts are distributed by Fontsource under their included licenses.
