// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod printing;
mod facturas_ia;
mod ocr;

/// Envía bytes crudos (ESC/POS) a una impresora instalada en Windows.
#[tauri::command]
fn imprimir_raw(printer_name: String, data: Vec<u8>) -> Result<(), String> {
    #[cfg(windows)]
    {
        printing::imprimir_raw(&printer_name, &data)
    }
    #[cfg(not(windows))]
    {
        let _ = (printer_name, data);
        Err("La impresión RAW solo está disponible en Windows".to_string())
    }
}

/// Lista las impresoras instaladas para que el usuario elija la térmica.
#[tauri::command]
fn listar_impresoras() -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        printing::listar_impresoras()
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ocr::OcrState::default())
        // Plugin de Base de Datos
        .plugin(tauri_plugin_sql::Builder::default().build())

        // Plugin nativo corregido (opener en lugar de shell)
        .plugin(tauri_plugin_opener::init())

        // Plugin de diálogo nativo (selector de carpeta para respaldos)
        .plugin(tauri_plugin_dialog::init())

        // Plugin de sistema de archivos (para guardar PDFs de facturas)
        .plugin(tauri_plugin_fs::init())

        .invoke_handler(tauri::generate_handler![
            imprimir_raw,
            listar_impresoras,
            ocr::ejecutar_rapidocr,
            facturas_ia::probar_conexion_ia,
            facturas_ia::listar_modelos_ia,
            facturas_ia::analizar_factura_ocr_ia
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
