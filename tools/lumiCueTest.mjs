import assert from 'node:assert/strict'
import { LumiCueController } from '../src/practice/lumiCueController.js'
import { StepGate } from '../src/practice/stepGate.js'
import { midiToNoteName, noteNameToMidi } from '../src/utils/noteConversion.js'
import { keyboardSetupKey, loadKeyboardRange, saveKeyboardRange, needsKeyboardCalibration } from '../src/practice/keyboardSetup.js'

function fakeClock() {
  let id = 0
  const tasks = new Map()
  return {
    setTimeout(fn, delay) { assert.equal(delay, 30); tasks.set(++id, fn); return id },
    clearTimeout(key) { tasks.delete(key) },
    tick() { const pending = [...tasks.values()]; tasks.clear(); pending.forEach((fn) => fn()) },
    get size() { return tasks.size },
  }
}
const exactMatch = (a, b) => noteNameToMidi(a) === noteNameToMidi(b)
const asNotes = (...pitches) => pitches.map(midiToNoteName)
let passed = 0
async function test(name, run) { await run(); passed++; console.log('ok - ' + name) }

await test('a genuinely repeated Ab cue re-lights after releasing the previous chord', async () => {
  const clock = fakeClock()
  const lights = new Set()
  const controller = new LumiCueController(async (notes) => {
    lights.clear(); notes.forEach((note) => lights.add(note)); return 2
  }, undefined, clock)
  const gate = new StepGate(exactMatch)
  // Physical repeated-note sequence. Maple's written higher Ab must no longer
  // be folded here; its real pitch/position is covered by pitchPreservationTest.
  const timeline = [[63, 75], [68, 80], [68], [75, 80, 84, 87, 99]]
    .map((notes, index) => ({ notes: asNotes(...notes), timeSec: index * 0.3 }))
  const pending = () => gate.remaining(timeline[index].notes).map(noteNameToMidi)
  let index = 0
  await controller.setNotes(pending())
  for (const note of timeline[0].notes) gate.press(note, timeline[0].notes, timeline[1].notes, false, 0)
  gate.advance(); index = 1
  await controller.setNotes(pending())
  assert.deepEqual([...lights], [68, 80])
  for (const note of timeline[1].notes) gate.press(note, timeline[1].notes, timeline[2].notes, false, 300)
  gate.advance(); index = 2
  await controller.setNotes(pending())
  assert.deepEqual([...lights], [68])
  assert.equal(gate.check(timeline[2].notes).complete, false)
  // Reproduce the keyboard's release clearing a newly-sent cue for the same key.
  lights.delete(68)
  controller.keyReleased()
  lights.delete(80)
  controller.keyReleased()
  assert.equal(lights.size, 0, 'old behaviour: no remaining light until a new score step')
  clock.tick(); await controller.settled()
  assert.deepEqual([...lights], [68], 'the repeated Ab cue must be restored')
  assert.equal(gate.press('G#3', timeline[2].notes, timeline[3].notes, false, 600), 'complete')
  await controller.setNotes(pending())
  assert.equal(lights.size, 0, 'a successful fresh press clears the cue')
})

await test('partial chords illuminate only unplayed targets; a wrong note restores them', async () => {
  const gate = new StepGate(exactMatch)
  const target = asNotes(68, 80)
  gate.press('G#3', target, null, false, 0)
  assert.deepEqual(gate.remaining(target).map(noteNameToMidi), [80])
  gate.press('C3', target, null, false, 1)
  assert.deepEqual(gate.remaining(target).map(noteNameToMidi), [68, 80])
})

await test('a late release refresh uses the latest target, never the old target', async () => {
  const clock = fakeClock(), sent = []
  const controller = new LumiCueController(async (notes) => { sent.push(notes); return 1 }, undefined, clock)
  await controller.setNotes([68])
  controller.keyReleased()
  await controller.setNotes([72])
  clock.tick(); await controller.settled()
  assert.deepEqual(sent, [[68], [72], [72]])
})

await test('stop or pause cancels a pending release refresh', async () => {
  const clock = fakeClock(), sent = []
  const controller = new LumiCueController(async (notes) => { sent.push(notes); return 1 }, undefined, clock)
  await controller.setNotes([68])
  controller.keyReleased()
  await controller.clear()
  clock.tick(); await controller.settled()
  assert.deepEqual(sent, [[68], []])
  assert.equal(clock.size, 0)
})

