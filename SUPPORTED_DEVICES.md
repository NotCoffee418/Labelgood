# Supported Devices

## Confirmed Working

| Printer | Windows | Linux |
| --- | --- | --- |
| Brother QL-810W | ✅ | ✅ |

## Expected to Work

- **Linux**: any label printer with a CUPS driver. Printing goes through `lpr`/`lpoptions` against the driver's own queue, so this isn't Brother-specific.
- **Windows**: other Brother QL models, since they share the same driver family and print schema as the QL-810W.

Other Windows label printers (Zebra, Dymo, Rollo, …) aren't tested and may need printer-specific handling we haven't added yet — see `matching_media_size` in [src-tauri/src/print_schema.rs](src-tauri/src/print_schema.rs) for the kind of driver quirk that can come up.

## Report Your Printer

Tried a printer not listed here, on either OS? [Open an issue](https://github.com/NotCoffee418/Labelgood/issues/new?template=printer-report.yml) to let us know whether it worked.
