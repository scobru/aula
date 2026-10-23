# Identity delegate

`identity.wasm` is the identity delegate of [FreeNames](https://github.com/scobru/freenames) (MIT, same author), copied unchanged from
`ui/src/identity.wasm` at commit `44b38cf102897ca9aaa54709d8231e32a1667ef4` (source: `identity/src/lib.rs` there).
sha256 `adbc1c01cc19254ef6c79c98447fd771efdb4279371b45f3e3a5bbf5f0804315`.

A delegate is a small module the Freenet node runs for a web app, with storage the node keeps per calling app. Aula uses only its key/value
store (`put` and `get`) to keep the device key, the session and the pending Viso sign-in, so they survive reloads and the redirect to Viso
inside the sandboxed page, which has no `localStorage`. The node namespaces the store by the app's contract id: FreeNames cannot read Aula's.

`npm run build` copies it to `web/identity.wasm`. To rebuild it from source instead, build the FreeNames crate as a delegate (`fdev build`)
and replace the file; the client (`net.ts`) only needs the `put` and `get` operations.
