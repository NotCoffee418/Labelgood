use serde::{Deserialize, Serialize};
use std::fs;
use std::process::Command;
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

#[tauri::command]
async fn generate_pdf(options: PrintOptions) -> Result<String, String> {
    // Decode base64 image data
    let image_data = options.image_data
        .strip_prefix("data:image/png;base64,")
        .unwrap_or(&options.image_data);

    let image_bytes = base64::decode(image_data)
        .map_err(|e| format!("Failed to decode base64 image: {}", e))?;

    // Create temporary PNG file
    let temp_png = Builder::new()
        .suffix(".png")
        .tempfile()
        .map_err(|e| format!("Failed to create temp PNG file: {}", e))?;
    let png_path = temp_png.path().to_string_lossy().to_string();

    fs::write(&png_path, &image_bytes)
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
    // The PNG is at 300 DPI, so we need to tell ImageMagick that
    // Then use -resize to fit it exactly to the target mm dimensions
    let width_points = options.width_mm * 2.83465; // mm to points (1mm = 2.83465pt)
    let height_points = options.height_mm * 2.83465;

    let result = Command::new("convert")
        .arg(&png_path)
        .arg("-density").arg("300") // Match the PNG DPI
        .arg("-units").arg("PixelsPerInch")
        .arg("-resize").arg(format!("{}x{}!", width_points as u32, height_points as u32)) // Force exact size
        .arg("-page").arg(format!("{}x{}", width_points as u32, height_points as u32))
        .arg(&pdf_path_str)
        .output();

    match result {
        Ok(output) if output.status.success() => {
            println!("PDF generated successfully at: {}", pdf_path_str);

            // If printer_name is provided, send to printer
            if let Some(printer_name) = &options.printer_name {
                // Verify PDF exists
                if !std::path::Path::new(&pdf_path_str).exists() {
                    return Err(format!("PDF file does not exist at: {}", pdf_path_str));
                }

                // Format for Brother label printer: Custom.WIDTHxHEIGHT in tenths of mm
                // Example: 100mm x 50mm = Custom.1000x500
                let width_tenths = (options.width_mm * 10.0) as u32;
                let height_tenths = (options.height_mm * 10.0) as u32;
                let page_size = format!("PageSize=Custom.{}x{}", width_tenths, height_tenths);

                println!("Printing to: {}", printer_name);
                println!("PDF path: {}", pdf_path_str);
                println!("Page size: {}", page_size);

                let print_result = Command::new("lpr")
                    .arg("-P").arg(printer_name)
                    .arg("-o").arg(&page_size)
                    .arg("-o").arg("fit-to-page=false")
                    .arg("-o").arg("scaling=100")
                    .arg("-o").arg("print-scaling=none")
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
            return Err(format!("ImageMagick convert failed: {}. Make sure ImageMagick is installed.", error));
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![greet, generate_pdf, list_printers])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
