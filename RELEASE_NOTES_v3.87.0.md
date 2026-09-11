# Ghost Intel 98 v3.87.0 — Address Book: layout, locking, and JSON backup

## The layout

Name/Alias and Occupation/Skills now sit side by side instead of stacking one per line, so a wide
editor pane fills instead of leaving half the width blank. The five repeatable sections — Email,
Phone, URL, Social Media, Affiliation — now sit two to a row for the same reason.

## Edit buttons on Email, Phone, URL, Social Media, Affiliation

Each of those five sections now opens **locked**: the values show, but they're read-only, and the
+/− buttons are disabled. Click **Edit** on a section to unlock just that one — the input becomes
typable and its +/− buttons come alive. Click **Done** to lock it again. Opening a different
contact always starts every section locked again.

This is the fix for "the interface is a bit broke" from touch/trackpad input on those fields —
a stray tap or a scroll pass could edit or delete an entry without meaning to, because they were
always live and clickable. They're inert until you deliberately open them now.

## Import / Export to JSON

Two new buttons beside New: **Export** writes every contact to a JSON file you choose, and
**Import** reads one back in — good for moving contacts between machines or keeping a backup before
a big change.

A couple of things worth knowing:

- **Import always creates new contacts.** It never overwrites what's already in your book, even if
  you import the same file twice — so it's safe to try.
- **Common-contact links are preserved between people in the same import file.** If Alice and Bob
  were linked when you exported them, importing that file relinks the new copies of Alice and Bob to
  each other.
- **Photos are not included.** A photo lives in a file on the machine that made it; the exported
  JSON can't carry that file along, so imported contacts start with no picture. Re-attach photos
  after importing if you need them.
- A row with no name is skipped rather than stopping the whole import — you'll see how many rows
  were added and how many were skipped.

## Under the hood

- 716 test files, 5,426 tests, zero failures; typecheck clean.
- Export/import go through the same native save/open file dialog every other export in this app
  uses — the file path is always picked by you, never guessed by the app.
- Everything in the address book stays encrypted at rest and the import/export files are plain JSON
  you control, same as any other backup you'd make yourself.
