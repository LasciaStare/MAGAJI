//! Prueba el mismo motor del comando Tauri sin abrir el POS ni su base de datos.
#[path = "../src/ocr.rs"]
#[allow(dead_code)]
mod ocr;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
use std::{env, fs, io::Cursor, path::PathBuf, time::Instant};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args_os().collect();
    if args.len() != 4 {
        return Err("Uso: probar_ocr imagen carpeta_recursos salida.json".into());
    }
    let root = PathBuf::from(&args[2]);
    let engine = ocr::OcrState::default();
    let image = STANDARD.encode(fs::read(&args[1])?);
    let inicio = Instant::now();
    let first = engine.procesar(&root, &image)?;
    let primera_s = inicio.elapsed().as_secs_f64();
    let inicio = Instant::now();
    let second = engine.procesar(&root, &image)?;
    let segunda_s = inicio.elapsed().as_secs_f64();
    assert_eq!(first, second, "La lectura repetida debe conservar el texto");
    let mut png = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
        640,
        480,
        image::Rgb([255, 255, 255]),
    ))
    .write_to(&mut png, image::ImageFormat::Png)?;
    let blank: serde_json::Value =
        serde_json::from_str(&engine.procesar(&root, &STANDARD.encode(png.into_inner()))?)?;
    assert_eq!(blank["texto_filas"], json!([]));
    assert_eq!(blank["texto_completo"], "");
    assert_eq!(blank["total_items"], 0);
    assert!(engine.procesar(&root, "datos invalidos").is_err());
    assert!(engine
        .procesar(&root, &STANDARD.encode(b"foto rota"))
        .is_err());
    let data = serde_json::from_str::<serde_json::Value>(&first)?;
    assert_eq!(data["ok"], true);
    fs::write(
        &args[3],
        serde_json::to_vec_pretty(&json!({
            "resultado":data,"primera_s":primera_s,"segunda_s":segunda_s,
            "comprobaciones":["lectura repetida","imagen blanca PNG","base64 invalido","imagen corrupta"]
        }))?,
    )?;
    println!(
        "OCR nativo correcto: primera {primera_s:.2}s, segunda {segunda_s:.2}s, {} fragmentos",
        data["total_items"]
    );
    Ok(())
}
