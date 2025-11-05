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
    // The PNG comes from frontend at 300 DPI with pixel dimensions calculated as:
    //   targetWidthPx = labelWidthMm * (300 / 25.4)
    //   targetHeightPx = labelHeightMm * (300 / 25.4)
    // 
    // For a 62mm x 100mm label at 300 DPI:
    //   - PNG is 732x1181 pixels
    //   - PDF should be 62mm x 100mm (176x283 points)
    //   - When printed at actual size, should be 62mm x 100mm
    
    // Calculate page size in points
    let width_mm_str = format!("{}mm", options.width_mm);
    let height_mm_str = format!("{}mm", options.height_mm);
    let page_size_mm = format!("{}x{}", width_mm_str, height_mm_str);

    println!("Creating PDF with page size: {}", page_size_mm);

    // Convert PNG to PDF with exact page size in millimeters
    // ImageMagick will handle the scaling from 300 DPI to the target size
    let result = Command::new("convert")
        .arg(&png_path)
        .arg("-density").arg("300") // Input PNG is at 300 DPI
        .arg("-units").arg("PixelsPerInch")
        .arg("-background").arg("white")
        .arg("-alpha").arg("remove") // Remove transparency
        .arg("-page").arg(&page_size_mm) // Set PDF page size in mm
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

                // Print using lpr with proper page size settings
                // For CUPS, specify the media size in millimeters or points
                let width_mm = options.width_mm;
                let height_mm = options.height_mm;
                
                // Convert to points for CUPS (some printers need points)
                let width_points = options.width_mm * 2.83465;
                let height_points = options.height_mm * 2.83465;
                let width_pt = width_points as u32;
                let height_pt = height_points as u32;
                
                // Try media size in points format
                let media_size = format!("media=Custom.{}x{}pt", width_pt, height_pt);

                println!("Printing to: {}", printer_name);
                println!("PDF path: {}", pdf_path_str);
                println!("Label dimensions: {}mm x {}mm", width_mm, height_mm);
                println!("Points: {}pt x {}pt", width_pt, height_pt);
                println!("Media size option: {}", media_size);

                let print_result = Command::new("lpr")
                    .arg("-P").arg(printer_name)
                    .arg("-o").arg(&media_size)
                    .arg("-o").arg("fit-to-page=false")
                    .arg("-o").arg("scaling=100")
                    .arg("-o").arg("number-up=1")
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
