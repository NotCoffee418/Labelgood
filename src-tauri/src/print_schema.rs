//! Reading and writing Windows Print Schema XML (PrintCapabilities and PrintTicket).
//! Platform-independent so it can be tested anywhere; used by the Windows backend.
//!
//! Option keys are `namespace-uri|name`, which stay stable between calls, unlike
//! the XML prefixes a driver happens to use.
#![cfg_attr(not(windows), allow(dead_code))]

use crate::PrinterOption;
use std::collections::HashMap;

const PSF: &str = "http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework";
pub const PSK: &str = "http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords";

/// Standard features the app controls itself (the label sets the size and orientation,
/// copies have their own field, and the label must never be scaled or tiled)
const MANAGED_FEATURES: &[&str] = &[
    "PageMediaSize",
    "PageOrientation",
    "PageScaling",
    "PageImageableSize",
    "JobNUpAllDocumentsContiguously",
    "DocumentNUp",
    "JobCollateAllDocuments",
    "DocumentCollate",
    "JobCopiesAllDocuments",
];

/// Resolves a `prefix:name` QName against the namespaces in scope at `node`
fn expand_qname(node: roxmltree::Node, qname: &str) -> Option<(String, String)> {
    let (prefix, local) = qname.split_once(':').unwrap_or(("", qname));
    let uri = node.lookup_namespace_uri(if prefix.is_empty() { None } else { Some(prefix) })?;
    Some((uri.to_string(), local.to_string()))
}

fn option_key(uri: &str, local: &str) -> String {
    format!("{}|{}", uri, local)
}

/// The `psk:DisplayName` property of a feature or option, if the driver gives one
fn display_name(node: roxmltree::Node) -> Option<String> {
    node.children()
        .filter(|child| child.has_tag_name((PSF, "Property")))
        .find(|property| {
            property
                .attribute("name")
                .and_then(|name| expand_qname(*property, name))
                .is_some_and(|(uri, local)| uri == PSK && local == "DisplayName")
        })?
        .children()
        .find(|child| child.has_tag_name((PSF, "Value")))?
        .text()
        .map(|text| text.trim().to_string())
}

/// Selected option per feature in a print ticket
pub fn ticket_selections(xml: &str) -> HashMap<String, String> {
    let Ok(doc) = roxmltree::Document::parse(xml) else { return HashMap::new() };
    doc.root_element()
        .children()
        .filter(|node| node.has_tag_name((PSF, "Feature")))
        .filter_map(|feature| {
            let (furi, flocal) = expand_qname(feature, feature.attribute("name")?)?;
            let option = feature.children().find(|child| child.has_tag_name((PSF, "Option")))?;
            let (ouri, olocal) = expand_qname(option, option.attribute("name")?)?;
            Some((option_key(&furi, &flocal), option_key(&ouri, &olocal)))
        })
        .collect()
}

/// Pick-one features and their named options from PrintCapabilities XML
pub fn parse_capabilities(xml: &str, defaults: &HashMap<String, String>) -> Result<Vec<PrinterOption>, String> {
    let doc = roxmltree::Document::parse(xml).map_err(|e| format!("Couldn't read the printer's capabilities: {}", e))?;
    let mut options = Vec::new();
    for feature in doc.root_element().children().filter(|node| node.has_tag_name((PSF, "Feature"))) {
        let Some((furi, flocal)) = feature.attribute("name").and_then(|name| expand_qname(feature, name)) else {
            continue;
        };
        if furi == PSK && MANAGED_FEATURES.contains(&flocal.as_str()) {
            continue;
        }
        let mut choices = Vec::new();
        let mut choice_labels = Vec::new();
        for option in feature.children().filter(|node| node.has_tag_name((PSF, "Option"))) {
            // Options without a name are described only by properties; they can't be selected by name
            let Some((ouri, olocal)) = option.attribute("name").and_then(|name| expand_qname(option, name)) else {
                continue;
            };
            choices.push(option_key(&ouri, &olocal));
            choice_labels.push(display_name(option).unwrap_or(olocal));
        }
        if choices.is_empty() {
            continue;
        }
        let key = option_key(&furi, &flocal);
        let default = defaults.get(&key).filter(|choice| choices.contains(choice)).cloned();
        options.push(PrinterOption {
            label: display_name(feature).unwrap_or(flocal),
            key,
            choices,
            choice_labels,
            default,
        });
    }
    Ok(options)
}

