# Aula on Freenet

Same web UI (`web/`), no server: the class lives in a [Freenet](https://freenet.org) contract and the browser talks to your local node.

- `contract/`: Rust contract, one per class. Parameters = teacher key + salt + app tag (the hex of all three, 112 characters, is the class code). Every record is signed by its author; only the teacher can write posts, members write their own submission and comments. A record is signed either by the key itself or, for a Viso (whoiam) persona, by a disposable device key with the persona's delegation attached. Rules and limits are at the top of `contract/src/lib.rs`.
- `api.js`: the server's JSON API reimplemented over those records (`web/lib.js` uses `globalThis.AULA_API` when it exists). `identity.js`: keys and the Viso proof. `auth.js`: the sign-in screen.
- `net.ts`: the WebSocket link to the node (contracts and the identity delegate); `npm run build` bundles it with the rest into `web/freenet-net.js` and copies the contract to `web/aula_class.wasm`.
- `web/freenet.html`: the page to publish (relative paths, loads `freenet-net.js`).

## Signing in

No server, no password. Three ways in:

- **Create a new identity**: a random key made in your browser. It is shown once to save; whoever has it is you, and nobody can recover it for you. Settings shows it again.
- **Use a key you saved**: paste the 64 characters (on a new device, to get your classes back).
- **Sign in with Viso**: Viso signs "this device key may act for me in Aula"; your Viso persona is then your identity. The device key is kept in this browser, so on another device sign in with Viso again and import this device's key from Settings to see your classes.

Log out keeps the key on this device ("Continue with the key saved here"); "Forget the saved key" removes it. The key, the session and the pending Viso sign-in are kept by the node itself, in the identity delegate of [FreeNames](https://github.com/scobru/freenames) (`delegate/`): that is what survives reloads and the redirect to Viso inside the sandboxed page, which has no `localStorage`. If the node has no delegate support, they stay in the tab (`window.name`: survives reloads, readable by pages the tab visits later) and the Viso round trip may not work.

The node injects a script into the page that takes over every same-origin link click (`navigation_interceptor.js` in freenet-core) and asks the shell to reload the frame with the new address, which drops everything in memory. In-page routes (`#/...`) do not need that, so `web/lib.js` marks those links `data-freenet-no-intercept`, and `net.ts` tells the shell the current fragment so the address bar and reload keep the position. If "Connecting to your Freenet node…" shows after every click anyway, the console prints "Aula: page loaded" each time: some link is not marked.

Keep the same site key when you publish updates: classes are bound to the page's address, and a new address means new class addresses and delegations that no longer match.

To publish, build the folder to upload and give it to `fdev`, as Orto does (`fdev website update <folder> --key aula`):

```bash
cd freenet && npm run dist     # freenet/dist = web/ with freenet.html as index.html
fdev website update dist --key aula
```

The contract serves `index.html`, so `web/index.html` (the server page, absolute paths, no Freenet code) must not be what you upload.

## What works

Create a class, join with the code, announcements, assignments, materials, submissions, class comments, remove/leave, archive, to-do and calendar, UI in English and Italian.

## What does not (yet)

- **No privacy inside a class**: anyone who knows the class code can read every record, including other students' submissions. Grades, returning work and private comments need encryption to the recipient first, so they are disabled, as are quizzes (the answer key), selected-student posts, files and co-teachers.
- **Removing a student does not revoke what they already read**, and cannot be undone by them (the teacher's removal is final).
- **A student's classes are remembered in that browser only**: on a new device, rejoin with the code. A teacher's classes are found again from the key.
- Not tried against a real Freenet node or the real Viso site: the contract is tested in Rust, the adapter against an in-memory store with a stand-in for Viso, and records signed by the browser code (direct and delegated) are accepted by the contract. The WebSocket part and the delegate plumbing (`net.ts`) follow Orto and FreeNames, and so does the Viso redirect round trip: all untested.
