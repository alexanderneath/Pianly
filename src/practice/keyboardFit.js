import { midiToNoteName, noteNameToMidi } from '../utils/noteConversion.js'

export function isValidKeyboardRange(range) {
  return !!range && Number.isInteger(range.low) && Number.isInteger(range.high) &&
    range.low >= 0 && range.high <= 127 && range.high - range.low >= 11
}

function candidates(pitch, range) {
  const first = pitch + 12 * Math.ceil((range.low - pitch) / 12)
  const result = []
  for (let note = first; note <= range.high; note += 12) result.push(note)
  return result
}

// Keep bass below melody and octave-doubled notes on separate keys if possible.
// Dynamic programming avoids a greedy choice forcing a later chord note out of range.
function fitChord(pitches, range) {
  let states = [{ last: -1, cost: 0, notes: [] }]
  for (const pitch of pitches) {
    const next = []
    for (const candidate of candidates(pitch, range)) {
      let best = null
      for (const state of states) {
        if (state.last >= candidate) continue
        const cost = state.cost + Math.abs(candidate - pitch)
        if (!best || cost < best.cost) {
          best = { last: candidate, cost, notes: [...state.notes, candidate] }
        }
      }
      if (best) next.push(best)
    }
    states = next
    if (!states.length) break
  }
  if (states.length) return states.reduce((a, b) => a.cost <= b.cost ? a : b).notes

  // Some chords cannot preserve every voice on a small keyboard. Reserve written
  // pitches already in range, then use unoccupied octave equivalents. Only merge
  // octave doubles when no separate key of that pitch class exists.
  const used = new Set()
  const mapped = new Map()
  for (const pitch of pitches) {
    if (pitch >= range.low && pitch <= range.high) {
      mapped.set(pitch, pitch)
      used.add(pitch)
    }
  }
  for (const pitch of pitches) {
    if (mapped.has(pitch)) continue
    const choices = candidates(pitch, range).sort((a, b) =>
      Math.abs(a - pitch) - Math.abs(b - pitch) || a - b)
    const chosen = choices.find((note) => !used.has(note)) ?? choices[0]
    mapped.set(pitch, chosen)
    used.add(chosen)
  }
  return pitches.map((pitch) => mapped.get(pitch))
}

// Prefer one keyboard offset for the whole piece, even when occasional notes
// exceed its range. Choosing independently from the original pitch at every
// step collapses low bass and higher melody onto the same physical keys.
function chooseKeyboardOffset(parsed, range) {
  let best = null
  for (let octaves = -10; octaves <= 10; octaves++) {
    let outside = 0, distance = 0
    for (const pitches of parsed) {
      for (const pitch of pitches) {
        const shifted = pitch + octaves * 12
        const excess = Math.max(range.low - shifted, shifted - range.high, 0)
        if (excess) outside++
        distance += excess
      }
    }
    const cost = [outside, distance, Math.abs(octaves)]
    if (!best || cost.some((v, i) => v < best.cost[i] && cost.slice(0, i).every((x, j) => x === best.cost[j]))) {
      best = { octaves, cost }
    }
  }
  return best.octaves
}

/**
 * Map physical key positions without transposing the music. .notes is used
 * only for lights/recognition; writtenNotes and keyMap retain the exact score
 * pitches for sound. Prefer a consistent whole-piece offset and intact chord
 * intervals. Only chords too wide for the keys need individual repositioning.
 */
export function fitTimelineToRange(timeline, range) {
  const unchanged = { timeline, adjustedNotes: 0, mergedNotes: 0, octaveShift: 0, repositionedSteps: 0, reshapedChords: 0, error: null }
  if (!range) return unchanged
  if (!isValidKeyboardRange(range)) {
    return { ...unchanged, error: 'Check a continuous range of at least 12 keys to fit every note name.' }
  }
  const parsed = timeline.map((entry) => entry.notes.map((name) =>
    typeof name === 'string' ? noteNameToMidi(name) : null))
  if (parsed.some((notes) => notes.some((pitch) => !Number.isInteger(pitch) || pitch < 0 || pitch > 127))) {
    return { ...unchanged, error: 'This score contains an unsupported note. It cannot be fitted safely.' }
  }
  const allPitches = parsed.flat()
  if (!allPitches.length) return unchanged
  let low = 127
  let high = 0
  for (const pitch of allPitches) { low = Math.min(low, pitch); high = Math.max(high, pitch) }
  const minOctave = Math.ceil((range.low - low) / 12)
  const maxOctave = Math.floor((range.high - high) / 12)
  const octaveShift = minOctave <= maxOctave
    ? Math.min(maxOctave, Math.max(minOctave, 0)) : chooseKeyboardOffset(parsed, range)
  let adjustedNotes = 0
  let mergedNotes = 0
  let repositionedSteps = 0
  let reshapedChords = 0
  const fitted = timeline.map((entry, index) => {
    const pitches = [...new Set(parsed[index])].sort((a, b) => a - b)
    if (!pitches.length) return entry
    const minShift = Math.ceil((range.low - pitches[0]) / 12)
    const maxShift = Math.floor((range.high - pitches.at(-1)) / 12)
    const stepShift = minShift <= maxShift ? Math.min(maxShift, Math.max(minShift, octaveShift)) : null
    const mapped = stepShift === null
      ? fitChord(pitches.map((pitch) => pitch + octaveShift * 12), range)
      : pitches.map((pitch) => pitch + stepShift * 12)
    if (stepShift !== octaveShift) repositionedSteps++
    if (stepShift === null) reshapedChords++
    const pitchMap = new Map(pitches.map((pitch, i) => [pitch, mapped[i]]))
    const shifted = parsed[index].filter((pitch) => pitchMap.get(pitch) !== pitch).length
    const merged = pitches.length - new Set(mapped).size
    adjustedNotes += shifted
    mergedNotes += merged
    if (!shifted && !merged) return entry
    const seen = new Set()
    const notes = []
    for (let i = 0; i < entry.notes.length; i++) {
      const target = pitchMap.get(parsed[index][i])
      if (seen.has(target)) continue
      seen.add(target)
      notes.push(target === parsed[index][i] ? entry.notes[i] : midiToNoteName(target))
    }
    const keyMap = notes.map((key) => ({
      key,
      written: entry.notes.filter((_, i) => pitchMap.get(parsed[index][i]) === noteNameToMidi(key)),
    }))
    return { ...entry, notes, writtenNotes: entry.notes, keyMap, octaveAdjusted: true, mergedNotes: merged }
  })
  return { timeline: fitted, adjustedNotes, mergedNotes, octaveShift, repositionedSteps, reshapedChords, error: null }
}

/** Musical pitches never come from the physical cue keys. */
export function scoreNotes(entry) { return entry?.writtenNotes ?? entry?.notes ?? [] }

/** Resolve a physical key before advancing the practice gate. Early notes use
 * the next step's mapping; a wrong key uses the whole-piece keyboard offset. */
export function notesForKey(key, current, next, { waiting = false, octaveShift = 0 } = {}) {
  const pitch = noteNameToMidi(key)
  const match = (entry) => {
    const item = entry?.keyMap?.find((item) => noteNameToMidi(item.key) === pitch)
    if (item) return item.written
    const note = entry?.notes.find((name) => noteNameToMidi(name) === pitch)
    return note ? [note] : null
  }
  const matched = waiting ? match(next) : match(current) ?? match(next)
  if (matched) return matched
  const unshifted = pitch - octaveShift * 12
  return [Number.isInteger(pitch) && unshifted >= 0 && unshifted <= 127 ? midiToNoteName(unshifted) : key]
}
