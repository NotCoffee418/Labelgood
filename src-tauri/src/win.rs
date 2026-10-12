//! Printing and fonts on Windows: the print spooler, Print Ticket API and GDI for
//! printing, DirectWrite for fonts.
//!
//! Printer options come from the driver's PrintCapabilities (the Windows counterpart
//! of CUPS' `lpoptions`), so whatever the driver offers (e.g. Brother's cut settings)
//! shows up in the print dialog. See `print_schema` for reading and writing that XML.

use crate::print_schema::{delta_ticket, matching_media_size, parse_capabilities, ticket_selections, PSK};
use crate::{pdf::RgbImage, DefaultFonts, PrintJob, PrinterOption};
use std::collections::BTreeSet;
use windows::core::{w, BOOL, HSTRING, PCWSTR};
use windows::Win32::Foundation::HGLOBAL;
use windows::Win32::Graphics::DirectWrite::{DWriteCreateFactory, IDWriteFactory, DWRITE_FACTORY_TYPE_SHARED};
use windows::Win32::Graphics::Gdi::{
    CreateDCW, DeleteDC, GetDeviceCaps, SetStretchBltMode, StretchDIBits, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DEVMODEA, DEVMODEW, DIB_RGB_COLORS, DMORIENT_PORTRAIT, DMPAPER_USER, DM_COPIES, DM_ORIENTATION,
    DM_OUT_BUFFER, DM_PAPERLENGTH, DM_PAPERSIZE, DM_PAPERWIDTH, HALFTONE, HDC, LOGPIXELSX, LOGPIXELSY,
    PHYSICALOFFSETX, PHYSICALOFFSETY, SRCCOPY,
};
use windows::Win32::Graphics::Printing::PrintTicket::{
    kPTJobScope, kUserDefaultDevmode, PTCloseProvider, PTConvertDevModeToPrintTicket, PTConvertPrintTicketToDevMode,
    PTGetPrintCapabilities, PTMergeAndValidatePrintTicket, PTOpenProvider, PTReleaseMemory, HPTPROVIDER,
};
use windows::Win32::Graphics::Printing::{
    ClosePrinter, DocumentPropertiesW, EnumPrintersW, OpenPrinterW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL,
    PRINTER_HANDLE, PRINTER_INFO_4W,
};
use windows::Win32::Storage::Xps::{EndDoc, EndPage, StartDocW, StartPage, DOCINFOW};
use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
use windows::Win32::System::Com::{CoInitializeEx, IStream, COINIT_MULTITHREADED, STREAM_SEEK_END, STREAM_SEEK_SET};

fn err(context: &str, e: impl std::fmt::Display) -> String {
    format!("{}: {}", context, e)
}

/// The Print Ticket API requires COM on the calling thread; repeated calls are harmless
fn init_com() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

pub fn list_printers() -> Result<Vec<String>, String> {
    unsafe {
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let (mut needed, mut returned) = (0u32, 0u32);
        // The first call only reports the buffer size it needs
        let _ = EnumPrintersW(flags, PCWSTR::null(), 4, None, &mut needed, &mut returned);
        if needed == 0 {
            return Ok(Vec::new());
        }
        // u64 storage keeps the PRINTER_INFO_4W records (which hold pointers) aligned
        let mut storage = vec![0u64; (needed as usize).div_ceil(8)];
        let buffer = std::slice::from_raw_parts_mut(storage.as_mut_ptr() as *mut u8, needed as usize);
        EnumPrintersW(flags, PCWSTR::null(), 4, Some(buffer), &mut needed, &mut returned)
            .map_err(|e| err("Failed to list printers", e))?;
        let infos = std::slice::from_raw_parts(storage.as_ptr() as *const PRINTER_INFO_4W, returned as usize);
        Ok(infos.iter().filter_map(|info| info.pPrinterName.to_string().ok()).collect())
    }
}

/// Closes a Print Ticket provider when dropped
struct Provider(HPTPROVIDER);

impl Provider {
    fn open(printer: &str) -> Result<Self, String> {
        unsafe { PTOpenProvider(&HSTRING::from(printer), 1) }
            .map(Provider)
            .map_err(|e| err("Couldn't open the printer's driver settings", e))
    }
}

