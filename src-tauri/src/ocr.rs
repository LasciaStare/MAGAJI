use base64::{engine::general_purpose::STANDARD, Engine};
use rapidocr_core::{
    config::{InferenceOptions, LimitType, PipelineConfig, RapidOcrConfig},
    types::OcrOutput,
    RapidOcr,
};
use serde_json::{json, Value};
use std::{
    io::{Cursor, Write},
    path::Path,
    sync::Mutex,
};
use tauri::Manager;

const MAX_IMAGE_BYTES: usize = 24 * 1024 * 1024;
const MAX_PIXELS: u64 = 32_000_000;

#[derive(Default)]
pub struct OcrState(Mutex<Option<RapidOcr>>);

impl OcrState {
    /// root es el directorio de recursos de Tauri, nunca el directorio de trabajo.
    pub fn procesar(&self, root: &Path, imagen_base64: &str) -> Result<String, String> {
        if imagen_base64.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4 {
            return Err("La imagen supera los 24 MB. Active la optimización de la foto.".into());
        }
        let bytes = STANDARD
            .decode(imagen_base64)
            .map_err(|_| "La imagen contiene datos base64 inválidos.".to_string())?;
        let format = image::guess_format(&bytes).map_err(|_| {
            "No se pudo leer la imagen. Seleccione una foto JPG, PNG o WEBP válida.".to_string()
        })?;
        if !matches!(
            format,
            image::ImageFormat::Jpeg | image::ImageFormat::Png | image::ImageFormat::WebP
        ) {
            return Err("Seleccione una imagen JPG, PNG o WEBP.".into());
        }
        let (width, height) = image::ImageReader::with_format(Cursor::new(&bytes), format)
            .into_dimensions()
            .map_err(|e| format!("No se pudo leer la imagen: {e}"))?;
        if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
            return Err(
                "La imagen tiene dimensiones demasiado grandes. Active la optimización de la foto."
                    .into(),
            );
        }
        // El lector de la biblioteca conserva orientación EXIF y transparencias.
        let suffix = format!(".{}", format.extensions_str()[0]);
        let mut photo = tempfile::Builder::new()
            .prefix("magaji-ocr-")
            .suffix(&suffix)
            .tempfile()
            .map_err(|e| format!("No se pudo preparar la foto: {e}"))?;
        photo
            .write_all(&bytes)
            .map_err(|e| format!("No se pudo preparar la foto: {e}"))?;

        // ponytail: un motor por aplicación; serializa lecturas para limitar la RAM.
        let mut state = self
            .0
            .lock()
            .map_err(|_| "El motor OCR debe reiniciarse. Cierre y abra MAGAJI.".to_string())?;
        if state.is_none() {
            *state = Some(cargar_motor(root)?);
        }
        let output = state
            .as_mut()
            .unwrap()
            .run_path(photo.path())
            .map_err(|e| format!("No se pudo procesar la foto con RapidOCR: {e:#}"))?;
        Ok(ordenar_filas(output).to_string())
    }
}

fn cargar_motor(root: &Path) -> Result<RapidOcr, String> {
    let modelos = root.join("ocr/modelos");
    for relative in [
        "onnxruntime.dll",
        "ocr/modelos/PP-OCRv6_det_small.onnx",
        "ocr/modelos/PP-OCRv6_rec_small.onnx",
        "ocr/modelos/ppocrv6_dict.txt",
    ] {
        if !root.join(relative).is_file() {
            return Err(format!("Falta un recurso de RapidOCR ({relative}). Reinstale MAGAJI con el instalador completo."));
        }
    }
    ort::init_from(root.join("onnxruntime.dll"))
        .map_err(|e| format!("No se pudo cargar ONNX Runtime. Reinstale MAGAJI: {e}"))?
        .with_name("MAGAJI OCR")
        .commit();
    let mut cfg = RapidOcrConfig::ppocr_v6_small(modelos)
        .with_pipeline(PipelineConfig::without_cls())
        .with_inference_options(InferenceOptions {
            intra_threads: 2,
            inter_threads: 1,
            parallel_execution: false,
            enable_cpu_mem_arena: false,
            ..Default::default()
        });
    cfg.text_score = 0.3;
    let det = cfg.det.as_mut().unwrap();
    det.limit_type = LimitType::Max;
    det.limit_side_len = 1280;
    RapidOcr::from_config(cfg).map_err(|e| format!("No se pudo iniciar RapidOCR: {e:#}"))
}

