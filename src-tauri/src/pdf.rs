//! Minimal PDF writer: a single page of a given size, filled by one image.
//! Replaces shelling out to ImageMagick, so printing needs no external tools.

use flate2::{write::ZlibEncoder, Compression};
use std::io::Write;

/// 8-bit RGB pixels, row by row from the top
pub struct RgbImage {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

/// Decodes a PNG into RGB, compositing any transparency onto white (paper)
pub fn decode_png(bytes: &[u8]) -> Result<RgbImage, String> {
    let mut decoder = png::Decoder::new(bytes);
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|e| format!("Invalid PNG: {}", e))?;
    let mut buffer = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buffer).map_err(|e| format!("Invalid PNG: {}", e))?;
    let data = &buffer[..info.buffer_size()];

    let over_white = |value: u8, alpha: u8| -> u8 {
        ((value as u32 * alpha as u32 + 255 * (255 - alpha as u32)) / 255) as u8
    };
    let pixels: Vec<u8> = match info.color_type {
        png::ColorType::Rgb => data.to_vec(),
        png::ColorType::Rgba => data
            .chunks_exact(4)
            .flat_map(|p| [over_white(p[0], p[3]), over_white(p[1], p[3]), over_white(p[2], p[3])])
            .collect(),
        png::ColorType::Grayscale => data.iter().flat_map(|&g| [g, g, g]).collect(),
        png::ColorType::GrayscaleAlpha => data
            .chunks_exact(2)
            .flat_map(|p| {
                let g = over_white(p[0], p[1]);
                [g, g, g]
            })
            .collect(),
        // EXPAND turns palette images into RGB(A)
        png::ColorType::Indexed => return Err("Unsupported PNG colour type".to_string()),
    };

    Ok(RgbImage { width: info.width, height: info.height, pixels })
}

/// Builds a one-page PDF of `width_pt` x `height_pt` points showing `image` stretched over the page
pub fn image_pdf(image: &RgbImage, width_pt: f64, height_pt: f64) -> Vec<u8> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&image.pixels).expect("writing to memory cannot fail");
    let image_data = encoder.finish().expect("writing to memory cannot fail");
    let content = format!("q {:.3} 0 0 {:.3} 0 0 cm /Im0 Do Q", width_pt, height_pt);

    let mut out: Vec<u8> = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = Vec::new();
    let mut object = |out: &mut Vec<u8>, body: &[u8]| {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", offsets.len()).as_bytes());
        out.extend_from_slice(body);
        out.extend_from_slice(b"\nendobj\n");
    };

    object(&mut out, b"<< /Type /Catalog /Pages 2 0 R >>");
    object(&mut out, b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    object(&mut out, format!(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {:.3} {:.3}] \
         /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
        width_pt, height_pt
    ).as_bytes());

    let mut image_object = format!(
        "<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace /DeviceRGB \
         /BitsPerComponent 8 /Filter /FlateDecode /Length {} >>\nstream\n",
        image.width, image.height, image_data.len()
    ).into_bytes();
    image_object.extend_from_slice(&image_data);
    image_object.extend_from_slice(b"\nendstream");
    object(&mut out, &image_object);

    object(&mut out, format!(
        "<< /Length {} >>\nstream\n{}\nendstream",
        content.len(), content
    ).as_bytes());

    let xref_offset = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len() + 1).as_bytes());
    for offset in &offsets {
        out.extend_from_slice(format!("{:010} 00000 n \n", offset).as_bytes());
    }
    out.extend_from_slice(format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
        offsets.len() + 1, xref_offset
    ).as_bytes());
    out
}

/// Millimetres to PDF points (1/72 inch)
pub fn mm_to_pt(mm: f64) -> f64 {
    mm * 72.0 / 25.4
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xref_offsets_point_at_objects() {
        let image = RgbImage { width: 2, height: 1, pixels: vec![0, 0, 0, 255, 255, 255] };
        let pdf = image_pdf(&image, mm_to_pt(62.0), mm_to_pt(30.0));
        // Work on bytes: the header and image stream aren't text, so offsets must be byte offsets
        let find = |needle: &[u8], from: usize| pdf[from..].windows(needle.len()).position(|w| w == needle).map(|i| i + from);
        assert!(pdf.starts_with(b"%PDF-1.4"));
        assert!(find(b"/MediaBox [0 0 175.748 85.039]", 0).is_some());

        let startxref = find(b"startxref\n", 0).unwrap() + b"startxref\n".len();
        let tail = String::from_utf8(pdf[startxref..].to_vec()).unwrap();
        let xref_at: usize = tail.lines().next().unwrap().parse().unwrap();
        assert!(pdf[xref_at..].starts_with(b"xref"));
        let table = String::from_utf8(pdf[xref_at..startxref].to_vec()).unwrap();
        for (index, line) in table.lines().skip(3).take(5).enumerate() {
            let offset: usize = line[..10].parse().unwrap();
            assert!(pdf[offset..].starts_with(format!("{} 0 obj", index + 1).as_bytes()));
        }
    }

    #[test]
    fn transparency_becomes_white() {
        // 1x1 fully transparent RGBA PNG
        let mut png_bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_bytes, 1, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.write_header().unwrap().write_image_data(&[0, 0, 0, 0]).unwrap();
        }
        let image = decode_png(&png_bytes).unwrap();
        assert_eq!(image.pixels, vec![255, 255, 255]);
    }
}
