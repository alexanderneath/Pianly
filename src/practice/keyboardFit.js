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

/**
 * Make an octave-adapted practice arrangement. The original score and timing are
 * retained; .notes is the single set used for cues, scoring, hints and listening.
 * A common octave shift preserves the entire arrangement whenever it fits.
 */
export function fitTimelineToRange(timeline, range) {
  const unchanged = { timeline, adjustedNotes: 0, mergedNotes: 0, octaveShift: 0, error: null }
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
  const octaveShift = minOctave <= maxOctave ? Math.min(maxOctave, Math.max(minOctave, 0)) : null
  let adjustedNotes = 0
  let mergedNotes = 0
  const fitted = timeline.map((entry, index) => {
    const pitches = [...new Set(parsed[index])].sort((a, b) => a - b)
    const mapped = octaveShift === null
      ? fitChord(pitches, range)
      : pitches.map((pitch) => pitch + octaveShift * 12)
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
    return { ...entry, notes, writtenNotes: entry.notes, octaveAdjusted: true, mergedNotes: merged }
  })
  return { timeline: fitted, adjustedNotes, mergedNotes, octaveShift, error: null }
}
