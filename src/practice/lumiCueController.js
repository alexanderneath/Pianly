/** Serialise light commands and re-arm a cue after a physical key release. */
export class LumiCueController {
  constructor(send, report = () => {}, timers = { setTimeout, clearTimeout }) {
    this.send = send
    this.report = report
    this.timers = timers
    this.notes = []
    this.version = 0
    this.queue = Promise.resolve()
    this.releaseTimer = null
  }

  setNotes(notes) {
    this.notes = [...new Set(notes)].sort((a, b) => a - b)
    if (!this.notes.length) this.cancelRelease()
    const current = [...this.notes]
    const version = ++this.version
    this.queue = this.queue.then(async () => {
      if (version !== this.version) return
      try {
        const count = await this.send(current)
        if (version === this.version) this.report(current, count, null)
      } catch (error) {
        if (version === this.version) this.report(current, 0, error)
      }
    })
    return this.queue
  }

  keyReleased() {
    if (!this.notes.length) return
    this.cancelRelease()
    // The keyboard can clear its own LED on release after the next step was
    // cued. Re-send the latest pending notes after that local release settles.
    this.releaseTimer = this.timers.setTimeout(() => {
      this.releaseTimer = null
      if (this.notes.length) this.setNotes(this.notes)
    }, 30)
  }

  cancelRelease() {
    if (this.releaseTimer !== null) this.timers.clearTimeout(this.releaseTimer)
    this.releaseTimer = null
  }

  clear() {
    this.cancelRelease()
    return this.setNotes([])
  }

  settled() { return this.queue }
}
