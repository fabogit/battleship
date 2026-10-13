---
status: accepted
date: 2026-10-11
---

# ADR-0060: Nickname characters

After trimming and the length check, `parseNickname` also checks a nickname's characters. Refused anywhere in the name: controls (`Cc`), format characters (`Cf`), lone surrogates (`Cs`), line and paragraph separators (`Zl`, `Zp`), and the characters that render as blank space without being whitespace, so `trim()` keeps them: the Hangul fillers U+115F, U+1160, U+3164 and U+FFA0, the braille blank U+2800 and the musical null notehead U+1D159. There is one exception: a zero-width joiner (U+200D) between two pictographs, so emoji sequences such as 👩 U+200D 💻 (technologist), 🏳 U+FE0F U+200D 🌈 (rainbow flag) and 👨 🏽 U+200D 💻 (technologist with a skin tone) pass. A nickname must also hold at least one letter, number, punctuation mark or symbol, so a name of combining marks or variation selectors alone is refused. Inner spaces are kept. A blank-looking character is refused even between visible ones: `trim()` cannot see it, so it would bring back the leading and trailing blanks that trimming removes; between visible characters it only stands in for a space, which the space itself does; and none of them has a use in a nickname. The server guard and the client form share the function ([ADR-0051](0051-signal-forms.md)). The form says "Enter a nickname." for an empty field and names the refused kind of character otherwise. Details in [Protocol: Payload validation](../protocol.md#payload-validation) (#52, F3).

## Considered options

- **Only trimming and the length (the state through M1):** a nickname of zero-width spaces read as "Wait for to fire.", and a right-to-left override turned the rest of the sentence around, in the visible text and in the `aria-live` announcements alike. Angular's escaping already rules out markup, so the risk is spoofing and unreadable text, not XSS.
- **Refusing every `Cf`, the zero-width joiner included (the review's proposal):** simpler, but it refuses the emoji sequences that phone keyboards insert as one emoji. Between two pictographs the joiner only merges their glyphs; it cannot make a name blank or reorder the text around it.
- **An allowlist (letters, numbers, spaces and some punctuation):** refuses emoji and symbols that players do pick, and every script left out is a bug report. The blocklist names the few categories that cause harm.
- **A letter-or-number requirement instead of the blank-looking list:** misses U+3164 (a letter, `Lo`) and U+2800 (a symbol, `So`), which render blank, and refuses names such as "🚢" or "?!".
- **Stripping refused characters instead of refusing the name:** the player would get a name different from the one typed, and removing a character can turn two strings into the same one. A refusal shows the player what the opponent will see.
- **Refusing unassigned (`Cn`) and private-use (`Co`) code points:** which code points are unassigned depends on the engine's Unicode version, so a new emoji could pass on one side and fail on the other. A name of private-use characters alone already fails the visible-character check.
- **Isolating nicknames in sentences (`<bdi>` or FSI…PDI):** still worth having, since a right-to-left name can move the punctuation of the sentence around it, but it is display work and goes to #37 with the other RTL work. The guard keeps the stored value clean whatever the display does.
- **Confusables and normalization (Latin "Ada" against Cyrillic "Аda", NFC):** two players in a private room, and the nickname identifies no one beyond that room. Not worth the tables.

## Consequences

- The zero-width non-joiner (U+200C) is refused, though Persian and some Indic spellings use it inside words; such a name is still accepted without it, with a small change in letter shapes. The tag characters (U+E0020–U+E007F) that spell subdivision flags, such as Scotland's (🏴 followed by the tags for `gbsct`), are `Cf` too, so those flags are refused; country flags (🇮🇹) pass.
- The zero-width joiner is refused everywhere except between two pictographs, so Indic spellings that put it inside a word are refused too: Devanagari क् U+200D ष (the half form of क before ष, instead of the conjunct क्ष) and Sinhala ශ් U+200D රී (the joined form of "Sri"). Without the joiner the name is accepted, again with a small change in letter shapes. Accepted by the maintainer on 2026-10-13, since the game targets European alphabets.
- The categories come from the JavaScript engine's Unicode data (`\p{…}` with the `u` flag), in Node on the server and in the browser on the client. The refused characters have had the same categories for many Unicode versions, so both sides agree on them. A pictograph newer than an old browser's data counts as unassigned there, so a name made only of such pictographs is refused by that browser's form and accepted by the server.
- The length is still checked first, so a megabyte-long string never reaches the character checks.
- Nothing to migrate: rooms, and the nicknames in them, live only in the server's memory.

## Links

- Added on 2026-10-11 for the M1 review ([#52](https://github.com/fabogit/battleship/issues/52), F3).
- Amended on 2026-10-13 for the M1 review ([#52](https://github.com/fabogit/battleship/issues/52)): the cost of refusing the zero-width joiner inside Indic words; invisible characters written as code points.
- Spec: [Protocol: Payload validation](../protocol.md#payload-validation) · [Client: Routes & lobby flow](../client.md#routes--lobby-flow)
- Refines: [ADR-0031](0031-payload-guard-strictness.md)
- Related: [ADR-0051](0051-signal-forms.md) (the form validates with the same guard)
- Issues: [#52](https://github.com/fabogit/battleship/issues/52), [#37](https://github.com/fabogit/battleship/issues/37) (nickname isolation in sentences, RTL)