impl Drop for Provider {
    fn drop(&mut self) {
        unsafe {
            let _ = PTCloseProvider(self.0);
        }
    }
}

/// Closes a printer handle when dropped
struct Printer(PRINTER_HANDLE);

impl Drop for Printer {
    fn drop(&mut self) {
        unsafe {
            let _ = ClosePrinter(self.0);
        }
    }
}

/// A DEVMODE (driver settings) in aligned storage, including the driver's private data
struct DevMode {
    storage: Vec<u64>,
    size: usize,
}

impl DevMode {
    fn as_ptr(&self) -> *const DEVMODEW {
        self.storage.as_ptr() as *const DEVMODEW
    }
}

/// The printer's current default settings
fn default_devmode(printer: &str) -> Result<DevMode, String> {
    let name = HSTRING::from(printer);
    unsafe {
        let mut handle = PRINTER_HANDLE::default();
        OpenPrinterW(&name, &mut handle, None).map_err(|e| err("Couldn't open the printer", e))?;
        let printer_handle = Printer(handle);

        let size = DocumentPropertiesW(None, printer_handle.0, &name, None, None, 0);
        if size <= 0 {
            return Err("Couldn't read the printer's settings".to_string());
        }
        let mut storage = vec![0u64; (size as usize).div_ceil(8)];
        let result = DocumentPropertiesW(
            None,
            printer_handle.0,
            &name,
            Some(storage.as_mut_ptr() as *mut DEVMODEW),
            None,
            DM_OUT_BUFFER.0,
        );
        if result < 0 {
            return Err("Couldn't read the printer's settings".to_string());
        }
        Ok(DevMode { storage, size: size as usize })
    }
}

fn new_stream() -> Result<IStream, String> {
    unsafe { CreateStreamOnHGlobal(HGLOBAL::default(), true) }.map_err(|e| err("Couldn't create a stream", e))
}

fn stream_with(bytes: &[u8]) -> Result<IStream, String> {
    let stream = new_stream()?;
    unsafe {
        stream
            .Write(bytes.as_ptr() as *const _, bytes.len() as u32, None)
            .ok()
            .map_err(|e| err("Couldn't write a stream", e))?;
        stream.Seek(0, STREAM_SEEK_SET, None).map_err(|e| err("Couldn't rewind a stream", e))?;
    }
    Ok(stream)
}

fn read_stream(stream: &IStream) -> Result<Vec<u8>, String> {
    unsafe {
        let mut size = 0u64;
        stream.Seek(0, STREAM_SEEK_END, Some(&mut size)).map_err(|e| err("Couldn't read a stream", e))?;
        stream.Seek(0, STREAM_SEEK_SET, None).map_err(|e| err("Couldn't read a stream", e))?;
        let mut buffer = vec![0u8; size as usize];
        let mut read = 0u32;
        stream
            .Read(buffer.as_mut_ptr() as *mut _, size as u32, Some(&mut read))
            .ok()
            .map_err(|e| err("Couldn't read a stream", e))?;
        buffer.truncate(read as usize);
        Ok(buffer)
    }
}

/// The print ticket (XML) for a DEVMODE
fn devmode_to_ticket(provider: &Provider, devmode: &DevMode) -> Result<IStream, String> {
    let stream = new_stream()?;
    unsafe {
        // The API is declared with DEVMODEA but works on the (Unicode) DEVMODE bytes
        PTConvertDevModeToPrintTicket(provider.0, devmode.size as u32, devmode.as_ptr() as *const DEVMODEA, kPTJobScope, &stream)
            .map_err(|e| err("Couldn't read the printer's settings", e))?;
        stream.Seek(0, STREAM_SEEK_SET, None).map_err(|e| err("Couldn't rewind a stream", e))?;
    }
    Ok(stream)
}

/// The driver's PrintCapabilities as XML (the Windows counterpart of CUPS' `lpoptions -l`)
fn capabilities_xml(provider: &Provider) -> Result<String, String> {
    let capabilities = new_stream()?;
    unsafe {
        PTGetPrintCapabilities(provider.0, None::<&IStream>, &capabilities, None)
            .map_err(|e| err("Couldn't read the printer's capabilities", e))?;
    }
    Ok(String::from_utf8_lossy(&read_stream(&capabilities)?).into_owned())
}

