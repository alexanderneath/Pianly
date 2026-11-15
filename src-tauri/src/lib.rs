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
    connection: Mutex<Option<MidiInputConnection<()>>>,
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
    ports
        .iter()
        .enumerate()
        .filter_map(|(i, port)| {
            midi_in
                .port_name(port)
                .ok()
                .map(|name| MidiDevice { id: i, name })
        })
        .collect()
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
    // Close existing connection
    {
        let mut conn = state.connection.lock().unwrap();
        if let Some(c) = conn.take() {
            drop(c);
        }
    }

    let midi_in = MidiInput::new("pianly-input")
        .map_err(|e| format!("Failed to create MIDI input: {}", e))?;

    let ports = midi_in.ports();
    let port = ports
        .get(device_id)
        .ok_or_else(|| format!("Device index {} not found", device_id))?;

    let port_name = midi_in
        .port_name(port)
        .unwrap_or_else(|_| "Unknown".to_string());

    let app_handle = app.clone();
    let connection = midi_in
        .connect(
            port,
            "pianly-read",
            move |_timestamp, message, _| {
                if message.len() >= 3 {
                    let status = message[0] & 0xf0;
                    if status == 0x90 && message[2] > 0 {
                        // noteOn
                        let note = midi_number_to_note(message[1]);
                        let _ = app_handle.emit("midi-note", MidiNoteEvent { note });
                    } else if status == 0x80 || (status == 0x90 && message[2] == 0) {
                        // noteOff
                        let note = midi_number_to_note(message[1]);
                        let _ = app_handle.emit("midi-note-off", MidiNoteEvent { note });
                    }
                }
            },
            (),
        )
        .map_err(|e| format!("Failed to connect to {}: {}", port_name, e))?;

    let mut conn = state.connection.lock().unwrap();
    *conn = Some(connection);

    log::info!("[MIDI] Connected: {}", port_name);
    Ok(port_name)
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
    let mut conn = state.connection.lock().unwrap();
    if let Some(c) = conn.take() {
        drop(c);
        log::info!("[MIDI] Disconnected");
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
            let name = output.port_name(&port).unwrap_or_default().to_lowercase();
            if !name.contains("lumi") && !name.contains("piano m") {
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
