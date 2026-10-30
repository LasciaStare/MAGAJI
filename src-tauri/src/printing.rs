//! Impresión RAW (ESC/POS) hacia impresoras instaladas en Windows.
//!
//! Envía los bytes directamente al spooler con datatype "RAW", de modo que la
//! impresora térmica los interpreta con su firmware/fuente nativa (igual que el
//! auto-test), evitando la rasterización del driver.
#![cfg(windows)]

use windows::core::{Error, PCWSTR, PWSTR};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Graphics::Printing::{
    ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, OpenPrinterW, StartDocPrinterW,
    StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL,
    PRINTER_INFO_4W,
};

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Envía un bloque de bytes crudos (ESC/POS) a la impresora indicada por nombre.
pub fn imprimir_raw(printer: &str, data: &[u8]) -> Result<(), String> {
    unsafe {
        let name = to_wide(printer);
        let mut hprinter = HANDLE::default();
        OpenPrinterW(PCWSTR(name.as_ptr()), &mut hprinter, None)
            .map_err(|e: Error| format!("No se pudo abrir la impresora '{printer}': {e}"))?;

        let mut doc_name = to_wide("Factura POS");
        let mut datatype = to_wide("RAW");
        let doc = DOC_INFO_1W {
            pDocName: PWSTR(doc_name.as_mut_ptr()),
            pOutputFile: PWSTR::null(),
            pDatatype: PWSTR(datatype.as_mut_ptr()),
        };

        // Ejecutamos el trabajo dentro de un closure para cerrar siempre el handle.
        let resultado = (|| -> Result<(), String> {
            let job = StartDocPrinterW(hprinter, 1, &doc);
            if job == 0 {
                return Err(format!("StartDocPrinter falló: {}", Error::from_win32()));
            }
            StartPagePrinter(hprinter)
                .ok()
                .map_err(|e: Error| format!("StartPagePrinter falló: {e}"))?;

            let mut escritos: u32 = 0;
            WritePrinter(
                hprinter,
                data.as_ptr() as *const core::ffi::c_void,
                data.len() as u32,
                &mut escritos,
            )
            .ok()
            .map_err(|e: Error| format!("WritePrinter falló: {e}"))?;

            EndPagePrinter(hprinter)
                .ok()
                .map_err(|e: Error| format!("EndPagePrinter falló: {e}"))?;
            EndDocPrinter(hprinter)
                .ok()
                .map_err(|e: Error| format!("EndDocPrinter falló: {e}"))?;

            if (escritos as usize) != data.len() {
                return Err(format!(
                    "Se enviaron {} de {} bytes a la impresora",
                    escritos,
                    data.len()
                ));
            }
            Ok(())
        })();

        let _ = ClosePrinter(hprinter);
        resultado
    }
}

/// Devuelve los nombres de las impresoras instaladas (locales + conexiones).
pub fn listar_impresoras() -> Result<Vec<String>, String> {
    unsafe {
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let mut necesario: u32 = 0;
        let mut devueltos: u32 = 0;

        // Primer llamado: averiguar el tamaño del buffer requerido.
        let _ = EnumPrintersW(flags, PCWSTR::null(), 4, None, &mut necesario, &mut devueltos);
        if necesario == 0 {
            return Ok(Vec::new());
        }

        let mut buffer = vec![0u8; necesario as usize];
        EnumPrintersW(
            flags,
            PCWSTR::null(),
            4,
            Some(&mut buffer),
            &mut necesario,
            &mut devueltos,
        )
        .map_err(|e: Error| format!("EnumPrinters falló: {e}"))?;

        let infos = std::slice::from_raw_parts(
            buffer.as_ptr() as *const PRINTER_INFO_4W,
            devueltos as usize,
        );

        let mut nombres = Vec::new();
        for info in infos {
            if !info.pPrinterName.is_null() {
                if let Ok(nombre) = info.pPrinterName.to_string() {
                    if !nombre.is_empty() {
                        nombres.push(nombre);
                    }
                }
            }
        }
        Ok(nombres)
    }
}
