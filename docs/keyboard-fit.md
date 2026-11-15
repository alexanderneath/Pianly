# Fit to my keyboards

Sheet Practice maps physical cue keys into the range checked by the player.
**The music retains its written pitches.** Practice audio, hints, Listen,
Target and interval labels use the original score notes. Lights and recognition
use mapped physical keys. The previous implementation sounded those cue pitches,
raising the bass and collapsing musical registers.

Enable **Fit to my keyboards**, check the lowest and highest physical keys,
then keep the hardware octave setting fixed. The confirmed range is saved for
the selected input and ROLI port configuration across songs and app restarts.
Changing that configuration requires another check. Recheck manually after
moving hardware octave controls or joining/separating keyboards: MIDI port names
do not always expose those changes. Fitted practice requires a valid range.
Listen needs no keyboard calibration and always plays the original score.

The mapper chooses a consistent octave offset for the whole piece. If the whole
score cannot fit, it maximises the number of notes covered. Each chord preserves
its complete intervals when it fits by a common octave shift. Only chords that
cannot fit this way need individual key positions adjusted. The screen explains
when passages change position or wide chords use different spacing. A small
keyboard cannot reproduce the original physical fingering of a chord wider than
its span.

Every cue key retains its exact written pitch mapping. If several written
octaves must share one physical key, pressing it sounds all original pitches.
The interface discloses this; no pitches are discarded. **Target** shows written
notes and **Lit keys** shows mapped positions. **Playing** shows the pitches
sounded on the last presses, including keys held across a step change. This
screen uses scientific octave numbering (MIDI 60 = C4); internal legacy Pianly
names remain unchanged for parser/input compatibility. Free play outside
practice continues to sound the keyboard's actual MIDI pitches.

Only keys still needing a press remain cued. Releasing a key reasserts pending
cues after 30 ms, since the hardware can clear a new cue for a reused key.
Stop, pause and completion cancel pending refreshes.

With a confirmed range, fitting can be switched during practice without losing
position; partial chord progress and early presses reset. The option is locked
during Listen playback to keep the display stable.

## Verification

- `npm run test:keyboard`: in-range cues, exact recognition, timing, octave
  chords, repeated notes and MIDI limits.
- `npm run test:lumi`: repeated-key release recovery, partial chords, stale
  commands, pause/stop, output recovery, saved ranges and calibration.
- `npm run test:pitch`: independent expected MIDI pitches from the complete
  Fur Elise Easy and Maple Leaf Rag source MusicXML across four physical ranges.
  Checks original pitches for every practice cue and Listen/hints, Maple's
  opening register separation, early/repeated keys, combined octave keys and
  scientific display labels. Fixtures retain original measure order; repeat
  expansion itself is not part of this test.

Physical lights and speaker output still require an installed-app check.
