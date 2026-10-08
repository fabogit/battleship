---
status: accepted
date: 2026-10-08
---

# ADR-0051: Signal Forms

Client forms use Angular's Signal Forms (`@angular/forms/signals`, stable since Angular 22): a `signal` model, `form()` with its rules, `[formField]` on the inputs and `[formRoot]` on the `<form>`, whose `submission.action` runs on a valid submit and drives `submitting()`. Rules reuse core's guards wherever one exists, so a form accepts exactly what the server accepts: the nickname field validates with `parseNickname`, and `maxLength(NICKNAME_MAX_LENGTH)` puts `maxlength` on the input. `@angular/forms` joins the `angular` pnpm catalog. Details in [Client: Routes & lobby flow](../client.md#routes--lobby-flow) (#17).

## Considered options

- **A plain `<input>` bound to a signal by hand:** enough for one field, but touched state, validation errors, the submitting state and the `maxlength`/`aria` wiring would be rewritten by every form, and the rules form of #27 has several fields.
- **Reactive forms (`FormGroup`, `FormControl`):** Observable-based, with values typed through generics on each control; the rest of the client is signals.
- **Template-driven forms (`ngModel`):** validation lives in template directives, where core's guards cannot be reused as they are.

## Consequences

- One more Angular package in the initial bundle (368 kB raw, about 98 kB transferred, after #17), within the 500 kB warning budget.

## Links

- Added on 2026-10-08 for the nickname form ([#17](https://github.com/fabogit/battleship/issues/17)).
- Spec: [Client: Routes & lobby flow](../client.md#routes--lobby-flow)
- Related: [ADR-0031](0031-payload-guard-strictness.md) (the guards the forms reuse)
- Issues: [#17](https://github.com/fabogit/battleship/issues/17), [#27](https://github.com/fabogit/battleship/issues/27) (rules negotiation UI)
