use serde::{Deserialize, Serialize};
use std::fs;
use std::process::Command;
use tempfile::Builder;

#[derive(Debug, Serialize, Deserialize)]
struct PrintOptions {
    html: String,
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
    // Create temporary HTML file with .html extension
    let temp_html = Builder::new()
        .suffix(".html")
        .tempfile()
        .map_err(|e| format!("Failed to create temp HTML file: {}", e))?;
    let html_path = temp_html.path().to_string_lossy().to_string();

    fs::write(&html_path, &options.html)
        .map_err(|e| format!("Failed to write HTML file: {}", e))?;

    // Create temporary PDF file with .pdf extension
    // Use tempfile_in with persist to prevent auto-deletion
    let temp_dir = std::env::temp_dir();
    let pdf_filename = format!("label_{}.pdf", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis());
    let pdf_path = temp_dir.join(pdf_filename);
    let pdf_path_str = pdf_path.to_string_lossy().to_string();

    println!("Generated PDF path: {}", pdf_path_str);

    // Try wkhtmltopdf first (most common)
    let result = Command::new("wkhtmltopdf")
        .arg("--page-width").arg(format!("{}mm", options.width_mm))
        .arg("--page-height").arg(format!("{}mm", options.height_mm))
        .arg("--margin-top").arg("0")
        .arg("--margin-bottom").arg("0")
        .arg("--margin-left").arg("0")
        .arg("--margin-right").arg("0")
        .arg("--disable-smart-shrinking")
        .arg(&html_path)
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
            eprintln!("wkhtmltopdf failed. stderr: {}", error);
            eprintln!("wkhtmltopdf stdout: {}", String::from_utf8_lossy(&output.stdout));
            return Err(format!("wkhtmltopdf failed: {}", error));
        }
        Err(e) => {
            eprintln!("wkhtmltopdf not found: {}", e);
            // wkhtmltopdf not found, try weasyprint
        }
    }

    // Try weasyprint as fallback
    let result = Command::new("weasyprint")
        .arg(&html_path)
        .arg(&pdf_path_str)
        .arg("--page-size").arg(format!("{}mm {}mm", options.width_mm, options.height_mm))
        .output();

    match result {
        Ok(output) if output.status.success() => {
            println!("PDF generated successfully with weasyprint at: {}", pdf_path_str);

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
            return Err(format!("weasyprint failed: {}", error));
        }
        Err(_) => {
            return Err(
                "No PDF generator found. Please install wkhtmltopdf or weasyprint:\n\
                 - Fedora: sudo dnf install wkhtmltopdf\n\
                 - Ubuntu/Debian: sudo apt install wkhtmltopdf\n\
                 - Arch: sudo pacman -S wkhtmltopdf".to_string()
            );
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
