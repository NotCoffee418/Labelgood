use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

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
        .invoke_handler(tauri::generate_handler![generate_pdf, list_printers, printer_options, list_fonts, default_fonts])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
