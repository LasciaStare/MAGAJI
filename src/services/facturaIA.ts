import { invoke } from '@tauri-apps/api/core';
import type { Producto } from '../database/db';
import { dimensionesFactura, filasDesdeIA, type FilaFactura } from '../utils/importacionFactura';
import { NUEVE_CATEGORIAS_DEFECTO } from '../utils/factura';

export interface ModeloIA {
  id: string;
  nombre: string;
  gratuito: boolean | null;
}

/** Catálogo actual del proveedor; OpenRouter aplica preferencias de cuenta si hay clave. */
export async function listarModelosIA(proveedor: string, clave: string): Promise<ModeloIA[]> {
  return invoke<ModeloIA[]>('listar_modelos_ia', {
    proveedor: proveedor.trim().toLowerCase(), apiKey: clave.trim(),
  }).catch((e: unknown) => {
    throw new Error(typeof e === 'string' ? e : 'No se pudo consultar el catálogo de modelos.');
  });
}

export interface ResultadoOCR {
  ok: boolean;
  texto_filas: string[];
  texto_completo: string;
  total_items?: number;
  error?: string;
}

/** Ejecuta RapidOCR Small sobre una imagen local */
export async function ejecutarOcrFactura(
  imagen: File | Blob,
  optimizar = true,
  informar?: (mensaje: string) => void
): Promise<ResultadoOCR> {
  informar?.('Preparando imagen para OCR...');
  let envio: Blob = imagen;

  if (optimizar && imagen instanceof File) {
    try {
      const bitmap = await createImageBitmap(imagen).catch(() => null);
      if (bitmap) {
        const { ancho, alto } = dimensionesFactura(bitmap.width, bitmap.height);
        if (ancho < bitmap.width || alto < bitmap.height || imagen.size > 2 * 1024 * 1024) {
          const canvas = document.createElement('canvas');
          canvas.width = ancho;
          canvas.height = alto;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, ancho, alto);
            ctx.drawImage(bitmap, 0, 0, ancho, alto);
            const comprimida = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
            if (comprimida) envio = comprimida;
          }
        }
        bitmap.close();
      }
    } catch {
      /* Continuar con imagen original */
    }
  }

  const base64 = await new Promise<string>((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(',')[1]);
    lector.onerror = () => reject(new Error('No se pudo leer la imagen'));
    lector.readAsDataURL(envio);
  });

  informar?.('Ejecutando RapidOCR Small localmente...');
  const resStr = await invoke<string>('ejecutar_rapidocr', { imagenBase64: base64 })
    .catch((e: unknown) => {
      throw new Error(typeof e === 'string' ? e : 'Error ejecutando RapidOCR.');
    });

  let parsed: ResultadoOCR;
  try { parsed = JSON.parse(resStr) as ResultadoOCR; }
  catch { throw new Error('RapidOCR devolvió una respuesta inválida.'); }
  if (!parsed || typeof parsed.ok !== 'boolean') throw new Error('RapidOCR devolvió una respuesta inválida.');
  if (!parsed.ok) throw new Error(parsed.error || 'RapidOCR no pudo procesar la imagen.');
  return parsed;
}

/** Prueba de conexión con cualquier proveedor (Google AI Studio, OpenRouter o Groq) */
export async function probarConexionIA(proveedor: string, clave: string, modelo: string): Promise<string> {
  if (!modelo.trim()) throw new Error('Seleccione un modelo del catálogo antes de probar la conexión.');
  return invoke<string>('probar_conexion_ia', {
    proveedor: proveedor.toLowerCase().trim(),
    apiKey: clave.trim(),
    modelo: modelo.trim(),
  }).catch((e: unknown) => {
    throw new Error(typeof e === 'string' ? e : 'No se pudo probar la conexión con el proveedor.');
  });
}

/** Analiza el texto OCR con la IA seleccionada y devuelve los productos estructurados */
export async function analizarFacturaOcrIA(
  textoOcr: string,
  proveedor: string,
  clave: string,
  modelo: string,
  productos: Producto[],
  informar?: (mensaje: string) => void
): Promise<FilaFactura[]> {
  if (!textoOcr.trim()) {
    throw new Error('No hay texto de factura para analizar. Ejecute el OCR primero.');
  }
  if (!clave.trim()) {
    throw new Error('Ingrese la API Key del proveedor configurado.');
  }
  if (!modelo.trim()) throw new Error('Seleccione un modelo del catálogo antes de analizar la factura.');

  informar?.(`Analizando texto con IA (${proveedor.toUpperCase()} / ${modelo})...`);
  
  const categorias = Array.from(new Set([
    ...NUEVE_CATEGORIAS_DEFECTO,
    ...productos.map(p => p.categoria).filter(Boolean),
  ]));

  const respuesta = await invoke<string>('analizar_factura_ocr_ia', {
    proveedor: proveedor.toLowerCase().trim(),
    apiKey: clave.trim(),
    modelo: modelo.trim(),
    textoOcr,
    categorias,
  }).catch((e: unknown) => {
    throw new Error(typeof e === 'string' ? e : 'No se pudo analizar la factura con la IA.');
  });

  let datos: unknown;
  try {
    datos = JSON.parse(respuesta);
  } catch {
    throw new Error('La IA devolvió datos que no son un JSON válido. Intente nuevamente.');
  }

  return filasDesdeIA(datos, productos);
}
