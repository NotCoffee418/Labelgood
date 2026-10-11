//! Reading and writing Windows Print Schema XML (PrintCapabilities and PrintTicket).
//! Platform-independent so it can be tested anywhere; used by the Windows backend.
//!
//! Option keys are `namespace-uri|name`, which stay stable between calls, unlike
//! the XML prefixes a driver happens to use.
#![cfg_attr(not(windows), allow(dead_code))]

use crate::PrinterOption;
use std::collections::HashMap;

const PSF: &str = "http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework";
const PSK: &str = "http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords";

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
}
