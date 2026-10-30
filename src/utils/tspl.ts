import { obtenerConfigNegocio } from './factura';
import { ErrorNegocio, type Producto } from '../database/db';

export interface ItemEtiqueta {
  producto: Producto;
  cantidad: number;
}

// ── Codificación a CP1252 (Latín) ──
// TypeScript's nativo de strings usa UTF-16, TSPL necesita ASCII extendido CP1252 
const removerAcentos = (str: string) => {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

/** Nombre exacto enviado a la etiqueta: sin acentos, en mayúsculas y máximo 16 caracteres. */
export function nombreParaEtiqueta(producto: Producto): string {
  return removerAcentos((producto.nombre_etiqueta || producto.nombre).toUpperCase()).replace(/"/g, "'").slice(0, 16);
}

// Valida un EAN-13 de 13 dígitos (incluye su dígito verificador).
function esEAN13Valido(codigo: string): boolean {
  if (!/^\d{13}$/.test(codigo)) return false;
  let suma = 0;
  for (let i = 0; i < 12; i++) {
    suma += parseInt(codigo[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (suma % 10)) % 10) === codigo[12];
}

/**
 * Función para generar el código "COD..." a partir del precio de compra.
 * Invierte el número y añade ceros a la izquierda hasta 8 caracteres.
 */
export function generarCodigoCosto(precio_compra: number): string {
  const precioEntero = Math.round(precio_compra).toString();
  const invertido = precioEntero.split('').reverse().join('');
  const rellenado = invertido.padStart(8, '0');
  return `COD${rellenado}`;
}

const X_NAME    = [768, 500, 233];
const X_PRICE   = [754, 486, 219];
const X_BARCODE = [750, 482, 215]; // +20 dots para centrar el código de barras
const X_BCTEXT  = [707, 439, 172]; // El texto del código queda en su posición original
const X_COD     = [667, 399, 132];

/**
 * Genera el string con formato TSPL de Bartender para imprimir etiquetas en bloque de 3 columnas.
 */
export function generarTSPL(items: Producto[]): string[] {
  const comandos: string[] = [];

  // Dividir los productos en chunks de 3
  for (let i = 0; i < items.length; i += 3) {
    const batch = items.slice(i, i + 3);
    
    let tspl = "SIZE 97.5 mm, 32 mm\r\n" +
      "DIRECTION 0,0\r\n" +
      "REFERENCE 0,0\r\n" +
      "OFFSET 0 mm\r\n" +
      "SET REWIND OFF\r\n" +
      "SET PEEL OFF\r\n" +
      "SET CUTTER OFF\r\n" +
      "SET PARTIAL_CUTTER OFF\r\n" +
      "SET TEAR ON\r\n" +
      "CLS\r\n" +
      "CODEPAGE 1252\r\n";

    batch.forEach((prod, idx) => {
      // Limpiar texto para evitar conflictos con comillas en TSPL
      const nombreLimpio = nombreParaEtiqueta(prod);
      const fuenteNombre = "2";

      // Tope estricto para asegurar que el nombre siempre quepa en la etiqueta.
      

      const precioVenta = "$" + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Math.round(prod.precio_venta));
      // Precios de 7 dígitos o más no caben en la fuente "4" de la etiqueta
      const fuentePrecio = prod.precio_venta > 999999 ? "3" : "4";
      const codCosto = generarCodigoCosto(prod.precio_compra);
      
      // Asegurar que el código de barras no tenga caracteres inválidos para Code128
      let cb = (prod.codigo_barras || "").trim();
      if (!cb) cb = "00000000"; 

      // Selección de simbología por longitud (máximo 13 dígitos en el sistema):
      //  - <=10 dígitos: Code 128, barras gruesas (narrow 2), sin corrimiento.
      //  - EAN-13 válido: simbología EAN13 gruesa; número con +45 dots.
      //  - 11 y 12: 128M grueso; barcode +15, número +35 dots.
      //  - 13 inválido: 128M grueso; barcode +35, número +50 dots.
      let simbologia = "128";
      let anchoBarras = 2;
      let ajusteBarras = 0;
      let ajusteTexto = 0;
      let cbBarcode = cb;
      let cbTexto = cb;
      if (/^\d{13}$/.test(cb) && esEAN13Valido(cb)) {
        simbologia = "EAN13";
        cbBarcode = cb.slice(0, 12);
        ajusteTexto = 45;
      } else if (cb.length === 11 || cb.length === 12) {
        simbologia = "128M";
        anchoBarras = 2;
        ajusteBarras = 15;
        ajusteTexto = 35;
      } else if (cb.length === 13) {
        simbologia = "128M";
        anchoBarras = 2;
        ajusteBarras = 35;
        ajusteTexto = 50;
      }
      
      tspl += `TEXT ${X_NAME[idx]},168,"${fuenteNombre}",180,1,1,"${nombreLimpio}"\r\n`;
      tspl += `TEXT ${X_PRICE[idx]},138,"${fuentePrecio}",180,1,1,"${precioVenta}"\r\n`;
      tspl += `BARCODE ${X_BARCODE[idx] + ajusteBarras},88,"${simbologia}",37,0,180,${anchoBarras},4,"${cbBarcode}"\r\n`;
      tspl += `TEXT ${X_BCTEXT[idx] + ajusteTexto},41,"2",180,1,1,"${cbTexto}"\r\n`;
      tspl += `TEXT ${X_COD[idx]},203,"1",180,1,2,"${codCosto}"\r\n`;
    });

    tspl += "PRINT 1,1\r\n";
    comandos.push(tspl);
  }

  return comandos;
}

/** ¿El nombre parece una impresora física (no PDF/XPS/Fax)? */
function esImpresoraFisica(nombre: string): boolean {
    return !/pdf|xps|onenote|fax|document writer/i.test(nombre);
}

/**
 * Convierte un string en un arreglo de bytes (Uint8Array) usando Windows-1252 o similar
 */
function stringToBytes(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // Limitar a los 255 del ASCII extendido
    bytes.push(code > 255 ? 63 : code); // 63 es '?'
  }
  return bytes;
}

/**
 * Envía las etiquetas TSPL generadas directamente a la impresora seleccionada en Configuración
 */
export async function imprimirEtiquetasTSPL(items: ItemEtiqueta[]): Promise<void> {
  if (items.some(item => !Number.isSafeInteger(item.cantidad) || item.cantidad <= 0)) {
    throw new ErrorNegocio('CANTIDAD_INVALIDA', 'La cantidad de etiquetas debe ser un entero mayor a 0.');
  }
  // ponytail: expansión existente en memoria; dividir trabajos grandes antes de añadir impresión por lotes.
  if (items.reduce((total, item) => total + item.cantidad, 0) > 50000) {
    throw new ErrorNegocio('DEMASIADAS_ETIQUETAS', 'El trabajo supera 50.000 etiquetas. Divídalo en selecciones más pequeñas.');
  }
  const config = obtenerConfigNegocio();
  if (!config.impresoraEtiquetas || !esImpresoraFisica(config.impresoraEtiquetas)) {
    throw new ErrorNegocio(
      'IMPRESORA_NO_VALIDA',
      'No hay una impresora de etiquetas TSPL seleccionada. Por favor configúrala primero en la sección "Configuración".'
    );
  }

  // Expandir cantidades
  const productosAImprimir: Producto[] = [];
  for (const item of items) {
    for (let i = 0; i < item.cantidad; i++) {
      productosAImprimir.push(item.producto);
    }
  }

  if (productosAImprimir.length === 0) return;

  const comandosTSPL = generarTSPL(productosAImprimir);
  const textoTotal = comandosTSPL.join('');
  const bytes = stringToBytes(textoTotal);

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('imprimir_raw', {
      printerName: config.impresoraEtiquetas,
      data: bytes,
    });
  } catch (err) {
    console.error('Fallo la impresión de etiquetas TSPL:', err);
    throw new ErrorNegocio(
      'ERROR_IMPRESION',
      err instanceof Error ? err.message : String(err)
    );
  }
}
