// ============================================================
//  Impresión térmica nativa por ESC/POS (3nStar RPT005, 80mm)
//  Envía comandos crudos al spooler de Windows (datatype RAW) vía Tauri,
//  usando la fuente nativa de la impresora — igual que el auto-test.
// ============================================================

import {
  obtenerConfigNegocio,
  imprimirFactura,
  sustituirVariables,
  elementosPorDefecto,
  type DatosFactura,
  type ConfigNegocio,
} from './factura';
import { mostrarAlerta } from './alertGlobal';

// Ancho en columnas de la fuente A (12x24) a 80mm. La mayoría de impresoras
// térmicas de 80mm imprimen 48 columnas con la fuente A.
const COLUMNAS = 48;

const fmt = (n: number): string =>
  '$' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Math.round(n));

const esTauri = (): boolean =>
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

// ── Codificación a CP850 (Latín, soporta á é í ó ú ñ Ñ ü ¿ ¡ …) ──
const CP850: Record<string, number> = {
  'Ç': 128, 'ü': 129, 'é': 130, 'â': 131, 'ä': 132, 'à': 133, 'å': 134, 'ç': 135,
  'ê': 136, 'ë': 137, 'è': 138, 'ï': 139, 'î': 140, 'ì': 141, 'Ä': 142, 'Å': 143,
  'É': 144, 'æ': 145, 'Æ': 146, 'ô': 147, 'ö': 148, 'ò': 149, 'û': 150, 'ù': 151,
  'ÿ': 152, 'Ö': 153, 'Ü': 154, 'ø': 155, '£': 156, 'Ø': 157, '×': 158,
  'á': 160, 'í': 161, 'ó': 162, 'ú': 163, 'ñ': 164, 'Ñ': 165, 'ª': 166, 'º': 167,
  '¿': 168, '®': 169, '¬': 170, '½': 171, '¼': 172, '¡': 173, '«': 174, '»': 175,
  'Á': 181, 'Â': 182, 'À': 183, '©': 184, 'ã': 198, 'Ã': 199, '¤': 207,
  'Ê': 210, 'Ë': 211, 'È': 212, 'Í': 214, 'Î': 215, 'Ï': 216,
  'Ì': 222, 'Ó': 224, 'ß': 225, 'Ô': 226, 'Ò': 227, 'õ': 228, 'Õ': 229,
  'µ': 230, 'Ú': 233, 'Û': 234, 'Ù': 235, 'ý': 236, 'Ý': 237, '°': 248, '·': 250,
};

function encodeCP850(texto: string): number[] {
  const out: number[] = [];
  for (const ch of texto) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    const mapeado = CP850[ch];
    if (mapeado !== undefined) {
      out.push(mapeado);
      continue;
    }
    // Respaldo: quitar el acento y usar ASCII; si no, '?'
    const sinAcento = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out.push(sinAcento && sinAcento.charCodeAt(0) < 0x80 ? sinAcento.charCodeAt(0) : 0x3f);
  }
  return out;
}

// ── Constructor de comandos ESC/POS ──
class ESCPOS {
  private bytes: number[] = [];

  raw(...b: number[]): this { this.bytes.push(...b); return this; }
  rawArr(arr: number[]): this { for (let i = 0; i < arr.length; i++) this.bytes.push(arr[i]); return this; }
  text(s: string): this { this.bytes.push(...encodeCP850(s)); return this; }
  line(s = ''): this { this.text(s); this.bytes.push(0x0a); return this; }

  init(): this { return this.raw(0x1b, 0x40); }            // ESC @  (reset)
  codepage(): this { return this.raw(0x1b, 0x74, 2); }     // ESC t 2  (CP850)
  fontA(): this { return this.raw(0x1b, 0x4d, 0); }        // ESC M 0
  align(n: 0 | 1 | 2): this { return this.raw(0x1b, 0x61, n); } // 0=izq,1=centro,2=der
  bold(on: boolean): this { return this.raw(0x1b, 0x45, on ? 1 : 0); }
  /** Magnificación: ancho/alto de 0 (x1) a 7 (x8). GS ! n */
  size(ancho: number, alto: number): this {
    return this.raw(0x1d, 0x21, ((ancho & 0x07) << 4) | (alto & 0x07));
  }
  feed(n = 1): this { for (let i = 0; i < n; i++) this.bytes.push(0x0a); return this; }
  cut(): this { return this.raw(0x1d, 0x56, 66, 0); }      // GS V 66 0  (corte parcial con avance)

