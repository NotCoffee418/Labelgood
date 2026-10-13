use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri_plugin_window_state::StateFlags;

mod pdf;
mod print_schema;

// Printing and font listing differ per platform; both expose the same functions
#[cfg(not(windows))]
mod cups;
#[cfg(not(windows))]
use cups as platform;
#[cfg(windows)]
mod win;
#[cfg(windows)]
use win as platform;

#[derive(Debug, Deserialize)]
struct PrintOptions {
    image_data: String, // Base64 encoded PNG image, 300 DPI, in print orientation
    width_mm: f64,
    height_mm: f64,
    continuous: Option<bool>, // On a continuous roll (width across it, height its length) rather than die-cut
    printer_name: Option<String>, // If provided, send to this printer
    output_path: Option<String>,  // Otherwise, save the PDF here
    copies: Option<u32>,
    print_options: Option<HashMap<String, String>>, // Driver options, keyed as reported by printer_options
}

/// A printer driver option and its choices, as reported by the platform's print system
#[derive(Debug, Serialize, PartialEq)]
pub struct PrinterOption {
    key: String,
    label: String,
    choices: Vec<String>,
    choice_labels: Vec<String>, // Display names for `choices`, same order
    default: Option<String>,
}

/// The fonts the generic CSS families resolve to, where known
#[derive(Debug, Serialize, Default)]
pub struct DefaultFonts {
    sans_serif: Option<String>,
    serif: Option<String>,
    monospace: Option<String>,
}

/// A label to print
pub struct PrintJob<'a> {
    image: &'a pdf::RgbImage,
    width_mm: f64,
    height_mm: f64,
    #[cfg_attr(not(windows), allow(dead_code))] // CUPS gets the size alone
    continuous: bool,
    printer: &'a str,
    copies: u32,
    options: &'a HashMap<String, String>,
}

#[tauri::command]
fn list_printers() -> Result<Vec<String>, String> {
    platform::list_printers()
}

/// Lists a printer's driver options (cutting, quality, media type, ...)
#[tauri::command]
fn printer_options(printer: String) -> Result<Vec<PrinterOption>, String> {
    platform::printer_options(&printer)
}

/// Lists installed font families. If this fails the frontend uses a built-in list.
#[tauri::command]
fn list_fonts() -> Result<Vec<String>, String> {
    platform::list_fonts()
}

/// What "Sans Serif", "Serif" and "Monospace" actually render as on this system
#[tauri::command]
fn default_fonts() -> DefaultFonts {
    platform::default_fonts()
}

#[tauri::command]
async fn generate_pdf(options: PrintOptions) -> Result<String, String> {
    if !(options.width_mm > 0.0 && options.height_mm > 0.0) {
        return Err(format!(
            "Invalid label dimensions: {}x{} mm",
            options.width_mm, options.height_mm
        ));
    }

    // Decode base64 image data
    let image_data = options.image_data
        .strip_prefix("data:image/png;base64,")
        .unwrap_or(&options.image_data);
    let png_bytes = base64::engine::general_purpose::STANDARD
        .decode(image_data)
        .map_err(|e| format!("Failed to decode base64 image: {}", e))?;
    let image = pdf::decode_png(&png_bytes)?;

    if let Some(printer_name) = &options.printer_name {
        let copies = options.copies.unwrap_or(1).clamp(1, 999);
        platform::print(&PrintJob {
            image: &image,
            width_mm: options.width_mm,
            height_mm: options.height_mm,
            continuous: options.continuous.unwrap_or(false),
            printer: printer_name,
            copies,
            options: &options.print_options.unwrap_or_default(),
        })?;
        Ok(if copies > 1 {
            format!("Printed {} copies to {}", copies, printer_name)
        } else {
            format!("Printed to {}", printer_name)
        })
    } else if let Some(output_path) = &options.output_path {
        let pdf_bytes = pdf::image_pdf(&image, pdf::mm_to_pt(options.width_mm), pdf::mm_to_pt(options.height_mm));
        std::fs::write(Path::new(output_path), pdf_bytes)
            .map_err(|e| format!("Failed to save {}: {}", output_path, e))?;
        Ok(format!("Saved to {}", output_path))
    } else {
        Err("No printer or output path given".to_string())
    }
}

/// Label files: JSON written by the frontend. Only `.labelgood` files are read or
/// written, so these commands can't be used to touch anything else.
const DOCUMENT_EXTENSION: &str = "labelgood";

fn document_path(path: &str) -> Result<&Path, String> {
    let path = Path::new(path);
    let is_document = path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case(DOCUMENT_EXTENSION));
    if is_document {
        Ok(path)
    } else {
        Err(format!("Not a .{} file: {}", DOCUMENT_EXTENSION, path.display()))
    }
}

/// Saves a label file. Written to a temporary file first and then moved over the
/// target, so a failed save never leaves a half-written label behind.
#[tauri::command]
async fn save_document(path: String, contents: String) -> Result<(), String> {
    let target = document_path(&path)?;
    let mut temp = target.as_os_str().to_owned();
    temp.push(".tmp");
    std::fs::write(&temp, contents)
        .and_then(|_| std::fs::rename(&temp, target))
        .map_err(|e| {
            let _ = std::fs::remove_file(&temp);
            format!("Failed to save {}: {}", path, e)
        })
}

/// The label file the app was started with ("Open with", or double-clicking a
/// .labelgood file), as an absolute path. Given out once, so a reload doesn't reopen it.
#[tauri::command]
fn opened_file() -> Option<String> {
    static TAKEN: AtomicBool = AtomicBool::new(false);
    if TAKEN.swap(true, Ordering::SeqCst) {
        return None;
    }
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|path| path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case(DOCUMENT_EXTENSION)))
        .and_then(|path| std::path::absolute(path).ok())
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn open_document(path: String) -> Result<String, String> {
    std::fs::read_to_string(document_path(&path)?).map_err(|e| format!("Failed to open {}: {}", path, e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK's DMA-BUF renderer fails on some GPU/Wayland setups (notably NVIDIA),
    // leaving a gray window ("Failed to create GBM buffer"). Disable it unless the
    // user has set the variable themselves. Must run before GTK/WebKit initialise.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Reopen at the last window size (and maximised if it was); position isn't kept,
        // so the window can't come back on a monitor that's no longer there
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::MAXIMIZED)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            generate_pdf,
            list_printers,
            printer_options,
            list_fonts,
            default_fonts,
            save_document,
            open_document,
            opened_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
