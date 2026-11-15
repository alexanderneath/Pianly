import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fitTimelineToRange, scoreNotes, notesForKey } from '../src/practice/keyboardFit.js'
import { midiToNoteName, noteNameToMidi, displayNoteName } from '../src/utils/noteConversion.js'
import { StepGate } from '../src/practice/stepGate.js'

const source = JSON.parse(readFileSync(new URL('./fixtures/written-pitches.json', import.meta.url), 'utf8'))
const timeline = (piece) => piece.steps.map(([timeSec, pitches]) => ({ timeSec, durationSec: 0.25, notes: pitches.map(midiToNoteName) }))
const midis = (notes) => notes.map(noteNameToMidi).sort((a, b) => a - b)
const unique = (notes) => [...new Set(notes)].sort((a, b) => a - b)
let passed = 0
function test(name, run) { run(); passed++; console.log('ok - ' + name) }

test('display octave numbers match MusicXML while internal MIDI values stay unchanged', () => {
  assert.equal(displayNoteName(midiToNoteName(60)), 'C4')
  assert.equal(displayNoteName(midiToNoteName(69)), 'A4')
  assert.equal(displayNoteName(midiToNoteName(39)), 'Eb2')
  assert.equal(noteNameToMidi(midiToNoteName(60)), 60)
})

test('independent source pitches anchor the original Fur Elise and Maple Rag octaves', () => {
  assert.deepEqual(source.pieces[0].steps.slice(0, 3).map((s) => s[1]), [[76], [75], [76]])
  assert.deepEqual(source.pieces[1].steps.slice(0, 3).map((s) => s[1]), [[39, 51], [44, 56], [68]])
})

for (const piece of source.pieces) {
  for (const range of [{ low: 48, high: 95 }, { low: 60, high: 107 }, { low: 84, high: 127 }, { low: 60, high: 83 }]) {
    test(`${piece.path}: original sound survives every cue on ${range.low}-${range.high}`, () => {
      const original = timeline(piece), snapshot = structuredClone(original)
      const fitted = fitTimelineToRange(original, range)
      assert.equal(fitted.error, null)
      const gate = new StepGate((a, b) => noteNameToMidi(a) === noteNameToMidi(b))
      fitted.timeline.forEach((entry, i) => {
        const expected = piece.steps[i][1]
        // Listen and hints use scoreNotes, independently of which keys can light.
        assert.deepEqual(midis(scoreNotes(entry)), expected, `playback changed at step ${i + 1}`)
        const sounded = []
        gate.reset()
        for (const key of entry.notes) {
          const pitch = noteNameToMidi(key)
          assert.ok(pitch >= range.low && pitch <= range.high)
          sounded.push(...midis(notesForKey(key, entry, fitted.timeline[i + 1], { octaveShift: fitted.octaveShift })))
          gate.press(key, entry.notes, fitted.timeline[i + 1]?.notes, false, i)
        }
        assert.deepEqual(unique(sounded), expected, `practice sound changed at step ${i + 1}`)
        assert.equal(gate.check(entry.notes).complete, true)
        assert.equal(entry.timeSec, original[i].timeSec)
      })
      assert.deepEqual(original, snapshot)
    })
  }
}

test('Maple bass octave and higher Ab melody occupy distinct registers on two keyboards', () => {
  const fitted = fitTimelineToRange(timeline(source.pieces[1]), { low: 60, high: 107 })
  const bass = midis(fitted.timeline[1].notes), melody = midis(fitted.timeline[2].notes)
  assert.equal(bass[1] - bass[0], 12)
  assert.equal(melody[0] - bass[1], 12, 'the higher Ab must be an octave above the upper bass Ab')
  assert.deepEqual(midis(scoreNotes(fitted.timeline[1])), [44, 56])
  assert.deepEqual(midis(scoreNotes(fitted.timeline[2])), [68])
})

test('Fur Elise high melody sounds E5 even when physical MIDI range starts at 84', () => {
  const fitted = fitTimelineToRange(timeline(source.pieces[0]), { low: 84, high: 127 })
  const first = fitted.timeline[0]
  assert.deepEqual(midis(notesForKey(first.notes[0], first)), [76])
  assert.equal(displayNoteName(scoreNotes(first)[0]), 'E5')
})

test('one physical key can preserve several written octaves without deleting sound', () => {
  const fitted = fitTimelineToRange([{ notes: [24, 36, 48].map(midiToNoteName) }], { low: 60, high: 71 })
  const entry = fitted.timeline[0]
  assert.equal(entry.notes.length, 1)
  assert.deepEqual(midis(notesForKey(entry.notes[0], entry)), [24, 36, 48])
})

test('a reused key takes the next written pitch while waiting for the next step', () => {
  const fitted = fitTimelineToRange([{ notes: [36].map(midiToNoteName) }, { notes: [72].map(midiToNoteName) }], { low: 60, high: 71 })
  const [current, next] = fitted.timeline
  assert.deepEqual(midis(notesForKey(current.notes[0], current, next)), [36])
  assert.deepEqual(midis(notesForKey(next.notes[0], current, next, { waiting: true })), [72])
})

test('early next-step keys and wrong notes use the correct musical register', () => {
  const fitted = fitTimelineToRange([{ notes: [36].map(midiToNoteName) }, { notes: [40].map(midiToNoteName) }], { low: 60, high: 83 })
  const [current, next] = fitted.timeline
  assert.deepEqual(midis(notesForKey(next.notes[0], current, next, { octaveShift: fitted.octaveShift })), [40])
  assert.deepEqual(midis(notesForKey(midiToNoteName(62), current, next, { octaveShift: fitted.octaveShift })), [38])
})

test('unmapped notes preserve normal free-play MIDI pitch', () => {
  assert.deepEqual(midis(notesForKey(midiToNoteName(69), null, null)), [69])
})

console.log(`${passed} pitch-preservation checks passed`)
