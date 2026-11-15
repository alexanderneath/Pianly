import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fitTimelineToRange } from '../src/practice/keyboardFit.js'
import { StepGate } from '../src/practice/stepGate.js'
import { midiToNoteName, noteNameToMidi } from '../src/utils/noteConversion.js'

const moment = (pitches, timeSec = 0) => ({
  notes: pitches.map(midiToNoteName), timeSec, durationSec: 0.5,
  cursorSec: timeSec, measure: 1, tick: timeSec * 1920,
})
const pitches = (entry) => entry.notes.map(noteNameToMidi)
let passed = 0
function test(name, run) { run(); passed++; console.log('ok - ' + name) }

test('missing calibration leaves the written arrangement intact', () => {
  const original = [moment([33, 57, 69])]
  assert.equal(fitTimelineToRange(original, null).timeline, original)
})

test('invalid or too narrow ranges are reported without losing notes', () => {
  const original = [moment([60])]
  for (const range of [{ low: 60, high: 69 }, { low: -1, high: 80 },
    { low: 60, high: 128 }, { low: 80, high: 60 }, { low: 48.5, high: 95 }]) {
    const fitted = fitTimelineToRange(original, range)
    assert.ok(fitted.error)
    assert.equal(fitted.timeline, original)
  }
})

test('unsupported notes fail explicitly instead of dropping a target', () => {
  assert.ok(fitTimelineToRange([{ notes: ['not-a-note'] }], { low: 48, high: 95 }).error)
})

test('an arrangement that fits is unchanged', () => {
  const original = [moment([48, 64, 95])]
  const fitted = fitTimelineToRange(original, { low: 48, high: 95 })
  assert.equal(fitted.adjustedNotes, 0)
  assert.equal(fitted.timeline[0], original[0])
})

test('one common octave shift preserves all intervals when possible', () => {
  const fitted = fitTimelineToRange([moment([36, 48]), moment([60], 1)], { low: 60, high: 107 })
  assert.equal(fitted.octaveShift, 2)
  assert.deepEqual(fitted.timeline.map(pitches), [[60, 72], [84]])
})

test('the blocked A chord uses two separate keys, with bass below melody', () => {
  const source = [moment([57, 69]), moment([33, 77], 1)] // no common shift fits
  const fitted = fitTimelineToRange(source, { low: 60, high: 107 })
  assert.equal(fitted.octaveShift, null)
  assert.deepEqual(pitches(fitted.timeline[0]), [69, 81])
  const gate = new StepGate((a, b) => noteNameToMidi(a) === noteNameToMidi(b))
  const target = fitted.timeline[0].notes
  assert.equal(gate.press(midiToNoteName(69), target, null, false, 0), 'building')
  assert.equal(gate.press(midiToNoteName(81), target, null, false, 1), 'complete')
})

test('octave doubles only combine when there are not enough keys', () => {
  const fitted = fitTimelineToRange([moment([24, 36, 48])], { low: 60, high: 71 })
  assert.deepEqual(pitches(fitted.timeline[0]), [60])
  assert.equal(fitted.mergedNotes, 2)
  assert.equal(fitted.timeline[0].writtenNotes.length, 3)
})

test('same note repeated still requires a new press', () => {
  const fitted = fitTimelineToRange([moment([33]), moment([33], 1)], { low: 48, high: 95 })
  const gate = new StepGate((a, b) => noteNameToMidi(a) === noteNameToMidi(b))
  const [first, next] = fitted.timeline
  assert.equal(gate.press(first.notes[0], first.notes, next.notes, false, 0), 'complete')
  gate.advance()
  assert.equal(gate.check(next.notes).complete, false)
  assert.equal(gate.press(next.notes[0], next.notes, null, false, 1), 'complete')
})

test('recognition requires the playable target, not its unreachable written octave', () => {
  const fitted = fitTimelineToRange([moment([33]), moment([77], 1)], { low: 48, high: 95 })
  const target = fitted.timeline[0].notes
  assert.deepEqual(pitches(fitted.timeline[0]), [57])
  const gate = new StepGate((a, b) => noteNameToMidi(a) === noteNameToMidi(b))
  assert.equal(gate.press(midiToNoteName(33), target, null, false, 0), 'wrong')
  assert.equal(gate.press(midiToNoteName(57), target, null, false, 1), 'complete')
})

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/practice-timelines.json', import.meta.url), 'utf8'))
for (const [name, fixture] of Object.entries(fixtures)) {
  if (!fixture.entries) continue
  const byTick = new Map()
  for (const [tick, duration, , notes] of fixture.entries) {
    if (!byTick.has(tick)) byTick.set(tick, {
      tick, timeSec: tick / 960 * 60 / fixture.bpm, cursorSec: tick / 960 * 60 / fixture.bpm,
      durationSec: duration / 960 * 60 / fixture.bpm, measure: 1, notes: [],
    })
    byTick.get(tick).notes.push(...notes.split(','))
  }
  const original = [...byTick.values()]
  const snapshot = structuredClone(original)
  for (const range of [{ low: 48, high: 95 }, { low: 60, high: 107 }, { low: 60, high: 83 }]) {
    test(`${name}: every step can be completed in ${range.low}-${range.high}`, () => {
      const fitted = fitTimelineToRange(original, range)
      assert.equal(fitted.error, null)
      assert.equal(fitted.timeline.length, original.length)
      const gate = new StepGate((a, b) => noteNameToMidi(a) === noteNameToMidi(b))
      for (let i = 0; i < fitted.timeline.length; i++) {
        const entry = fitted.timeline[i]
        const expectedClasses = new Set(pitches(original[i]).map((n) => n % 12))
        assert.deepEqual(new Set(pitches(entry).map((n) => n % 12)), expectedClasses)
        for (const n of pitches(entry)) assert.ok(n >= range.low && n <= range.high)
        for (const key of ['timeSec', 'durationSec', 'cursorSec', 'tick', 'measure']) {
          assert.equal(entry[key], original[i][key])
        }
        gate.reset()
        // The lit/played pitches are also the exact pitches consumed by the gate.
        for (const note of entry.notes) gate.press(note, entry.notes, null, false, i)
        assert.equal(gate.check(entry.notes).complete, true, `stalled at step ${i + 1}`)
      }
      assert.deepEqual(original, snapshot)
      assert.deepEqual(fitted, fitTimelineToRange(original, range))
      if (name === 'Fur_Elise_easy') {
        assert.equal(noteNameToMidi(original.at(-1).notes[0]), 33)
        assert.ok(pitches(fitted.timeline.at(-1)).every((n) => n >= range.low))
      }
    })
  }
}

test('all 128 MIDI pitches can be fitted without changing pitch class', () => {
  const source = Array.from({ length: 128 }, (_, n) => moment([n], n))
  for (const range of [{ low: 0, high: 23 }, { low: 48, high: 95 }, { low: 116, high: 127 }]) {
    const fitted = fitTimelineToRange(source, range)
    assert.equal(fitted.error, null)
    fitted.timeline.forEach((entry, n) => {
      const target = pitches(entry)[0]
      assert.equal(target % 12, n % 12)
      assert.ok(target >= range.low && target <= range.high)
    })
  }
})

console.log(`${passed} keyboard-fit checks passed`)
