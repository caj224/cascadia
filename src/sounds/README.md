# Custom sounds

Drop audio files in this folder to replace the synthesised drumroll and
fanfare. There is nothing to register — the build picks up whatever is here.

The **filename is the role**:

| File | When it plays |
|---|---|
| `drumroll.*` | While the result is still hidden |
| `fanfare.*` | The winner is revealed |
| `tie.*` | A tie is revealed — optional, `fanfare.*` covers it |

`mp3`, `m4a`, `aac`, `wav`, `ogg` and `flac` all work. `mp3` or `m4a` keep the
download small; a 300KB wav is fine too but is pure bloat next to a 30KB mp3.

Anything you leave out keeps its synthesised version, so a lone `fanfare.mp3`
is a perfectly good half-measure. A file that is missing, corrupt or blocked
falls back to the synth rather than playing nothing.

## Length

`drumroll.*` sets how long the reveal stays hidden — a 4-second file means a
4-second roll, no code change needed. Anything past 6 seconds is cut off so a
long file can't strand you on the roll screen.

Keep it under about 3 seconds. It plays every single time you record a game,
and what feels dramatic once gets old by the tenth.

## After adding files

`npm run build` to check, then commit and push — the deploy publishes them and
the service worker caches them on the next visit.
