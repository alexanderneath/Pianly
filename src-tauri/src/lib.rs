#[cfg(not(any(target_os = "android", target_os = "ios")))]
use midir::{MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use serde::Serialize;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::sync::Mutex;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::Emitter;
use tauri::State;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Default)]
struct MidiState {
    connection: Mutex<Vec<MidiInputConnection<()>>>,
    lumi: Mutex<LumiOutputs>,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Default)]
struct MidiState;

#[derive(Serialize, Clone)]
struct MidiDevice {
    id: usize,
    name: String,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod midi_impl {
    use super::*;

    #[derive(Serialize, Clone)]
    pub(super) struct MidiNoteEvent {
        pub(super) note: String,
    }

    const NOTE_NAMES: [&str; 12] = [
        "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
    ];

    pub(super) fn midi_number_to_note(num: u8) -> String {
        let name = NOTE_NAMES[(num % 12) as usize];
        let octave = (num as i32 / 12) - 2;
        format!("{}{}", name, octave)
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use midi_impl::*;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
const BOTH_LUMIS: usize = 65535;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn is_lumi_port(name: &str) -> bool {
    let name = name.to_lowercase();
    name.contains("lumi") || name.contains("piano m")
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
fn get_midi_inputs() -> Vec<MidiDevice> {
    let midi_in = match MidiInput::new("pianly-list") {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[MIDI] Failed to create MidiInput: {}", e);
            return vec![];
        }
    };

    let ports = midi_in.ports();
    let mut devices: Vec<MidiDevice> = ports
        .iter()
        .enumerate()
        .filter_map(|(i, port)| {
            midi_in
                .port_name(port)
                .ok()
                .map(|name| MidiDevice { id: i, name })
        })
        .collect();
    if devices.iter().filter(|device| is_lumi_port(&device.name)).count() > 1 {
        devices.insert(0, MidiDevice { id: BOTH_LUMIS, name: "Both LUMI / Piano M keyboards".into() });
    }
    devices
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
fn get_midi_inputs() -> Vec<MidiDevice> {
    vec![]
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
fn connect_midi(
    device_id: usize,
    app: tauri::AppHandle,
    state: State<'_, MidiState>,
) -> Result<String, String> {
    use std::collections::HashSet;
    use std::sync::Arc;

    let mut active = state.connection.lock().map_err(|error| error.to_string())?;
    active.clear();
    let midi_in = MidiInput::new("pianly-input").map_err(|error| error.to_string())?;
    let ports = midi_in.ports();
    let selected: Vec<_> = ports.iter().enumerate().filter_map(|(index, port)| {
        let name = midi_in.port_name(port).unwrap_or_else(|_| "Unknown".into());
        (index == device_id || (device_id == BOTH_LUMIS && is_lumi_port(&name)))
            .then_some((index, port, name))
    }).collect();
    if selected.is_empty() {
        return Err(format!("MIDI input {} is unavailable", device_id));
    }

    let held = Arc::new(Mutex::new(HashSet::new()));
    let mut connections = Vec::new();
    let mut names = Vec::new();
    for (index, port, name) in selected {
        let input = MidiInput::new("pianly-input").map_err(|error| error.to_string())?;
        let app = app.clone();
        let held = held.clone();
        let connection = input.connect(port, "pianly-read", move |_, message, _| {
            if message.len() < 3 {
                return;
            }
            let status = message[0] & 0xf0;
            if status != 0x80 && status != 0x90 {
                return;
            }
            let pitch = message[1];
            let key = (index, message[0] & 0x0f, pitch);
            let Ok(mut held) = held.lock() else { return };
            let note = midi_number_to_note(pitch);
            if status == 0x90 && message[2] > 0 {
                held.insert(key);
                let _ = app.emit("midi-note", MidiNoteEvent { note });
            } else {
                held.remove(&key);
                if !held.iter().any(|&(_, _, other)| other == pitch) {
                    let _ = app.emit("midi-note-off", MidiNoteEvent { note });
                }
            }
        }, ()).map_err(|error| format!("Failed to connect to {}: {}", name, error))?;
        connections.push(connection);
        names.push(name);
    }
    *active = connections;
    Ok(names.join(" + "))
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
fn connect_midi(
    _device_id: usize,
    _app: tauri::AppHandle,
    _state: State<'_, MidiState>,
) -> Result<String, String> {
    Err("MIDI input is not supported on this platform".into())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
fn disconnect_midi(state: State<'_, MidiState>) {
    if let Ok(mut connections) = state.connection.lock() {
        connections.clear();
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
fn disconnect_midi(_state: State<'_, MidiState>) {}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Default)]
struct LumiOutputs {
    ports: Vec<MidiOutputConnection>,
    notes: Vec<u8>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl LumiOutputs {
    fn clear(&mut self) {
        for port in &mut self.ports {
            for &note in &self.notes {
                let _ = port.send(&[0x80, note, 0]);
            }
        }
        self.notes.clear();
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl Drop for LumiOutputs {
    fn drop(&mut self) {
        self.clear();
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
fn set_lumi_cue(mut notes: Vec<u8>, state: State<'_, MidiState>) -> Result<usize, String> {
    if notes.iter().any(|&note| note > 127) {
        return Err("Invalid MIDI note".into());
    }
    notes.sort_unstable();
    notes.dedup();
    let mut lumi = state.lumi.lock().map_err(|e| e.to_string())?;
    lumi.clear();
    if notes.is_empty() {
        return Ok(0);
    }

    if lumi.ports.is_empty() {
        let output = MidiOutput::new("Pianly LUMI").map_err(|e| e.to_string())?;
        for port in output.ports() {
            let name = output.port_name(&port).unwrap_or_default();
            if !is_lumi_port(&name) {
                continue;
            }
            let output = MidiOutput::new("Pianly LUMI").map_err(|e| e.to_string())?;
            if let Ok(connection) = output.connect(&port, "Pianly cue") {
                lumi.ports.push(connection);
            }
        }
    }
    if lumi.ports.is_empty() {
        return Err("No accessible LUMI or Piano M MIDI output. Close other MIDI apps and check the USB connection.".into());
    }
    lumi.notes = notes.clone();
    for port in &mut lumi.ports {
        for &note in &notes {
            if let Err(error) = port.send(&[0x90, note, 90]) {
                let message = error.to_string();
                lumi.clear();
                lumi.ports.clear();
                return Err(message);
            }
        }
    }
    Ok(lumi.ports.len())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
fn set_lumi_cue(_notes: Vec<u8>) -> Result<usize, String> {
    Err("LUMI MIDI output is available on desktop only".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(MidiState::default())
        .invoke_handler(tauri::generate_handler![
            get_midi_inputs,
            connect_midi,
            disconnect_midi,
            set_lumi_cue,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