/// A `psf:ScoredProperty` value under `node`, in thousandths of a millimetre
fn scored_property_mm(node: roxmltree::Node, uri: &str, local: &str) -> Option<f64> {
    let property = node.children().filter(|child| child.has_tag_name((PSF, "ScoredProperty"))).find(|property| {
        property.attribute("name").and_then(|name| expand_qname(*property, name)).is_some_and(|(u, l)| u == uri && l == local)
    })?;
    let value = property.children().find(|child| child.has_tag_name((PSF, "Value")))?.text()?;
    Some(value.trim().parse::<f64>().ok()? / 1000.0)
}

/// Finds the driver's named `PageMediaSize` option matching a label's size, so the
/// printer gets its own exact media (and any metadata tied to it, like feed offsets)
/// instead of a generic custom size it may not handle the same way.
///
/// A continuous roll only constrains width (its `PageMediaSize` option has no height);
/// a die-cut label's option has both, which must match within rounding.
pub fn matching_media_size(xml: &str, width_mm: f64, height_mm: f64) -> Option<String> {
    const TOLERANCE_MM: f64 = 0.5;
    let doc = roxmltree::Document::parse(xml).ok()?;
    let feature = doc
        .root_element()
        .children()
        .filter(|node| node.has_tag_name((PSF, "Feature")))
        .find(|feature| {
            feature.attribute("name").and_then(|name| expand_qname(*feature, name)).is_some_and(|(u, l)| u == PSK && l == "PageMediaSize")
        })?;

    feature
        .children()
        .filter(|node| node.has_tag_name((PSF, "Option")))
        .find(|option| {
            let Some(width) = scored_property_mm(*option, PSK, "MediaSizeWidth") else { return false };
            if (width - width_mm).abs() > TOLERANCE_MM {
                return false;
            }
            match scored_property_mm(*option, PSK, "MediaSizeHeight") {
                Some(height) => (height - height_mm).abs() <= TOLERANCE_MM,
                None => true, // continuous roll: width is all that's fixed
            }
        })
        .and_then(|option| option.attribute("name").and_then(|name| expand_qname(option, name)))
        .map(|(uri, local)| option_key(&uri, &local))
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('"', "&quot;")
}

