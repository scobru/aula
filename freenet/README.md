# Aula on Freenet

Same web UI (`web/`), no server: the class lives in a [Freenet](https://freenet.org) contract and the browser talks to your local node.

- `contract/`: Rust contract, one per class. Parameters = teacher key + salt (the hex of both is the class code). Every record is signed by its author; only the teacher can write posts, members can write their own submission and comments. Rules and limits are at the top of `contract/src/lib.rs`.
- `api.js`: the server's JSON API reimplemented over those records (`web/lib.js` uses `globalThis.AULA_API` when it exists). Your key comes from username + password, so the same login on another device is the same person.
- `net.ts`: the WebSocket link to the node; `npm run build` bundles it with `api.js` into `web/freenet-net.js` and copies the contract to `web/aula_class.wasm`.
- `web/freenet.html`: the page to publish (relative paths, loads `freenet-net.js`).

```bash
cd freenet && npm install
npm test          # adapter tests (node) + contract tests (cargo)
npm run build     # needs rust + the wasm32-unknown-unknown target
```

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
- **A student's classes are remembered in that browser only**: on a new device, rejoin with the code. A teacher's classes are found again from the login.
- **The password is the key**: a weak password can be guessed offline from the public key, and it cannot be changed. Use a long one.
- Not tried against a real Freenet node: the contract is tested in Rust, the adapter against an in-memory store, and the signed-message format is checked both ways. The WebSocket part (`net.ts`) follows Orto's and is untested.