fn ordenar_filas(output: OcrOutput) -> Value {
    let total = output.lines.len();
    let mut items: Vec<_> = output
        .lines
        .into_iter()
        .map(|line| {
            let x = line.bbox.points.iter().map(|p| p[0] as f64).sum::<f64>() / 4.0;
            let y = line.bbox.points.iter().map(|p| p[1] as f64).sum::<f64>() / 4.0;
            (y, x, line.text.trim().to_string())
        })
        .collect();
    items.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut rows = Vec::new();
    let mut current: Vec<(f64, String)> = Vec::new();
    let mut current_y: Option<f64> = None;
    for (y, x, text) in items {
        if text.is_empty() {
            continue;
        }
        if let Some(previous_y) = current_y {
            if (y - previous_y).abs() >= 20.0 {
                rows.push(cerrar_fila(&mut current));
                current_y = None;
            }
        }
        current.push((x, text));
        current_y = Some(current_y.map_or(y, |previous_y| (previous_y + y) / 2.0));
    }
    if !current.is_empty() {
        rows.push(cerrar_fila(&mut current));
    }
    json!({"ok": true,"texto_completo":rows.join("\n"),"texto_filas":rows,"total_items":total})
}

fn cerrar_fila(items: &mut Vec<(f64, String)>) -> String {
    items.sort_by(|a, b| a.0.total_cmp(&b.0));
    let row = items
        .iter()
        .map(|(_, text)| text.as_str())
        .collect::<Vec<_>>()
        .join(" | ");
    items.clear();
    row
}

#[tauri::command]
pub async fn ejecutar_rapidocr(
    app: tauri::AppHandle,
    imagen_base64: String,
) -> Result<String, String> {
    let root = app
        .path()
        .resource_dir()
        .map_err(|e| format!("No se encontraron los recursos OCR: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<OcrState>().procesar(&root, &imagen_base64)
    })
    .await
    .map_err(|e| format!("La lectura OCR se interrumpió: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use rapidocr_core::types::{OcrLine, Quad};

    #[test]
    fn agrupa_y_ordena_las_filas_sin_inventar_texto() {
        let line = |x: f32, y: f32, text: &str| OcrLine {
            bbox: Quad {
                points: [[x, y]; 4],
            },
            text: text.into(),
            score: 0.99,
        };
        let result = ordenar_filas(OcrOutput {
            lines: vec![
                line(200., 11., " 12000 "),
                line(0., 10., "AJEDREZ"),
                line(0., 40., "NIVEL"),
                line(200., 41., "2000"),
                line(0., 70., " "),
            ],
        });
        assert_eq!(
            result["texto_filas"],
            json!(["AJEDREZ | 12000", "NIVEL | 2000"])
        );
        assert_eq!(result["texto_completo"], "AJEDREZ | 12000\nNIVEL | 2000");
        assert_eq!(result["total_items"], 5);
        assert_eq!(
            ordenar_filas(OcrOutput { lines: vec![] })["texto_filas"],
            json!([])
        );
        assert!(OcrState::default()
            .procesar(Path::new("."), "no es base64")
            .unwrap_err()
            .contains("base64"));
        assert!(OcrState::default()
            .procesar(Path::new("."), &STANDARD.encode(b"imagen corrupta"))
            .unwrap_err()
            .contains("imagen"));
    }
}
