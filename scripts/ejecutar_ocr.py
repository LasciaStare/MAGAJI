"""
Script para ejecutar RapidOCR v6 Small sobre una imagen de factura.
Devuelve el texto estructurado por filas para pasárselo a la IA.
"""
import os
import sys
import json
import argparse
from pathlib import Path

def obtener_ruta_modelos():
    local_app_data = os.environ.get('LOCALAPPDATA', '')
    if local_app_data:
        candidatos = [
            Path(local_app_data) / 'MAGAJI' / 'ocr-prueba-20261013' / 'modelos',
            Path(local_app_data) / 'MAGAJI' / 'modelos',
        ]
        for c in candidatos:
            if c.exists() and (c / 'PP-OCRv6_det_small.onnx').exists():
                return str(c)
    return None

def main():
    parser = argparse.ArgumentParser(description="Ejecutar RapidOCR Small en factura")
    parser.add_argument("--imagen", required=True, help="Ruta de la imagen")
    args = parser.parse_args()

    ruta_img = Path(args.imagen)
    if not ruta_img.exists():
        print(json.dumps({"ok": False, "error": f"No se encontró la imagen: {ruta_img}"}))
        sys.exit(1)

    try:
        import numpy as np
        from rapidocr import RapidOCR, OCRVersion, ModelType, EngineType

        params = {
            'Global.use_cls': False,
            'Global.text_score': 0.3,
            'EngineConfig.onnxruntime.intra_op_num_threads': 2,
            'EngineConfig.onnxruntime.inter_op_num_threads': 1,
            'EngineConfig.onnxruntime.use_cuda': False,
            'EngineConfig.onnxruntime.use_dml': False,
            'Det.engine_type': EngineType.ONNXRUNTIME,
            'Rec.engine_type': EngineType.ONNXRUNTIME,
            'Det.limit_type': 'max',
            'Det.limit_side_len': 1280,
            'Det.ocr_version': OCRVersion.PPOCRV6,
            'Rec.ocr_version': OCRVersion.PPOCRV6,
            'Det.model_type': ModelType.SMALL,
            'Rec.model_type': ModelType.SMALL,
            'Rec.lang_type': 'es',
        }

        model_dir = obtener_ruta_modelos()
        if model_dir:
            params['Global.model_root_dir'] = model_dir

        engine = RapidOCR(params=params)
        res = engine(str(ruta_img))

        if not res or not res.txts:
            print(json.dumps({"ok": True, "texto_filas": [], "texto_completo": "", "total_palabras": 0}))
            return

        items = []
        for box, text, score in zip(res.boxes, res.txts, res.scores):
            box = np.asarray(box, dtype=float)
            x = float(box[:, 0].mean())
            y = float(box[:, 1].mean())
            items.append((y, x, text.strip()))

        # Ordenar por Y
        items.sort(key=lambda it: it[0])

        # Agrupar por líneas (filas de la factura) con tolerancia vertical
        filas = []
        curr_line = []
        curr_y = None
        for y, x, text in items:
            if not text:
                continue
            if curr_y is None or abs(y - curr_y) < 20:
                curr_line.append((x, text))
                curr_y = y if curr_y is None else (curr_y + y) / 2
            else:
                curr_line.sort(key=lambda it: it[0])
                filas.append(" | ".join([t for _, t in curr_line]))
                curr_line = [(x, text)]
                curr_y = y

        if curr_line:
            curr_line.sort(key=lambda it: it[0])
            filas.append(" | ".join([t for _, t in curr_line]))

        texto_completo = "\n".join(filas)

        resultado = {
            "ok": True,
            "texto_filas": filas,
            "texto_completo": texto_completo,
            "total_items": len(res.txts),
        }
        print(json.dumps(resultado, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