  build(): Uint8Array { return new Uint8Array(this.bytes); }
}

// Parte una cadena larga en líneas de ancho máximo (respetando palabras).
function envolver(s: string, ancho: number): string[] {
  const palabras = s.split(/\s+/).filter(Boolean);
  const lineas: string[] = [];
  let actual = '';
  for (const p of palabras) {
    if (actual === '') actual = p;
    else if ((actual + ' ' + p).length <= ancho) actual += ' ' + p;
    else { lineas.push(actual); actual = p; }
    while (actual.length > ancho) { lineas.push(actual.slice(0, ancho)); actual = actual.slice(ancho); }
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [''];
}

// Fila a dos columnas: etiqueta a la izquierda, valor a la derecha.
function fila(b: ESCPOS, izq: string, der: string, ancho = COLUMNAS) {
  const maxIzq = ancho - der.length - 1;
  if (izq.length <= maxIzq) {
    const espacios = ancho - izq.length - der.length;
    b.line(izq + ' '.repeat(Math.max(1, espacios)) + der);
  } else {
    envolver(izq, ancho).forEach((l) => b.line(l));
    b.line(' '.repeat(Math.max(0, ancho - der.length)) + der);
  }
}

/**
 * Magnificación ESC/POS según el tamaño en px del elemento.
 * Devuelve [ancho, alto] (0 = x1, 1 = x2). En filas de dos columnas no se
 * amplía el ancho para no romper el cálculo de 48 columnas.
 */
function magnitud(px: number | undefined, dosColumnas: boolean): [number, number] {
  const p = px ?? 11;
  const alto = p >= 14 ? 1 : 0;
  const ancho = !dosColumnas && p >= 20 ? 1 : 0;
  return [ancho, alto];
}

// ── Conversión de logo a imagen raster ESC/POS (GS v 0) ──

function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen del logo'));
    img.src = src;
  });
}

// Ancho máximo en puntos del cabezal de 80mm (la 3nStar imprime hasta 576).
const ANCHO_MAX_DOTS = 512;
// 8 puntos por mm en impresoras térmicas estándar.
const DOTS_POR_MM = 8;

/**
 * Convierte una imagen (dataURL PNG/JPG) en comandos ESC/POS de imagen raster
 * (GS v 0), monocromo por umbral. Escala según la altura configurada en mm,
 * limitando el ancho al del cabezal. Devuelve el bloque de bytes completo.
 */
async function logoAEscpos(dataUrl: string, altoMm: number): Promise<number[]> {
  const img = await cargarImagen(dataUrl);
  const w0 = img.naturalWidth || ANCHO_MAX_DOTS;
  const h0 = img.naturalHeight || ANCHO_MAX_DOTS;
  const escala = Math.min((altoMm * DOTS_POR_MM) / h0, ANCHO_MAX_DOTS / w0);
  const w = Math.max(1, Math.round(w0 * escala));
  const h = Math.max(1, Math.round(h0 * escala));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  // Empaquetar a bits monocromos: 1 = punto negro (se imprime).
  const anchoBytes = Math.ceil(w / 8);
  const raster: number[] = new Array(anchoBytes * h).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      // Mezcla sobre blanco según alfa; luminancia perceptual.
      const lum = a === 0 ? 255 : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum < 160) raster[y * anchoBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }

  // GS v 0 m xL xH yL yH [datos]
  const cmd = [
    0x1d, 0x76, 0x30, 0,
    anchoBytes & 0xff, (anchoBytes >> 8) & 0xff,
    h & 0xff, (h >> 8) & 0xff,
  ];
  return cmd.concat(raster);
}

