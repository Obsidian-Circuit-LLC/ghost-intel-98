# Ghost Intel 98 v3.85.0 — Address Book, less trippy

Thanks for the screenshots — they showed exactly what was wrong.

## The layout was the problem, not the fields

Those fields were always editable text boxes. What made them look broken is that each label was
rendering its caption and its input on the same line, jammed together — so a field read like a
squashed label instead of a box you type in. Every field now stacks its caption above a full-width
input. Same for the bio picture, which had slipped up next to the search bar; it sits in its own
fixed frame now and stays put.

Nothing about how you edit changed — it just looks like what it always was.

## The home list is alphabetical (and now says so)

It was already sorting every contact by name — you just had none saved yet, so there was nothing to
see it with. To make it unambiguous, the list now has a header: **All contacts (N) · A→Z** when
you're browsing, switching to a match count while you search. Scroll the full list on the left, or
type in the search box; both work off the same alphabetical order, sorted by Name regardless of
alias, exactly as you asked.

## Affiliation, added

New repeatable field with the same plus/minus buttons as Email and the rest, so you can list every
group, org or collective a contact is tied to — one or a dozen. It's searchable like everything
else, so a search for a collective's name pulls up everyone attached to it.

## The banner

Trimmed its height so it stops eating the window on a short screen, and the window opens a little
taller now so the editor has room to breathe. The art is yours — I just gave it a better frame.

## Under the hood

- Affiliation runs the full width of the stack — record, encrypted storage, IPC boundary check, UI
  and search — same as every other field.
- Tests cover the new field saving and searching, and the list header naming its order.
- Everything stays encrypted at rest, zero network.
