---
status: accepted
date: 2026-10-16
---

# ADR-0079: Share dialog

"Share link" used to call `navigator.share` wherever it existed and to read an `AbortError` as the player closing the sheet. Desktop Linux Chromium has `navigator.share` but no sheet behind it: the call rejects at once with `AbortError`, so the button did nothing (#109). On a computer the friend to invite is often on a phone, so a QR code serves better than a system sheet anyway. The waiting screen now picks how to share:

- **Phones and tablets** (`(pointer: coarse)` matches and the browser has `navigator.share`): "Share link" opens the system share sheet, as before. Closing it is not an error.
- **Everywhere else:** "Share link" opens the share dialog, a modal `<dialog>`: a QR code of the room link, the link in a read-only field, "Copy link", "Other apps…" (the system sheet, only where `navigator.share` exists) and "Close". No messenger or email shortcuts (decided on 2026-10-15).
- **A sheet that fails to open** opens the dialog instead, which says so: any error but `AbortError`, and an `AbortError` that comes sooner than `NATIVE_SHEET_FAILURE_MS` (500 ms) after the call. A person needs longer than that to see a sheet slide in and close it; Linux Chromium answers within milliseconds. Once a sheet has failed, "Share link" goes straight to the dialog and "Other apps…" is inactive (`aria-disabled`) until the lobby is left.
- **Accessibility:** the dialog is named by its heading. `showModal()` makes the page behind it inert, and `autofocus` puts focus on "Copy link". Esc or "Close" closes the dialog, and focus returns to "Share link". The QR code is an image named by the link it holds, and the dialog has its own `aria-live` message line.
- **QR code:** `uqr` (MIT, no dependencies), its `encode` only. `QrCode` (`shared/qr-code`) draws the matrix as one SVG `path` bound with `[attr.d]`, one rectangle per run of dark modules in a row, so no `innerHTML` or sanitizer bypass is needed. The code uses error correction level M (15 %, for glare on a screen) and the standard 4-module quiet zone, and stays black on white in the dark theme, since not every camera reads an inverted code.
- **Bundle:** the code is bundled with the app, not deferred. Measured on the production build: +15.2 kB raw, +4.4 kB transferred (118.7 → 123.1 kB; initial bundle 465.5 kB of the 500 kB warning budget, with #108). A `@defer` block made things worse: the initial bundle still grew by 14.1 kB raw and 5.5 kB transferred, because shared Angular code moved into a new chunk, and a 4.1 kB lazy chunk came on top. It would also have brought back the stale-chunk risk after a deploy (#63).

Details in [Client: Routes & lobby flow](../client.md#routes--lobby-flow).

## Considered options

- **Keeping the sheet wherever `navigator.share` exists:** the bug. Feature detection cannot tell a working sheet from a missing one: `navigator.canShare` checks the data, not the platform.
- **Detecting Linux from the user agent:** it breaks with the next browser that ships the API without a sheet, and the reduced user agent hides the platform less and less reliably. The timing catches every sheet that fails at once.
- **Opening the dialog on every device:** phones have a better sheet, with the player's own messengers and contacts.
- **Messenger and email shortcuts in the dialog:** each is a third-party URL format to keep up to date and to translate (#37); "Copy link" and "Other apps…" cover them.
- **`renderSVG` from `uqr` with `innerHTML`:** it needs `bypassSecurityTrustHtml`, which the bindings avoid at no cost.

## Consequences

- `SHARE_OUTCOMES` gains `sheet-failed` (pinned by its spec, ADR-0043).
- A new client dependency, `uqr`; the [bundle headroom](../roadmap.md#open-risks) for #53 shrinks by 15 kB.
- A player who closes a phone's sheet within 500 ms gets the dialog instead of nothing.
- jsdom has no `showModal()`, so the lobby spec stubs it. Esc, focus, Tab and the QR code were checked in Chromium with Playwright (the code decoded back to the room link), which is not part of CI.

## Links

- Added on 2026-10-16 for the share dialog ([#109](https://github.com/fabogit/battleship/issues/109)).
- Spec: [Client: Routes & lobby flow](../client.md#routes--lobby-flow) · [Client: Layout](../client.md#layout)
- Related: [ADR-0049](0049-room-route.md) (room route and link) · [ADR-0050](0050-entry-before-connection.md) (`aria-disabled` controls) · [ADR-0051](0051-signal-forms.md) (bundle size)
- Issues: [#109](https://github.com/fabogit/battleship/issues/109) · [#53](https://github.com/fabogit/battleship/issues/53) (bundle headroom) · [#63](https://github.com/fabogit/battleship/issues/63) (stale chunks) · [#37](https://github.com/fabogit/battleship/issues/37) (translations)
