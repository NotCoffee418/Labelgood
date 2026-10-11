use base64::Engine;
use serde::Deserialize;
use std::collections::BTreeSet;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Output};
use tempfile::Builder;

#[derive(Debug, Deserialize)]
struct PrintOptions {
    image_data: String, // Base64 encoded PNG image
    width_mm: f64,
    height_mm: f64,
    printer_name: Option<String>, // If provided, send to this printer
    output_path: Option<String>,  // Otherwise, save the PDF here
}

#[tauri::command]
fn list_printers() -> Result<Vec<String>, String> {
    // Use lpstat -e to list all printers (including wireless/network printers)
    let output = Command::new("lpstat")
        .arg("-e")
        .output()
        .map_err(|e| format!("Failed to execute lpstat: {}", e))?;

    if !output.status.success() {
        return Err("Failed to get printer list".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let printers: Vec<String> = stdout
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();

    Ok(printers)
}

/// Lists installed font families via fontconfig. Fails where fontconfig isn't
/// available (e.g. Windows); the frontend then falls back to a built-in list.
#[tauri::command]
fn list_fonts() -> Result<Vec<String>, String> {
    let output = Command::new("fc-list")
        .args([":", "family"])
        .output()
        .map_err(|e| format!("Failed to execute fc-list: {}", e))?;

    if !output.status.success() {
        return Err("Failed to get font list".to_string());
    }

    // Each line is a comma-separated list of names for one face; the first is the family
    let families: BTreeSet<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.split(',').next())
        .map(|family| family.trim().to_string())
        .filter(|family| !family.is_empty() && !family.starts_with('.'))
        .collect();

    let mut families: Vec<String> = families.into_iter().collect();
    families.sort_by_key(|family| family.to_lowercase());
    Ok(families)
}

/// Formats a millimetre value for CUPS, keeping up to two decimals (e.g. "62", "87.5")
fn format_mm(value: f64) -> String {
    let formatted = format!("{:.2}", value);
    formatted.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Runs ImageMagick, preferring the IMv7 `magick` binary and falling back to the
/// legacy IMv6 `convert`. The fallback is skipped on Windows, where `convert.exe`
/// is an unrelated system tool for converting FAT volumes to NTFS.
fn run_imagemagick(args: &[String]) -> std::io::Result<Output> {
    match Command::new("magick").args(args).output() {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && !cfg!(windows) => {
            Command::new("convert").args(args).output()
        }
        result => result,
    }
}

/// Converts the 300 DPI label PNG into a PDF whose page is exactly the label size.
fn write_pdf(png_path: &Path, pdf_path: &Path, width_mm: f64, height_mm: f64) -> Result<(), String> {
    // mm to points (1mm = 2.83465pt)
    let width_points = (width_mm * 2.83465).round().max(1.0) as u32;
    let height_points = (height_mm * 2.83465).round().max(1.0) as u32;

    // Read the PNG at 300 DPI and write at 72 DPI (PDF standard), so ImageMagick
    // scales the image onto a page of the given size in points
    let result = run_imagemagick(&[
        png_path.to_string_lossy().to_string(),
        "-density".into(), "300".into(),
        "-units".into(), "PixelsPerInch".into(),
        "-density".into(), "72".into(),
        "-page".into(), format!("{}x{}", width_points, height_points),
        pdf_path.to_string_lossy().to_string(),
    ]);

    match result {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => {
            let error = String::from_utf8_lossy(&output.stderr);
            Err(format!("ImageMagick conversion failed: {}", error))
        }
        Err(e) => Err(format!(
            "ImageMagick not found: {}. Please install ImageMagick:\n\
             - Fedora: sudo dnf install ImageMagick\n\
             - Ubuntu/Debian: sudo apt install imagemagick\n\
             - Arch: sudo pacman -S imagemagick", e
        )),
    }
}

/// Sends a PDF to a CUPS printer at the exact label size (not fitted to A4 etc.)
fn print_pdf(pdf_path: &Path, printer_name: &str, width_mm: f64, height_mm: f64) -> Result<(), String> {
    let page_size = format!(
        "PageSize=Custom.{}x{}mm",
        format_mm(width_mm),
        format_mm(height_mm)
    );

    let output = Command::new("lpr")
        .arg("-P").arg(printer_name)
        .arg("-o").arg(&page_size)
        .arg("-o").arg("fit-to-page=false")
        .arg(pdf_path)
        .output()
        .map_err(|e| format!("Failed to execute lpr command: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!("Failed to print: {}", String::from_utf8_lossy(&output.stderr)))
    }
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
    let image_bytes = base64::engine::general_purpose::STANDARD
        .decode(image_data)
        .map_err(|e| format!("Failed to decode base64 image: {}", e))?;

    let mut temp_png = Builder::new()
        .suffix(".png")
        .tempfile()
        .map_err(|e| format!("Failed to create temp PNG file: {}", e))?;
    temp_png
        .write_all(&image_bytes)
        .and_then(|_| temp_png.flush())
        .map_err(|e| format!("Failed to write PNG file: {}", e))?;

    if let Some(printer_name) = &options.printer_name {
        // lpr hands the file to CUPS before returning, so a temp PDF is enough
        let temp_pdf = Builder::new()
            .suffix(".pdf")
            .tempfile()
            .map_err(|e| format!("Failed to create temp PDF file: {}", e))?;
        write_pdf(temp_png.path(), temp_pdf.path(), options.width_mm, options.height_mm)?;
        print_pdf(temp_pdf.path(), printer_name, options.width_mm, options.height_mm)?;
        Ok(format!("Printed to {}", printer_name))
    } else if let Some(output_path) = &options.output_path {
        write_pdf(temp_png.path(), Path::new(output_path), options.width_mm, options.height_mm)?;
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
        .invoke_handler(tauri::generate_handler![generate_pdf, list_printers, list_fonts])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
