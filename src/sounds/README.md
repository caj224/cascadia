# Custom sounds

Drop audio files in this folder to replace the synthesised drumroll and
fanfare. There is nothing to register — the build picks up whatever is here.

The **filename is the role**:

| File | When it plays |
|---|---|
| `drumroll.*` | While the result is still hidden |
| `fanfare.*` | Any win, unless the winner has their own file |
| `win-<name>.*` | That person wins — `win-dad.*` plays when Dad wins |
| `tie.*` | A tie is revealed — optional, `fanfare.*` covers it |

The name in `win-<name>.*` is matched the way names are matched everywhere else
in the app: trimmed and lower-cased. `win-dad.m4a` covers "Dad", "dad" and
"  DAD  ". Adding a personal sound for someone is just dropping in one more
file — no code change, no list to update.

A tie never uses a personal win sound, only `tie.*` or `fanfare.*`.

## What is here now

| File | Source |
|---|---|
| `fanfare.m4a` | Applause, first 5s of the Epidemic Sound crowd clip |
| `win-dad.m4a` | Britney Spears, 0:49–0:54 |
| `win-mom.m4a` | First 5s of `denver.mp3` |
| `win-caleb.m4a` | First 5s of "Vernon's Strut", Sven Andersson |
| `win-allison.m4a` | First 5s of "Teamwork", Stationary Sign |

Both are trimmed to 5s, level-matched to the same RMS so neither is jarringly
louder, and given a 0.4s fade-out (plus a short fade-in on the Britney clip,
which starts mid-song) so they do not end on a hard cut.

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
