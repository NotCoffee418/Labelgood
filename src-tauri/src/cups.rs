//! Printing and fonts on Linux/macOS: CUPS command-line tools and fontconfig.

use crate::{pdf, DefaultFonts, PrintJob, PrinterOption};
use std::collections::BTreeSet;
use std::io::Write;
use std::process::Command;
use tempfile::Builder;

pub fn list_printers() -> Result<Vec<String>, String> {
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

/// Parses `lpoptions -l` output: one option per line, e.g.
/// `CutMedia/CutMedia: *None Auto EndOfPage EndOfJob` (the default is starred)
fn parse_lpoptions(text: &str) -> Vec<PrinterOption> {
    text.lines()
        .filter_map(|line| {
            let (name, choices) = line.split_once(':')?;
            let (key, label) = name.split_once('/').unwrap_or((name, name));
            let mut default = None;
            let choices: Vec<String> = choices
                .split_whitespace()
                .map(|choice| match choice.strip_prefix('*') {
                    Some(value) => {
                        default = Some(value.to_string());
                        value.to_string()
                    }
                    None => choice.to_string(),
                })
                .collect();
            Some(PrinterOption {
                key: key.trim().to_string(),
                label: label.trim().to_string(),
                choice_labels: choices.clone(),
                choices,
                default,
            })
        })
        .collect()
}

/// Lists a printer's driver options (cutting, quality, media type, ...)
pub fn printer_options(printer: &str) -> Result<Vec<PrinterOption>, String> {
    let output = Command::new("lpoptions")
        .arg("-p").arg(printer)
        .arg("-l")
        .output()
        .map_err(|e| format!("Failed to execute lpoptions: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(parse_lpoptions(&String::from_utf8_lossy(&output.stdout)))
}

/// CUPS option keys and values are plain words; reject anything else rather than
/// passing it through to lpr
fn is_safe_option_word(word: &str) -> bool {
    !word.is_empty() && word.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

/// Formats a millimetre value for CUPS, keeping up to two decimals (e.g. "62", "87.5")
fn format_mm(value: f64) -> String {
    let formatted = format!("{:.2}", value);
    formatted.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Sends the label to a CUPS printer as a PDF at the exact label size (not fitted to A4 etc.)
pub fn print(job: &PrintJob) -> Result<(), String> {
    // lpr hands the file to CUPS before returning, so a temp PDF is enough
    let mut temp_pdf = Builder::new()
        .suffix(".pdf")
        .tempfile()
        .map_err(|e| format!("Failed to create temp PDF file: {}", e))?;
    let pdf_bytes = pdf::image_pdf(job.image, pdf::mm_to_pt(job.width_mm), pdf::mm_to_pt(job.height_mm));
    temp_pdf
        .write_all(&pdf_bytes)
        .and_then(|_| temp_pdf.flush())
        .map_err(|e| format!("Failed to write PDF file: {}", e))?;

    let page_size = format!(
        "PageSize=Custom.{}x{}mm",
        format_mm(job.width_mm),
        format_mm(job.height_mm)
    );

    let mut command = Command::new("lpr");
    command
        .arg("-P").arg(job.printer)
        .arg("-#").arg(job.copies.clamp(1, 999).to_string())
        .arg("-o").arg(&page_size)
        .arg("-o").arg("fit-to-page=false");
    for (key, value) in job.options {
        // The page size always comes from the label
        if key == "PageSize" {
            continue;
        }
        if !is_safe_option_word(key) || !is_safe_option_word(value) {
            return Err(format!("Invalid printer option: {}={}", key, value));
        }
        command.arg("-o").arg(format!("{}={}", key, value));
    }

    let output = command
        .arg(temp_pdf.path())
        .output()
        .map_err(|e| format!("Failed to execute lpr command: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!("Failed to print: {}", String::from_utf8_lossy(&output.stderr)))
    }
}

/// Lists installed font families via fontconfig
pub fn list_fonts() -> Result<Vec<String>, String> {
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

/// The webview (WebKitGTK) resolves generic families through fontconfig, like fc-match
pub fn default_fonts() -> DefaultFonts {
    let resolve = |family: &str| -> Option<String> {
        let output = Command::new("fc-match").args(["-f", "%{family[0]}", family]).output().ok()?;
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        (output.status.success() && !name.is_empty()).then_some(name)
    };
    DefaultFonts {
        sans_serif: resolve("sans-serif"),
        serif: resolve("serif"),
        monospace: resolve("monospace"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lpoptions_output() {
        let text = "PageSize/Media Size: 17x54mm *29x90mm 62x100mm Custom.WIDTHxHEIGHT\n\
                    MediaType/Media Type: *Labels Roll\n\
                    CutMedia/CutMedia: *None Auto EndOfPage EndOfJob\n";
        let options = parse_lpoptions(text);
        assert_eq!(options.len(), 3);
        assert_eq!(options[0].label, "Media Size");
        assert_eq!(options[0].default.as_deref(), Some("29x90mm"));
        let choices: Vec<String> = vec!["None".into(), "Auto".into(), "EndOfPage".into(), "EndOfJob".into()];
        assert_eq!(
            options[2],
            PrinterOption {
                key: "CutMedia".into(),
                label: "CutMedia".into(),
                choice_labels: choices.clone(),
                choices,
                default: Some("None".into()),
            }
        );
    }

    #[test]
    fn rejects_unsafe_option_words() {
        assert!(is_safe_option_word("EndOfPage"));
        assert!(is_safe_option_word("cupsPrintQuality"));
        assert!(!is_safe_option_word("a b"));
        assert!(!is_safe_option_word("x;rm"));
        assert!(!is_safe_option_word(""));
    }
}
