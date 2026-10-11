use base64::Engine;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Command, Output};
use tempfile::Builder;

#[derive(Debug, Serialize, Deserialize)]
struct PrintOptions {
    image_data: String, // Base64 encoded PNG image
    width_mm: f64,
    height_mm: f64,
    printer_name: Option<String>, // If provided, send to printer instead of opening PDF
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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

#[tauri::command]
async fn generate_pdf(options: PrintOptions) -> Result<String, String> {
    // Decode base64 image data
    let image_data = options.image_data
        .strip_prefix("data:image/png;base64,")
        .unwrap_or(&options.image_data);

    if !(options.width_mm > 0.0 && options.height_mm > 0.0) {
        return Err(format!(
            "Invalid label dimensions: {}x{} mm",
            options.width_mm, options.height_mm
        ));
    }

    let image_bytes = base64::engine::general_purpose::STANDARD
        .decode(image_data)
        .map_err(|e| format!("Failed to decode base64 image: {}", e))?;

    // Create temporary PNG file
    let mut temp_png = Builder::new()
        .suffix(".png")
        .tempfile()
        .map_err(|e| format!("Failed to create temp PNG file: {}", e))?;
    let png_path = temp_png.path().to_string_lossy().to_string();

    temp_png
        .write_all(&image_bytes)
        .and_then(|_| temp_png.flush())
        .map_err(|e| format!("Failed to write PNG file: {}", e))?;

    // Create persistent PDF file in temp directory
    let temp_dir = std::env::temp_dir();
    let pdf_filename = format!("label_{}.pdf", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis());
    let pdf_path = temp_dir.join(pdf_filename);
    let pdf_path_str = pdf_path.to_string_lossy().to_string();

    println!("Generated PDF path: {}", pdf_path_str);

    // Use ImageMagick to convert PNG to PDF with exact dimensions
    // The PNG comes from frontend at 300 DPI with pixel dimensions calculated as:
    //   targetWidthPx = labelWidthMm * (300 / 25.4)
    //   targetHeightPx = labelHeightMm * (300 / 25.4)
    // 
    // Critical: We need to preserve the 300 DPI throughout the conversion
    let width_points = options.width_mm * 2.83465; // mm to points (1mm = 2.83465pt)
    let height_points = options.height_mm * 2.83465;
    
    let width_points = width_points.round().max(1.0) as u32;
    let height_points = height_points.round().max(1.0) as u32;

    println!("Creating PDF: {}x{} mm ({}x{} points)", 
             options.width_mm, options.height_mm,
             width_points, height_points);

    // Convert PNG to PDF preserving dimensions:
    // The key is to read at 300 DPI and write at 72 DPI (PDF standard)
    // This causes ImageMagick to scale appropriately
    let result = run_imagemagick(&[
        png_path.clone(),
        "-density".into(), "300".into(), // Input PNG is at 300 DPI
        "-units".into(), "PixelsPerInch".into(),
        "-density".into(), "72".into(), // Output PDF at 72 DPI (standard)
        "-page".into(), format!("{}x{}", width_points, height_points), // Set PDF page size in points
        pdf_path_str.clone(),
    ]);

    match result {
        Ok(output) if output.status.success() => {
            println!("PDF generated successfully at: {}", pdf_path_str);

            // If printer_name is provided, send to printer
            if let Some(printer_name) = &options.printer_name {
                // Verify PDF exists
                if !std::path::Path::new(&pdf_path_str).exists() {
                    return Err(format!("PDF file does not exist at: {}", pdf_path_str));
                }

                // Print with lpr using the exact page dimensions from the PDF
                // The PDF already has the correct page size, but we need to tell
                // CUPS/lpr to use that size and not fit it to A4 or other default sizes
                
                // Calculate dimensions in different units for CUPS compatibility
                let width_mm = format_mm(options.width_mm);
                let height_mm = format_mm(options.height_mm);
                
                println!("Printing to: {}", printer_name);
                println!("PDF path: {}", pdf_path_str);
                println!("Label dimensions: {}mm x {}mm", width_mm, height_mm);

                // Use PageSize with dimensions in mm - this is more universally supported
                let page_size = format!("PageSize=Custom.{}x{}mm", width_mm, height_mm);
                
                let print_result = Command::new("lpr")
                    .arg("-P").arg(printer_name)
                    .arg("-o").arg(&page_size)
                    .arg("-o").arg("fit-to-page=false")
                    .arg(&pdf_path_str)
                    .output();

                match print_result {
                    Ok(print_output) if print_output.status.success() => {
                        println!("Sent to printer: {}", printer_name);
                        return Ok(format!("Printed to {}", printer_name));
                    }
                    Ok(print_output) => {
                        let stdout = String::from_utf8_lossy(&print_output.stdout);
                        let stderr = String::from_utf8_lossy(&print_output.stderr);
                        eprintln!("lpr stdout: {}", stdout);
                        eprintln!("lpr stderr: {}", stderr);
                        return Err(format!("Failed to print: {}", stderr));
                    }
                    Err(e) => {
                        return Err(format!("Failed to execute lpr command: {}", e));
                    }
                }
            } else {
                // Open the PDF with the system default application (cross-platform)
                opener::open(&pdf_path_str)
                    .map_err(|e| format!("Failed to open PDF: {}", e))?;
                return Ok(pdf_path_str);
            }
        }
        Ok(output) => {
            let error = String::from_utf8_lossy(&output.stderr);
            eprintln!("ImageMagick convert failed. stderr: {}", error);
            eprintln!("ImageMagick stdout: {}", String::from_utf8_lossy(&output.stdout));
            return Err(format!("ImageMagick conversion failed: {}. Make sure ImageMagick is installed.", error));
        }
        Err(e) => {
            return Err(format!(
                "ImageMagick not found: {}. Please install ImageMagick:\n\
                 - Fedora: sudo dnf install ImageMagick\n\
                 - Ubuntu/Debian: sudo apt install imagemagick\n\
                 - Arch: sudo pacman -S imagemagick", e
            ));
        }
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![greet, generate_pdf, list_printers])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
