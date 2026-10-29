---
status: accepted
date: 2026-10-29
---

# ADR-0087: Rules controls as native inputs

The rules screen is not a Signal Forms form, unlike the nickname form ([ADR-0051](0051-signal-forms.md)). Its controls are native inputs in one `fieldset`: two checkboxes with `role="switch"`, and two radio groups, each in its own `fieldset` with a legend. Each input's `checked` is bound to the rules on screen, and its `change` event calls `RulesStore.change(field, value)`, which sends the edit ([ADR-0086](0086-rules-edits-sent-at-once.md)); a radio passes its option's typed value, so no string from the DOM is parsed. A native input changes itself before the store hears of it: when an edit fails before the next render (`NOT_CONNECTED` resolves at once), the rules on screen go back to the value already rendered, the `[checked]` binding sees no change, and the input would keep the player's value. An `afterRenderEffect` therefore writes the rules on screen into every input after each render; each input's `name` is the rule it sets. Details in [Client: Rules screen](../client.md#rules-screen) (#27).

## Considered options

- **Signal Forms with the rules as the model, and an effect that sends the model:** a `STATE` writes the model too, so the effect would send the opponent's edit back to the server, or need a flag to tell the two apart. Nothing on the screen needs validation, touched state or a submit: every offered combination is valid, and each change is sent on its own.
- **Signal Forms for display only, sending from `change` handlers:** two sources of truth for one value, the form's model and the synced draft.
- **Re-creating the inputs after a failure (a keyed block):** the inputs would be in step, but the focused control would be destroyed, and focus would fall to the page.

## Consequences

- ADR-0051's rule "client forms use Signal Forms" covers forms with a submit; the rules screen is a set of controls that act on change.
- The switches and segments are styled from the native inputs (`appearance: none`, `:has(:checked)`, `:has(:focus-visible)`), so keyboard, screen reader and form semantics stay the browser's.

## Links

- Added on 2026-10-29 for the rules negotiation UI ([#27](https://github.com/fabogit/battleship/issues/27)).
- Spec: [Client: Rules screen](../client.md#rules-screen)
- Amends: [ADR-0051](0051-signal-forms.md) (forms with a submit use Signal Forms; the rules screen does not)
- Related: [ADR-0086](0086-rules-edits-sent-at-once.md) (edits sent at once)
- Issues: [#27](https://github.com/fabogit/battleship/issues/27)
