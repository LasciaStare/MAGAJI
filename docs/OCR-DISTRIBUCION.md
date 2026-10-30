# Distribución de RapidOCR en MAGAJI 1.2.6

El OCR usa Rust (`rapidocr-core` 0.2.2), ONNX Runtime CPU 1.31.0 y los modelos PP-OCRv6 Small. No ejecuta Python ni descarga modelos al leer una factura. El análisis posterior con un proveedor de IA sigue necesitando internet y la clave del usuario.

## Construir para Windows x64

Requiere Node.js 22 o posterior, Rust estable y las herramientas de compilación de Tauri para Windows. Ejecutar `npm ci` y `npm run tauri build`. La preparación de OCR está incluida en los pasos previos de desarrollo y compilación.

`npm run ocr:prepare` descarga y valida SHA256 de los recursos públicos. Los archivos grandes se guardan fuera de Git en `src-tauri/resources/ocr/`; las descargas se conservan en `src-tauri/target/`. También se puede suministrar una carpeta con los mismos modelos verificados: `npm run ocr:prepare -- --modelos "C:\carpeta\modelos"`.

El instalador NSIS se genera en `src-tauri/target/release/bundle/nsis/`. Para distribuir, entregar el instalador completo. Copiar únicamente `magaji.exe` deja fuera los modelos y bibliotecas.

El paquete incluye las DLL de Visual C++ necesarias junto al ejecutable, sin requerir una instalación global de Python, ONNX o Visual C++. WebView2 se reutiliza si ya está en Windows; el instalador lo descarga solamente cuando falta. En una PC sin WebView2 se requiere conexión para instalar ese componente. El OCR funciona después sin conexión.

Los modelos se cargan en la primera lectura y se conservan hasta cerrar la aplicación. Las lecturas se ejecutan de una en una, en un hilo de trabajo. El formato de respuesta del comando `ejecutar_rapidocr` conserva `ok`, `texto_filas`, `texto_completo` y `total_items`.

La base de datos y claves de esta PC no forman parte del instalador. Una actualización conserva los datos del usuario. Los precios extraídos deben revisarse antes de importar, especialmente si están manuscritos.

## Procedencia y licencias

- Biblioteca Rust: [White-NX/rapidocr-rs](https://github.com/White-NX/rapidocr-rs), Apache-2.0.
- Modelos y diccionario: [RapidAI/RapidOCR](https://github.com/RapidAI/RapidOCR), derivados de [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR), Apache-2.0. Las versiones y sumas de verificación están en `scripts/preparar-ocr.mjs`.
- ONNX Runtime: [Microsoft/onnxruntime v1.31.0](https://github.com/microsoft/onnxruntime/releases/tag/v1.31.0), MIT; se incluyen LICENSE y ThirdPartyNotices del archivo oficial.
- Bibliotecas Visual C++: paquete oficial Microsoft.VCLibs.140.00.UWPDesktop x64 14.0.33321.0. [Distribución local de bibliotecas de Visual C++](https://learn.microsoft.com/en-us/cpp/windows/walkthrough-deploying-a-visual-cpp-application-to-another-computer?view=msvc-170).

El instalador incluye estos avisos en `ocr/licencias/`.

## Comprobaciones de desarrollo

```powershell
npm run ocr:prepare
cargo test --release --manifest-path src-tauri\Cargo.toml --lib ocr::tests
cargo run --release --manifest-path src-tauri\Cargo.toml --example probar_ocr -- pruebafact.jpg src-tauri\target\release pruebas_ocr\rust_resultados\integracion.json
npm run test:facturas
npm run test:etiquetas
npm run build
```

El ejemplo procesa una foto dos veces con el mismo motor y comprueba imagen blanca, datos base64 inválidos e imagen corrupta. No abre la aplicación ni su base de datos. Los tests del importador usan SQLite temporal y llamadas simuladas a la IA; Python solo se usa en ese test de desarrollo para SQLite, nunca en la aplicación distribuida.