/// A partial print ticket selecting the given options, to merge over the defaults
pub fn delta_ticket(options: &HashMap<String, String>) -> String {
    let mut namespaces: Vec<String> = Vec::new();
    let mut prefix_for = |uri: &str| -> String {
        let index = namespaces.iter().position(|known| known == uri).unwrap_or_else(|| {
            namespaces.push(uri.to_string());
            namespaces.len() - 1
        });
        format!("n{}", index)
    };
    let mut features = String::new();
    for (feature, option) in options {
        let (Some((furi, flocal)), Some((ouri, olocal))) = (feature.split_once('|'), option.split_once('|')) else {
            continue;
        };
        features.push_str(&format!(
            r#"<psf:Feature name="{}:{}"><psf:Option name="{}:{}"/></psf:Feature>"#,
            prefix_for(furi), escape_xml(flocal), prefix_for(ouri), escape_xml(olocal)
        ));
    }
    let declarations: String = namespaces
        .iter()
        .enumerate()
        .map(|(index, uri)| format!(r#" xmlns:n{}="{}""#, index, escape_xml(uri)))
        .collect();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><psf:PrintTicket xmlns:psf="{}" version="1"{}>{}</psf:PrintTicket>"#,
        PSF, declarations, features
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const CAPABILITIES: &str = r#"<?xml version="1.0"?>
<psf:PrintCapabilities xmlns:psf="http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework"
    xmlns:psk="http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords"
    xmlns:ns0000="http://schemas.brother.info/ql/2008/02/printing/printschemakeywords" version="1">
  <psf:Feature name="psk:PageMediaSize">
    <psf:Option name="psk:ISOA4"/>
  </psf:Feature>
  <psf:Feature name="ns0000:CutOption">
    <psf:Property name="psk:DisplayName"><psf:Value>Cut Option</psf:Value></psf:Property>
    <psf:Option name="ns0000:CutAtEnd"><psf:Property name="psk:DisplayName"><psf:Value>Cut at end</psf:Value></psf:Property></psf:Option>
    <psf:Option name="ns0000:AutoCut"><psf:Property name="psk:DisplayName"><psf:Value>Auto cut</psf:Value></psf:Property></psf:Option>
  </psf:Feature>
</psf:PrintCapabilities>"#;

    #[test]
    fn parses_driver_features_and_skips_managed_ones() {
        let brother = "http://schemas.brother.info/ql/2008/02/printing/printschemakeywords";
        let defaults = HashMap::from([(option_key(brother, "CutOption"), option_key(brother, "AutoCut"))]);
        let options = parse_capabilities(CAPABILITIES, &defaults).unwrap();
        assert_eq!(options.len(), 1);
        assert_eq!(options[0].label, "Cut Option");
        assert_eq!(options[0].choice_labels, vec!["Cut at end", "Auto cut"]);
        assert_eq!(options[0].default.as_deref(), Some(option_key(brother, "AutoCut").as_str()));
    }

    #[test]
    fn delta_ticket_round_trips_selections() {
        let brother = "http://schemas.brother.info/ql/2008/02/printing/printschemakeywords";
        let options = HashMap::from([(option_key(brother, "CutOption"), option_key(brother, "CutAtEnd"))]);
        let selections = ticket_selections(&delta_ticket(&options));
        assert_eq!(selections, options);
    }

    // Shaped like a real Brother QL driver dump: die-cut options carry both a width
    // and a height (plus a feed offset the app doesn't need), continuous-roll options
    // carry only a width.
    const MEDIA_SIZES: &str = r#"<?xml version="1.0"?>
<psf:PrintCapabilities xmlns:psf="http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework"
    xmlns:psk="http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords"
    xmlns:brpsk="http://schemas.brother.info/mfc/printing/2006/11/printschemakeywords" version="1">
  <psf:Feature name="psk:PageMediaSize">
    <psf:Option name="brpsk:CustomMediaSize271">
      <psf:ScoredProperty name="psk:MediaSizeWidth"><psf:Value>29000</psf:Value></psf:ScoredProperty>
      <psf:ScoredProperty name="psk:MediaSizeHeight"><psf:Value>89800</psf:Value></psf:ScoredProperty>
      <psf:ScoredProperty name="brpsk:MediaSizeHeightOffset"><psf:Value>3000</psf:Value></psf:ScoredProperty>
    </psf:Option>
    <psf:Option name="brpsk:CustomMediaSize259">
      <psf:ScoredProperty name="psk:MediaSizeWidth"><psf:Value>62000</psf:Value></psf:ScoredProperty>
    </psf:Option>
  </psf:Feature>
</psf:PrintCapabilities>"#;

    #[test]
    fn matches_die_cut_media_by_width_and_height() {
        let brother = "http://schemas.brother.info/mfc/printing/2006/11/printschemakeywords";
        // The nominal label is 29x90mm; the driver's matching preset is 89.8mm tall
        let found = matching_media_size(MEDIA_SIZES, 29.0, 90.0);
        assert_eq!(found, Some(option_key(brother, "CustomMediaSize271")));
    }

    #[test]
    fn matches_continuous_roll_by_width_only() {
        let brother = "http://schemas.brother.info/mfc/printing/2006/11/printschemakeywords";
        // Continuous rolls have no fixed height; any length should match the 62mm width
        let found = matching_media_size(MEDIA_SIZES, 62.0, 240.0);
        assert_eq!(found, Some(option_key(brother, "CustomMediaSize259")));
    }

    #[test]
    fn no_match_for_unknown_size() {
        assert_eq!(matching_media_size(MEDIA_SIZES, 40.0, 40.0), None);
    }
}
