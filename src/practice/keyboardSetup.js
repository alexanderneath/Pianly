import { isValidKeyboardRange } from './keyboardFit.js'

const STORAGE_KEY = 'nf-keyboard-range-v1'
const isLumi = (name) => /lumi|piano m/i.test(name)

// Port numbers can change on reconnect. Names and the number of ROLI ports
// identify the setup; adding/removing a keyboard invalidates the saved range.
export function keyboardSetupKey(devices, selectedId) {
  const selected = devices.find((device) => device.id === selectedId)
  if (!selected) return null
  const ports = isLumi(selected.name)
    ? devices.filter((device) => device.id !== '65535' && isLumi(device.name)).map((device) => device.name).sort()
    : [selected.name]
  return JSON.stringify({ input: selected.name, ports })
}

export function loadKeyboardRange(storage, key) {
  if (!key) return null
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY))
    return saved?.key === key && isValidKeyboardRange(saved.range)
      ? { low: saved.range.low, high: saved.range.high } : null
  } catch { return null }
}

export function saveKeyboardRange(storage, key, range) {
  if (!key || !isValidKeyboardRange(range)) return false
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ key, range: { low: range.low, high: range.high } }))
    return true
  } catch { return false }
}

export function needsKeyboardCalibration({ inputMode, fitKeyboard, range, calibrating = false }) {
  return inputMode === 'midi' && fitKeyboard && (calibrating || !isValidKeyboardRange(range))
}
