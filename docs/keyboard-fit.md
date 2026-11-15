# Fit to my keyboards

Sheet Practice can adapt score octaves to the continuous MIDI range checked by
the player. Enable **Fit to my keyboards**, check the lowest and highest physical
keys, then keep the hardware octave setting fixed throughout the piece.

The option defaults on and remembers the user's choice. The confirmed range is
saved for the selected input and ROLI port configuration, so it survives changing
songs and reopening the app. A changed input or port configuration requires a
new check. Recheck manually after moving hardware octave controls or joining/
separating keyboards: MIDI port names do not always expose those changes.
Practice and Listen require confirmation before using fit mode;
they never silently fall back to unreachable original notes.

When one common octave shift fits the complete piece, the app uses it to preserve
all intervals. Otherwise it fits each step by octaves, preserving bass-to-melody
order and separate chord keys where possible. If a chord is too wide, voicing
can change; octave doubles share a key only when there are not enough separate
keys of that pitch class. These changes are disclosed in the practice screen.

This is an adapted learning arrangement. The original MusicXML and printed sheet
are unchanged. **Target** shows the keys to play, with **Written** notes below
when adapted. Key lights, exact MIDI recognition, hints and Listen playback use
the same adapted targets. Playing a MIDI key sounds that physical key's pitch.
Any-octave recognition is disabled while fitting is active.

Only targets still needing a fresh press remain cued. A physical key release
reasserts the latest pending cues after 30 ms, since the keyboard may clear its
own LED after the next step has already reused that key. Stopping, pausing or
finishing clears the lights and cancels pending refreshes.

With a confirmed range, fitting may be switched during practice without losing the current position.
Partial chord progress and early presses are cleared when switching. During
Listen playback the option is locked until playback stops, so scheduled audio
and the displayed arrangement stay consistent.

`npm run test:keyboard` checks the complete Fur Elise fixture, other score
excerpts, octave chords, repeated notes, exact recognition, timing preservation,
invalid ranges, and the MIDI pitch limits. Physical MIDI lights and sound still
require an installed-app check on the user's devices.

`npm run test:lumi` reproduces the Maple Leaf Rag opening release sequence and
checks repeated-key cue recovery, partial chords, stale commands, pause/stop,
output error recovery, saved ranges and the calibration requirement.