pub fn printer_options(printer: &str) -> Result<Vec<PrinterOption>, String> {
    init_com();
    let provider = Provider::open(printer)?;
    let xml = capabilities_xml(&provider)?;

    // Current defaults, so each option starts at what the driver would use anyway
    let defaults = default_devmode(printer)
        .and_then(|devmode| devmode_to_ticket(&provider, &devmode))
        .and_then(|ticket| read_stream(&ticket))
        .map(|bytes| ticket_selections(&String::from_utf8_lossy(&bytes)))
        .unwrap_or_default();

    parse_capabilities(&xml, &defaults)
}

/// Deletes a device context when dropped
struct DeviceContext(HDC);

impl Drop for DeviceContext {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteDC(self.0);
        }
    }
}

/// 24-bit top-down BGR DIB pixels, each row padded to 4 bytes
fn to_dib(image: &RgbImage) -> (Vec<u8>, BITMAPINFO) {
    let stride = (image.width as usize * 3).div_ceil(4) * 4;
    let mut bits = vec![255u8; stride * image.height as usize];
    for (y, row) in image.pixels.chunks_exact(image.width as usize * 3).enumerate() {
        for (x, rgb) in row.chunks_exact(3).enumerate() {
            let i = y * stride + x * 3;
            bits[i] = rgb[2];
            bits[i + 1] = rgb[1];
            bits[i + 2] = rgb[0];
        }
    }
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: image.width as i32,
            biHeight: -(image.height as i32), // negative: rows run top to bottom
            biPlanes: 1,
            biBitCount: 24,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    (bits, info)
}

/// Draws the label onto one page of a print job using the given driver settings
fn draw_label(job: &PrintJob, devmode: *const DEVMODEW) -> Result<(), String> {
    unsafe {
        let hdc = CreateDCW(w!("WINSPOOL"), &HSTRING::from(job.printer), PCWSTR::null(), Some(devmode));
        if hdc.is_invalid() {
            return Err("Couldn't open the printer for printing".to_string());
        }
        let dc = DeviceContext(hdc);

        // The label is drawn from the physical corner of the page at its real size;
        // device coordinates start at the printable area, offset from that corner
        let dpi_x = GetDeviceCaps(Some(dc.0), LOGPIXELSX) as f64;
        let dpi_y = GetDeviceCaps(Some(dc.0), LOGPIXELSY) as f64;
        let offset_x = GetDeviceCaps(Some(dc.0), PHYSICALOFFSETX);
        let offset_y = GetDeviceCaps(Some(dc.0), PHYSICALOFFSETY);
        let width = (job.width_mm / 25.4 * dpi_x).round() as i32;
        let height = (job.height_mm / 25.4 * dpi_y).round() as i32;

        let doc_name = HSTRING::from("Label");
        let doc = DOCINFOW {
            cbSize: std::mem::size_of::<DOCINFOW>() as i32,
            lpszDocName: PCWSTR(doc_name.as_ptr()),
            ..Default::default()
        };
        if StartDocW(dc.0, &doc) <= 0 {
            return Err("Couldn't start the print job".to_string());
        }
        if StartPage(dc.0) <= 0 {
            EndDoc(dc.0);
            return Err("Couldn't start the page".to_string());
        }

        let (bits, info) = to_dib(job.image);
        SetStretchBltMode(dc.0, HALFTONE);
        let lines = StretchDIBits(
            dc.0,
            -offset_x,
            -offset_y,
            width,
            height,
            0,
            0,
            job.image.width as i32,
            job.image.height as i32,
            Some(bits.as_ptr() as *const _),
            &info,
            DIB_RGB_COLORS,
            SRCCOPY,
        );

        EndPage(dc.0);
        EndDoc(dc.0);
        if lines == 0 {
            return Err("Couldn't draw the label".to_string());
        }
        Ok(())
    }
}