await test('a played chord does not re-light when its keys are released', async () => {
  const clock = fakeClock(), sent = []
  const controller = new LumiCueController(async (notes) => { sent.push(notes); return 1 }, undefined, clock)
  await controller.setNotes([68, 80])
  await controller.setNotes([])
  controller.keyReleased(); clock.tick(); await controller.settled()
  assert.deepEqual(sent, [[68, 80], []])
})

await test('an in-flight old command finishes before the newest cue; stale queued cues are skipped', async () => {
  const sent = []
  let finishFirst
  const controller = new LumiCueController(async (notes) => {
    sent.push(notes)
    if (sent.length === 1) await new Promise((resolve) => { finishFirst = resolve })
    return 1
  })
  controller.setNotes([60])
  await Promise.resolve()
  controller.setNotes([61])
  controller.clear()
  const newest = controller.setNotes([62])
  finishFirst(); await newest
  assert.deepEqual(sent, [[60], [62]])
})

await test('a failed output does not prevent the next cue from being sent', async () => {
  let attempt = 0
  const reports = []
  const controller = new LumiCueController(async () => {
    if (++attempt === 1) throw new Error('disconnected')
    return 1
  }, (notes, count, error) => reports.push({ notes, count, error: error?.message }))
  await controller.setNotes([60]); await controller.setNotes([61])
  assert.equal(reports[0].error, 'disconnected')
  assert.equal(reports[1].count, 1)
  assert.deepEqual(reports[1].notes, [61])
})

function memoryStorage() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}
const pair = [
  { id: '65535', name: 'Both LUMI / Piano M keyboards' },
  { id: '0', name: 'ROLI Piano M' }, { id: '1', name: '2 - ROLI Piano M' },
]

await test('confirmed range survives changing songs or reopening with the same setup', () => {
  const storage = memoryStorage(), key = keyboardSetupKey(pair, '65535')
  assert.equal(saveKeyboardRange(storage, key, { low: 60, high: 107 }), true)
  assert.deepEqual(loadKeyboardRange(storage, keyboardSetupKey([...pair].reverse(), '65535')), { low: 60, high: 107 })
})

await test('a changed keyboard setup cannot reuse a previous range', () => {
  const storage = memoryStorage()
  saveKeyboardRange(storage, keyboardSetupKey(pair, '65535'), { low: 60, high: 107 })
  assert.equal(loadKeyboardRange(storage, keyboardSetupKey([pair[1]], '0')), null)
})

await test('changing port indexes alone does not lose the confirmed setup', () => {
  const before = [{ id: '0', name: 'ROLI Piano M' }]
  const after = [{ id: '2', name: 'ROLI Piano M' }]
  assert.equal(keyboardSetupKey(before, '0'), keyboardSetupKey(after, '2'))
})

await test('damaged or invalid saved ranges require calibration', () => {
  const storage = memoryStorage(), key = keyboardSetupKey(pair, '65535')
  storage.setItem('nf-keyboard-range-v1', '{broken')
  assert.equal(loadKeyboardRange(storage, key), null)
  assert.equal(saveKeyboardRange(storage, key, { low: 80, high: 60 }), false)
  storage.setItem('nf-keyboard-range-v1', JSON.stringify({ key, range: { low: 60, high: 65 } }))
  assert.equal(loadKeyboardRange(storage, key), null)
})

await test('fit mode requires a confirmed valid range before practice', () => {
  const options = { inputMode: 'midi', fitKeyboard: true, range: null }
  assert.equal(needsKeyboardCalibration(options), true)
  assert.equal(needsKeyboardCalibration({ ...options, range: { low: 60, high: 107 } }), false)
  assert.equal(needsKeyboardCalibration({ ...options, range: { low: 60, high: 107 }, calibrating: true }), true)
  assert.equal(needsKeyboardCalibration({ ...options, fitKeyboard: false }), false)
  assert.equal(needsKeyboardCalibration({ ...options, inputMode: 'mic' }), false)
})

console.log(`${passed} LUMI cue and setup checks passed`)