/** Construye la tirilla completa como bytes ESC/POS desde tirillaElementos. */
export async function construirTicketESCPOS(datos: DatosFactura, config: ConfigNegocio): Promise<Uint8Array> {
  const b = new ESCPOS();
  const carSep = config.tirillaCarSep || '-';
  const negritaBase = config.ticketNegrita !== false;
  const elementos = config.tirillaElementos?.length ? config.tirillaElementos : elementosPorDefecto();

  b.init().codepage().fontA();

  for (const el of elementos.filter((e) => e.visible !== false)) {
    if (el.tipo === 'separador') {
      const c = el.char && el.char.length ? el.char : carSep;
      const linea = c.repeat(COLUMNAS).slice(0, COLUMNAS);
      b.align(0).bold(false).size(0, 0);
      b.line(linea);
      if (el.doble) b.line(linea);
      continue;
    }
    if (el.tipo === 'logo') {
      if (config.tirillaLogoBase64) {
        try {
          const bytes = await logoAEscpos(config.tirillaLogoBase64, config.tirillaLogoAlto || 20);
          if (bytes.length) b.align(1).rawArr(bytes).align(0).feed(1);
        } catch (e) {
          console.error('No se pudo convertir el logo a ESC/POS:', e);
        }
      }
      continue;
    }
    if (el.tipo === 'espacio') {
      b.feed(1);
      continue;
    }
    if (el.tipo === 'items') {
      const [, alto] = magnitud(el.size, true);
      b.align(0).bold(el.bold ?? false).size(0, alto);
      datos.items.forEach((it) => {
        fila(b, `${it.cantidad} ${it.nombre}`, fmt(it.subtotal));
      });
      b.size(0, 0).bold(false);
      continue;
    }
    // texto
    const { text, skip } = sustituirVariables(el.texto ?? '', datos, config);
    if (skip || !text.trim()) continue;
    b.bold(el.bold ?? negritaBase);
    if (text.includes('{>}')) {
      const [izq, der = ''] = text.split('{>}');
      const [, alto] = magnitud(el.size, true);
      b.align(0).size(0, alto);
      fila(b, izq.replace(/\n/g, ' '), der.replace(/\n/g, ' '));
    } else {
      const [ancho, alto] = magnitud(el.size, false);
      b.size(ancho, alto);
      b.align(el.align === 'center' ? 1 : el.align === 'right' ? 2 : 0);
      const cols = ancho ? Math.floor(COLUMNAS / 2) : COLUMNAS;
      text.split('\n').forEach((seg) => envolver(seg, cols).forEach((l) => b.line(l)));
    }
    b.size(0, 0).align(0);
  }

  b.bold(false);
  b.feed(2).cut();
  return b.build();
}

/** ¿El nombre parece una impresora física (no PDF/XPS/Fax)? */
function esImpresoraFisica(nombre: string): boolean {
  return !/pdf|xps|onenote|fax|document writer/i.test(nombre);
}

/**
 * Imprime la tirilla en la impresora térmica vía ESC/POS nativo.
 * Si no hay entorno Tauri / impresora válida o falla, cae a la impresión HTML.
 */
export async function imprimirTicketTermico(datos: DatosFactura): Promise<void> {
  const config = obtenerConfigNegocio();

  if (esTauri() && config.impresora && esImpresoraFisica(config.impresora)) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const bytes = await construirTicketESCPOS(datos, config);
      await invoke('imprimir_raw', {
        printerName: config.impresora,
        data: Array.from(bytes),
      });
      return;
    } catch (err) {
      console.error('Fallo la impresión ESC/POS, se usará HTML:', err);
      mostrarAlerta(
        'No se pudo imprimir por ESC/POS: ' +
          (err instanceof Error ? err.message : String(err)) +
          '\n\nVerifica el nombre de la impresora en Configuración. Se usará la impresión normal.',
        'advertencia'
      );
    }
  }

  // Respaldo: impresión HTML (navegador / sin impresora térmica configurada)
  await imprimirFactura(datos, 'ticket');
}

/** Lista las impresoras instaladas en Windows (vacío en navegador). */
export async function listarImpresoras(): Promise<string[]> {
  if (!esTauri()) return [];
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string[]>('listar_impresoras');
  } catch (err) {
    console.error('No se pudieron listar las impresoras:', err);
    return [];
  }
}

/** Imprime una tirilla de prueba (incluye acentos y ñ para verificar codepage). */
export async function imprimirPruebaTermica(): Promise<void> {
  const datos: DatosFactura = {
    folio: 'PRUEBA-001',
    fecha: new Date().toLocaleString('es-CO'),
    cliente: 'CONSUMIDOR FINAL',
    clienteDoc: '222222222222',
    items: [
      { nombre: 'Pan tajado pequeño', precio: 4500, cantidad: 2, subtotal: 9000 },
      { nombre: 'Café El Ñandú 250g', precio: 12000, cantidad: 1, subtotal: 12000 },
      { nombre: 'Jabón antibacterial', precio: 3500, cantidad: 3, subtotal: 10500 },
    ],
    subtotal: 31500,
    descuento: 1500,
    total: 30000,
    formaPago: 'Efectivo',
    pagoCon: 50000,
  };
  await imprimirTicketTermico(datos);
}