pub fn print(job: &PrintJob) -> Result<(), String> {
    init_com();
    let provider = Provider::open(job.printer)?;

    // Prefer the driver's own named media (e.g. a Brother DK roll) over an arbitrary
    // custom size: some drivers handle a size they didn't themselves advertise
    // inconsistently, down to rejecting the job at the printer with a feed error.
    let media = capabilities_xml(&provider).ok().and_then(|xml| matching_media_size(&xml, job.width_mm, job.height_mm));

    let mut options = job.options.clone();
    if let Some(media) = &media {
        options.insert(format!("{}|{}", PSK, "PageMediaSize"), media.clone());
    }

    // Start from the printer's defaults and apply the chosen options on top
    let base = devmode_to_ticket(&provider, &default_devmode(job.printer)?)?;
    let delta = stream_with(delta_ticket(&options).as_bytes())?;
    let merged = new_stream()?;
    unsafe {
        PTMergeAndValidatePrintTicket(provider.0, &base, &delta, kPTJobScope, &merged, None)
            .map_err(|e| err("The printer rejected these settings", e))?;
        merged.Seek(0, STREAM_SEEK_SET, None).map_err(|e| err("Couldn't rewind a stream", e))?;

        let mut size = 0u32;
        let mut devmode: *mut DEVMODEA = std::ptr::null_mut();
        PTConvertPrintTicketToDevMode(provider.0, &merged, kUserDefaultDevmode, kPTJobScope, &mut size, &mut devmode, None)
            .map_err(|e| err("Couldn't apply the print settings", e))?;
        let devmode = devmode as *mut DEVMODEW;

        // Portrait, the number of copies, and the label's own size (in 0.1 mm) always
        // come from the job: selecting a named media fixes the paper size driver-side
        // (so the printer gets the roll it expects), but the driver doesn't reliably
        // carry that media's width/length back into the DEVMODE, so those still need
        // to be set here, same as for the custom-size fallback below.
        (*devmode).dmFields |= DM_ORIENTATION | DM_COPIES | DM_PAPERWIDTH | DM_PAPERLENGTH;
        let page = &mut (*devmode).Anonymous1.Anonymous1;
        page.dmOrientation = DMORIENT_PORTRAIT as i16;
        page.dmCopies = job.copies as i16;
        page.dmPaperWidth = (job.width_mm * 10.0).round() as i16;
        page.dmPaperLength = (job.height_mm * 10.0).round() as i16;
        if media.is_none() {
            (*devmode).dmFields |= DM_PAPERSIZE;
            page.dmPaperSize = DMPAPER_USER as i16;
        }

        let result = draw_label(job, devmode);
        let _ = PTReleaseMemory(devmode as *const _);
        result
    }
}

/// WebView2 (Chromium) maps the generic families to fixed fonts on Windows
pub fn default_fonts() -> DefaultFonts {
    DefaultFonts {
        sans_serif: Some("Arial".to_string()),
        serif: Some("Times New Roman".to_string()),
        monospace: Some("Consolas".to_string()),
    }
}

/// Installed font families via DirectWrite (English names where available)
pub fn list_fonts() -> Result<Vec<String>, String> {
    unsafe {
        let factory: IDWriteFactory =
            DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED).map_err(|e| err("Couldn't list fonts", e))?;
        let mut collection = None;
        factory
            .GetSystemFontCollection(&mut collection, false)
            .map_err(|e| err("Couldn't list fonts", e))?;
        let collection = collection.ok_or("Couldn't list fonts")?;

        let mut families = BTreeSet::new();
        for index in 0..collection.GetFontFamilyCount() {
            let Ok(names) = collection.GetFontFamily(index).and_then(|family| family.GetFamilyNames()) else {
                continue;
            };
            let mut name_index = 0u32;
            let mut exists = BOOL(0);
            let _ = names.FindLocaleName(w!("en-us"), &mut name_index, &mut exists);
            if !exists.as_bool() {
                name_index = 0;
            }
            let Ok(length) = names.GetStringLength(name_index) else { continue };
            let mut buffer = vec![0u16; length as usize + 1];
            if names.GetString(name_index, &mut buffer).is_ok() {
                let name = String::from_utf16_lossy(&buffer[..length as usize]);
                // '@' families are vertical-text variants of CJK fonts
                if !name.is_empty() && !name.starts_with('@') {
                    families.insert(name);
                }
            }
        }
        let mut families: Vec<String> = families.into_iter().collect();
        families.sort_by_key(|family| family.to_lowercase());
        Ok(families)
    }
}
