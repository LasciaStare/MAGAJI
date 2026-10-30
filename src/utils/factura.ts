// ============================================================
//  Generación de facturas — Sistema POS Inventario
//  Dos formatos:
//   • 'ticket'      → Tirilla 80mm para impresora térmica (3nStar RPT005, ESC/POS)
//   • 'electronica' → Representación gráfica de factura electrónica (carta, con QR + CUFE + IVA)
// ============================================================

import { mostrarAlerta } from './alertGlobal';

export interface ItemFactura {
  nombre: string;
  precio: number;
  cantidad: number;
  subtotal: number;
}

export interface DatosFactura {
  folio?: string;
  fecha: string;          // ya formateada como texto
  cliente: string;
  clienteDoc?: string;    // CC / NIT del comprador
  clienteDocLabel?: string; // Etiqueta del documento (C.C/NIT, Cod Fundación, etc.)
  items: ItemFactura[];
  subtotal: number;       // suma de subtotales (antes de descuento)
  descuento: number;
  total: number;          // total cobrado
  formaPago?: string;     // 'Efectivo' por defecto
  pagoCon?: number;       // efectivo recibido (para calcular cambio)
  comentario?: string;    // nota libre del cajero, aparece en la tirilla
}

export type FormatoFactura = 'ticket' | 'electronica';

// ── Diseño de la tirilla: lista ordenada y editable de elementos ──
export type TipoElemento = 'texto' | 'separador' | 'items' | 'logo' | 'espacio';
export type AlineacionElemento = 'left' | 'center' | 'right';

export interface ElementoTirilla {
  id: string;
  tipo: TipoElemento;
  visible: boolean;
  /** Para 'texto' e 'items' (encabezado): plantilla con {variables} y {>} */
  texto?: string;
  align?: AlineacionElemento;   // alineación (texto sin {>})
  size?: number;                // tamaño base en px (también alto del espacio)
  bold?: boolean;               // negrita forzada en este elemento
  doble?: boolean;              // separador de doble línea
  char?: string;                // separador: carácter propio (si no, usa el global)
}

// ── Configuración del negocio + diseño de la tirilla ──
export interface ConfigNegocio {
  nombre: string;
  nit: string;
  telefono: string;
  direccion: string;
  ciudad: string;
  resolucion: string;
  regimen: string;
  ivaPorcentaje: number;
  piePagina: string;
  papel: string;
  impresora: string;
  impresoraEtiquetas?: string;
  ticketEscala: number;
  ticketNegrita: boolean;
  tirillaFuente: string;
  tirillaCarSep: string;
  tirillaLogoBase64: string;
  tirillaLogoAlto: number;
  tirillaElementos: ElementoTirilla[];
  aiProveedor?: 'google' | 'openrouter' | 'groq';
  aiApiKey?: string;
  aiModelo?: string;
}

export const NUEVE_CATEGORIAS_DEFECTO = [
  'TECNOLOGÍA',
  'HOGAR',
  'ELECTRODOMÉSTICOS',
  'JUGUETES Y DEPORTES',
  'ACCESORIOS',
  'ROPA',
  'FERRETERÍA',
  'CALZADO',
  'ASEO Y CUIDADO PERSONAL',
] as const;

/** Variables que el usuario puede insertar en los textos de la tirilla. */
export const VARIABLES_TIRILLA: { token: string; descripcion: string }[] = [
  { token: '{nombre}', descripcion: 'Nombre del negocio' },
  { token: '{nit}', descripcion: 'NIT / RUC' },
  { token: '{telefono}', descripcion: 'Teléfono' },
  { token: '{direccion}', descripcion: 'Dirección' },
  { token: '{ciudad}', descripcion: 'Ciudad' },
  { token: '{resolucion}', descripcion: 'Resolución DIAN' },
  { token: '{regimen}', descripcion: 'Régimen de IVA' },
  { token: '{iva}', descripcion: 'Porcentaje de IVA' },
  { token: '{folio}', descripcion: 'N° de venta / folio' },
  { token: '{fecha}', descripcion: 'Fecha y hora' },
  { token: '{cliente}', descripcion: 'Nombre del cliente' },
  { token: '{clienteDoc}', descripcion: 'Documento del cliente' },
  { token: '{clienteDocLabel}', descripcion: 'Etiqueta del documento (C.C/NIT, Cod Fundación, etc.)' },
  { token: '{subtotal}', descripcion: 'Subtotal' },
  { token: '{descuento}', descripcion: 'Descuento (vacío si es 0)' },
  { token: '{total}', descripcion: 'Total a pagar' },
  { token: '{formaPago}', descripcion: 'Forma de pago' },
  { token: '{pagoCon}', descripcion: 'Pagó con' },
  { token: '{cambio}', descripcion: 'Cambio' },
  { token: '{piePagina}', descripcion: 'Mensaje de pie' },
  { token: '{comentario}', descripcion: 'Comentario / nota de la venta' },
];

const CONFIG_KEY = 'pos_config';

/** Diseño por defecto de la tirilla (reproduce el formato POS clásico). */
export function elementosPorDefecto(): ElementoTirilla[] {
  return [
    { id: 'logo', tipo: 'logo', visible: true, size: 20 },
    { id: 'nombre', tipo: 'texto', visible: true, texto: '{nombre}', align: 'center', size: 17, bold: true },
    { id: 'nit', tipo: 'texto', visible: true, texto: 'NIT: {nit}', align: 'center', size: 11 },
    { id: 'dir', tipo: 'texto', visible: true, texto: '{direccion}', align: 'center', size: 11 },
    { id: 'ciudad', tipo: 'texto', visible: true, texto: '{ciudad}', align: 'center', size: 11 },
    { id: 'tel', tipo: 'texto', visible: true, texto: 'Tel: {telefono}', align: 'center', size: 11 },
    { id: 'resol', tipo: 'texto', visible: true, texto: '{resolucion?}', align: 'center', size: 11 },
    { id: 'regimen', tipo: 'texto', visible: true, texto: '{regimen}', align: 'center', size: 11 },
    { id: 'sep1', tipo: 'separador', visible: true, doble: true },
    { id: 'titulo', tipo: 'texto', visible: true, texto: 'FACTURA DE VENTA POS', align: 'center', size: 14, bold: true },
    { id: 'folio', tipo: 'texto', visible: true, texto: '{folio?}', align: 'center', size: 12, bold: true },
    { id: 'sep2', tipo: 'separador', visible: true },
    { id: 'fecha', tipo: 'texto', visible: true, texto: 'Fecha:   {fecha}', align: 'left', size: 11 },
    { id: 'cliente', tipo: 'texto', visible: true, texto: 'Cliente: {cliente}', align: 'left', size: 11 },
    { id: 'doc', tipo: 'texto', visible: true, texto: '{clienteDocLabel}: {clienteDoc?}', align: 'left', size: 11 },
    { id: 'sep3', tipo: 'separador', visible: true },
    { id: 'itemsHdr', tipo: 'texto', visible: true, texto: 'Cant Descripción{>}Valor', size: 11, bold: true },
    { id: 'sepCols', tipo: 'separador', visible: true },
    { id: 'items', tipo: 'items', visible: true, size: 11 },
    { id: 'sep4', tipo: 'separador', visible: true },
    { id: 'subtotal', tipo: 'texto', visible: true, texto: 'SUBTOTAL{>}{subtotal}', size: 12 },
    { id: 'descuento', tipo: 'texto', visible: true, texto: 'DESCUENTO{>}-{descuento?}', size: 12 },
    { id: 'total', tipo: 'texto', visible: true, texto: 'TOTAL:{>}{total}', size: 17, bold: true },
    { id: 'sep5', tipo: 'separador', visible: true, doble: true },
    { id: 'pagohdr', tipo: 'texto', visible: true, texto: 'Forma de Pago', align: 'center', size: 12, bold: true },
    { id: 'pago', tipo: 'texto', visible: true, texto: '{formaPago}{>}{pagoCon}', size: 12 },
    { id: 'cambio', tipo: 'texto', visible: true, texto: 'Cambio{>}{cambio}', size: 12 },
    { id: 'sep6', tipo: 'separador', visible: true },
    { id: 'comentario', tipo: 'texto', visible: true, texto: '{comentario?}', align: 'center', size: 11 },
    { id: 'pie', tipo: 'texto', visible: true, texto: '{piePagina}', align: 'center', size: 11 },
    { id: 'pie2', tipo: 'texto', visible: true, texto: 'Generado por Magaji', align: 'center', size: 11 },
  ];
}

export const CONFIG_DEFAULT: ConfigNegocio = {
  nombre: 'Mi Tienda',
  nit: '123456789',
  telefono: '(300) 123-4567',
  direccion: 'Calle Falsa 123, Ciudad',
  ciudad: 'Bogotá - Colombia',
  resolucion: '',
  regimen: 'Responsable de IVA',
  ivaPorcentaje: 19,
  piePagina: '¡Gracias por su compra!',
  papel: 'Ticket (80mm)',
  impresora: 'POS-80C',
  impresoraEtiquetas: '',
  ticketEscala: 1,
  ticketNegrita: true,
  tirillaFuente: "'Courier New', Consolas, monospace",
  tirillaCarSep: '-',
  tirillaLogoBase64: '',
  tirillaLogoAlto: 20,
  tirillaElementos: elementosPorDefecto(),
  aiProveedor: 'google',
  aiApiKey: '',
  aiModelo: '',
};

/**
 * Migra layouts guardados con el formato antiguo, donde el elemento `items`
 * incluía cabecera de columnas + línea. Lo divide en: texto (cabecera) +
 * separador (línea editable) + items (solo filas). Idempotente.
 */
function migrarElementos(arr: ElementoTirilla[]): ElementoTirilla[] {
  const out: ElementoTirilla[] = [];
  for (const el of arr) {
    if (el.tipo === 'items' && el.texto && el.texto.trim()) {
      out.push({ id: `${el.id}-hdr`, tipo: 'texto', visible: el.visible, texto: el.texto, size: el.size, bold: el.bold ?? true });
      out.push({ id: `${el.id}-sep`, tipo: 'separador', visible: el.visible });
      out.push({ id: el.id, tipo: 'items', visible: el.visible, size: el.size });
    } else {
      out.push(el);
    }
  }
  return out;
}

/** Inyecta el elemento 'comentario' en layouts guardados que aún no lo tienen. */
function ensureComentarioElemento(arr: ElementoTirilla[]): ElementoTirilla[] {
  if (arr.some((e) => e.id === 'comentario')) return arr;
  // Insertar después de sep6 (antes de pie de página); si no existe, al final.
  const refIdx = arr.findIndex((e) => e.id === 'sep6');
  const insertIdx = refIdx >= 0 ? refIdx + 1 : arr.length;
  const nuevo: ElementoTirilla = { id: 'comentario', tipo: 'texto', visible: true, texto: '{comentario?}', align: 'center', size: 11 };
  return [...arr.slice(0, insertIdx), nuevo, ...arr.slice(insertIdx)];
}

/** Migra el elemento 'doc' antiguo 'C.C/NIT: {clienteDoc?}' al formato dinámico '{clienteDocLabel}: {clienteDoc?}' */
function migrarDocElemento(arr: ElementoTirilla[]): ElementoTirilla[] {
  return arr.map((el) => {
    if (el.id === 'doc' && el.texto === 'C.C/NIT: {clienteDoc?}') {
      return { ...el, texto: '{clienteDocLabel}: {clienteDoc?}' };
    }
    return el;
  });
}

export function obtenerConfigNegocio(): ConfigNegocio {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...CONFIG_DEFAULT, tirillaElementos: elementosPorDefecto() };
    const stored = JSON.parse(raw) as Partial<ConfigNegocio>;
    const elementos = Array.isArray(stored.tirillaElementos) && stored.tirillaElementos.length > 0
      ? migrarDocElemento(ensureComentarioElemento(migrarElementos(stored.tirillaElementos)))
      : elementosPorDefecto();
    return { ...CONFIG_DEFAULT, ...stored, tirillaElementos: elementos };
  } catch {
    return { ...CONFIG_DEFAULT, tirillaElementos: elementosPorDefecto() };
  }
}

/**
 * Sustituye las variables {x} de una plantilla por sus valores reales.
 * Sintaxis especial:
 *   {var}   → valor de la variable
 *   {var?}  → si el valor está vacío, se omite TODA la línea (devuelve skip:true)
 *   {>}     → marca de columna derecha (se conserva para alinear a la derecha)
 */
export function sustituirVariables(
  texto: string,
  datos: DatosFactura,
  config: ConfigNegocio,
): { text: string; skip: boolean } {
  const cambio = datos.pagoCon != null ? Math.max(0, datos.pagoCon - datos.total) : 0;
  const vals: Record<string, string> = {
    nombre: config.nombre,
    nit: config.nit,
    telefono: config.telefono,
    direccion: config.direccion,
    ciudad: config.ciudad,
    resolucion: config.resolucion,
    regimen: config.regimen,
    iva: String(config.ivaPorcentaje),
    folio: datos.folio ?? '',
    fecha: datos.fecha,
    cliente: datos.cliente,
    clienteDoc: datos.clienteDoc ?? '',
    clienteDocLabel: datos.clienteDocLabel ?? 'C.C/NIT',
    subtotal: fmt(datos.subtotal),
    descuento: datos.descuento > 0 ? fmt(datos.descuento) : '',
    total: fmt(datos.total),
    formaPago: datos.formaPago ?? 'Efectivo',
    pagoCon: fmt(datos.pagoCon ?? datos.total),
    cambio: fmt(cambio),
    piePagina: config.piePagina,
    comentario: datos.comentario ?? '',
  };
  let skip = false;
  const text = texto.replace(/\{(\w+)(\?)?\}/g, (match, clave: string, opcional?: string) => {
    if (!(clave in vals)) return match; // variable desconocida → se deja literal
    const v = vals[clave];
    if (opcional && v === '') skip = true;
    return v;
  });
  return { text, skip };
}

export function guardarConfigNegocio(config: ConfigNegocio): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

// ── Helpers de formato ──

/** Formato de moneda en pesos colombianos, sin decimales. */
function fmt(n: number): string {
  return '$' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Math.round(n));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Descompone un total que YA incluye IVA en base gravable + IVA. */
function discriminarIVA(total: number, porcentaje: number) {
  if (porcentaje <= 0) return { base: total, iva: 0 };
  const base = total / (1 + porcentaje / 100);
  return { base, iva: total - base };
}

/** Calcula un CUFE (Código Único de Factura Electrónica) representativo vía SHA-256. */
async function calcularCUFE(datos: DatosFactura, config: ConfigNegocio): Promise<string> {
  const base = [
    config.nit,
    datos.folio ?? '',
    datos.fecha,
    datos.total.toFixed(2),
    datos.subtotal.toFixed(2),
    config.ivaPorcentaje,
    datos.clienteDoc ?? datos.cliente,
  ].join('|');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Genera un código QR como data URL (PNG). */
async function generarQR(texto: string): Promise<string> {
  const QRCode = (await import('qrcode')).default;
  return QRCode.toDataURL(texto, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
}

// ============================================================
//  IMPRESIÓN (HTML en iframe oculto → diálogo de impresión)
// ============================================================

/**
 * Imprime la factura. Por defecto usa el formato de tirilla térmica 80mm,
 * compatible con la impresora 3nStar RPT005.
 */
export async function imprimirFactura(datos: DatosFactura, formato: FormatoFactura = 'ticket') {
  const config = obtenerConfigNegocio();
  const html = formato === 'electronica'
    ? await buildElectronicaHTML(datos, config)
    : buildTicketHTML(datos, config);

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
  document.body.appendChild(iframe);

  iframe.contentDocument!.open();
  iframe.contentDocument!.write(html);
  iframe.contentDocument!.close();

  iframe.onload = () => {
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    setTimeout(() => document.body.removeChild(iframe), 2000);
  };
}

// ── Tirilla térmica 80mm (estilo POS) — renderizada desde tirillaElementos ──
export function buildTicketHTML(datos: DatosFactura, config: ConfigNegocio): string {
  const elementos = config.tirillaElementos?.length ? config.tirillaElementos : elementosPorDefecto();
  const s = config.ticketEscala > 0 ? config.ticketEscala : 1;
  const pesoBase = config.ticketNegrita === false ? 'normal' : 'bold';
  const px = (n: number) => `${(n * s).toFixed(1)}px`;
  const fuente = config.tirillaFuente || "'Courier New', Consolas, monospace";
  const carSep = config.tirillaCarSep || '-';
  const logoAltoMm = config.tirillaLogoAlto || 20;
  const br = (t: string) => escapeHtml(t).replace(/\n/g, '<br>');
  const pesoDe = (el: ElementoTirilla) => (el.bold ? 'bold' : pesoBase);

  const cuerpo = elementos
    .filter((el) => el.visible !== false)
    .map((el) => {
      if (el.tipo === 'separador') {
        const c = el.char && el.char.length ? el.char : carSep;
        const ln = `<div class="sep-ln">${escapeHtml(c.repeat(60))}</div>`;
        return el.doble ? ln + ln : ln;
      }
      if (el.tipo === 'logo') {
        return config.tirillaLogoBase64
          ? `<img class="logo" style="height:${logoAltoMm}mm" src="${config.tirillaLogoBase64}" alt="logo">`
          : '';
      }
      if (el.tipo === 'espacio') {
        return `<div style="height:${px(el.size ?? 8)}"></div>`;
      }
      if (el.tipo === 'items') {
        const fs = px(el.size ?? 11);
        const fw = pesoDe(el);
        const filas = datos.items
          .map((it) => {
            return `<tr><td class="c">${it.cantidad}</td><td class="d">${escapeHtml(it.nombre)}</td><td class="v">${fmt(it.subtotal)}</td></tr>`;
          })
          .join('');
        return `<table style="font-size:${fs};font-weight:${fw}"><tbody>${filas}</tbody></table>`;
      }
      // texto
      const { text, skip } = sustituirVariables(el.texto ?? '', datos, config);
      if (skip || !text.trim()) return '';
      const fs = px(el.size ?? 11);
      const fw = pesoDe(el);
      if (text.includes('{>}')) {
        const [izq, der = ''] = text.split('{>}');
        return `<div class="rowlr" style="font-size:${fs};font-weight:${fw}"><span>${br(izq)}</span><span>${br(der)}</span></div>`;
      }
      const al = el.align ?? 'left';
      return `<div style="text-align:${al};font-size:${fs};font-weight:${fw}">${br(text)}</div>`;
    })
    .join('\n');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tirilla</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 80mm; color: #000; background: #fff;
      font-family: ${fuente}; font-weight: ${pesoBase}; line-height: 1.3;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
      text-rendering: geometricPrecision; -webkit-font-smoothing: none; font-smooth: never;
    }
    body { padding: 3mm 4mm 3mm; font-size: ${px(12)}; }
    .sep-ln { overflow: hidden; white-space: nowrap; font-size: ${px(11)}; margin: ${px(2)} 0; line-height: 1.1; }
    .rowlr { display: flex; justify-content: space-between; gap: ${px(6)}; padding: 1px 0; }
    .rowlr span:last-child { text-align: right; white-space: nowrap; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: ${px(3)} 0; border-bottom: 1px solid #000; }
    td { padding: ${px(3)} 0; vertical-align: top; }
    td.c, th.c { width: ${px(26)}; text-align: left; }
    td.v, th.v { text-align: right; white-space: nowrap; padding-left: ${px(3)}; }
    td.d { padding-right: ${px(4)}; word-break: break-word; }
    .logo { display: block; max-width: 100%; object-fit: contain; margin: 0 auto ${px(4)} auto; }
  </style></head><body>
${cuerpo}
  </body></html>`;
}

// ── Factura electrónica (carta) en HTML, para impresión opcional ──
async function buildElectronicaHTML(datos: DatosFactura, config: ConfigNegocio): Promise<string> {
  const cufe = await calcularCUFE(datos, config);
  const { base, iva } = discriminarIVA(datos.total, config.ivaPorcentaje);
  const qrTexto = `NumFac:${datos.folio ?? ''}|NitFac:${config.nit}|DocAdq:${datos.clienteDoc ?? ''}|ValTot:${datos.total.toFixed(2)}|CUFE:${cufe}`;
  const qr = await generarQR(qrTexto);

  const filas = datos.items.map((item, idx) => `
    <tr style="background:${idx % 2 === 0 ? '#f8fafc' : '#fff'}">
      <td>${idx + 1}</td>
      <td>${escapeHtml(item.nombre)}</td>
      <td class="r">${item.cantidad}</td>
      <td class="r">${fmt(item.precio)}</td>
      <td class="r"><strong>${fmt(item.subtotal)}</strong></td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Factura Electrónica</title>
  <style>
    @page { size: letter; margin: 14mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; font-size: 12px; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
    .neg h1 { font-size: 20px; color: #059669; margin-bottom: 4px; }
    .neg p { font-size: 11px; color: #475569; }
    .doc { text-align: right; }
    .doc .badge { display: inline-block; border: 2px solid #059669; color: #059669; font-weight: bold; padding: 6px 14px; border-radius: 8px; font-size: 13px; }
    .doc .folio { font-size: 16px; font-weight: bold; margin-top: 6px; }
    .qr { width: 90px; height: 90px; margin-top: 8px; }
    .cliente { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; font-size: 12px; }
    .cliente b { color: #64748b; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    th { background: #059669; color: #fff; padding: 8px 10px; text-align: left; font-size: 11px; }
    th.r, td.r { text-align: right; }
    td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
    .totales { display: flex; justify-content: flex-end; }
    .tbox { width: 280px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .trow { display: flex; justify-content: space-between; padding: 8px 14px; font-size: 12px; border-bottom: 1px solid #e2e8f0; }
    .trow.fin { background: #ecfdf5; font-size: 15px; font-weight: bold; color: #059669; border-bottom: none; }
    .pago { margin-top: 14px; font-size: 12px; color: #475569; }
    .cufe { margin-top: 18px; border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 9px; color: #64748b; word-break: break-all; }
    .cufe b { color: #1e293b; }
    .foot { margin-top: 14px; text-align: center; font-size: 10px; color: #94a3b8; }
  </style></head><body>
    <div class="top">
      <div class="neg">
        <h1>${escapeHtml(config.nombre)}</h1>
        <p>NIT: ${escapeHtml(config.nit)}</p>
        <p>${escapeHtml(config.direccion)} — ${escapeHtml(config.ciudad)}</p>
        <p>Tel: ${escapeHtml(config.telefono)}</p>
        ${config.resolucion ? `<p>${escapeHtml(config.resolucion)}</p>` : ''}
        <p>${escapeHtml(config.regimen)}</p>
      </div>
      <div class="doc">
        <span class="badge">FACTURA ELECTRÓNICA DE VENTA</span>
        ${datos.folio ? `<div class="folio">No. ${escapeHtml(datos.folio)}</div>` : ''}
        <div><img class="qr" src="${qr}" alt="QR"></div>
      </div>
    </div>
    <div class="cliente">
      <div><b>Cliente:</b> ${escapeHtml(datos.cliente)}</div>
      <div><b>${escapeHtml(datos.clienteDocLabel ?? 'C.C / NIT')}:</b> ${escapeHtml(datos.clienteDoc ?? 'No registrado')}</div>
      <div><b>Fecha de generación:</b> ${escapeHtml(datos.fecha)}</div>
      <div><b>Forma de pago:</b> ${escapeHtml(datos.formaPago ?? 'Efectivo / Contado')}</div>
    </div>
    <table>
      <thead><tr><th>Ítem</th><th>Descripción</th><th class="r">Cant.</th><th class="r">Vr. Unit.</th><th class="r">Vr. Total</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <div class="totales"><div class="tbox">
      <div class="trow"><span>Total Bruto</span><span>${fmt(base)}</span></div>
      <div class="trow"><span>IVA ${config.ivaPorcentaje}%</span><span>${fmt(iva)}</span></div>
      ${datos.descuento > 0 ? `<div class="trow"><span>Descuento</span><span>-${fmt(datos.descuento)}</span></div>` : ''}
      <div class="trow fin"><span>Total a Pagar</span><span>${fmt(datos.total)}</span></div>
    </div></div>
    <div class="cufe"><b>CUFE:</b> ${cufe}</div>
    <div class="foot">Representación gráfica de factura electrónica · Generado por Magaji</div>
  </body></html>`;
}

// ============================================================
//  GENERACIÓN DE PDF (jsPDF, salida vectorial nítida)
// ============================================================

/** Genera y descarga un PDF de la factura en el formato indicado. */
export async function descargarPDFFactura(datos: DatosFactura, formato: FormatoFactura = 'ticket') {
  const config = obtenerConfigNegocio();
  if (formato === 'electronica') {
    await pdfElectronica(datos, config);
  } else {
    await pdfTicket(datos, config);
  }
}

/**
 * Entrega el PDF generado. Dentro del WebView de Tauri `doc.save()` no descarga
 * nada (no hay gestor de descargas), por lo que escribimos el archivo en la
 * carpeta de Descargas con el plugin fs y lo abrimos. En un navegador normal
 * (`npm run dev`) se usa la descarga estándar del navegador.
 */
async function entregarPDF(doc: import('jspdf').jsPDF, filename: string) {
  const esTauri = typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  if (!esTauri) {
    doc.save(filename);
    return;
  }

  try {
    const bytes = new Uint8Array(doc.output('arraybuffer'));
    const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await writeFile(filename, bytes, { baseDir: BaseDirectory.Download });

    // Intentar abrir el PDF recién guardado (mejor esfuerzo)
    try {
      const { downloadDir, join } = await import('@tauri-apps/api/path');
      const { openPath } = await import('@tauri-apps/plugin-opener');
      const rutaCompleta = await join(await downloadDir(), filename);
      await openPath(rutaCompleta);
    } catch (errAbrir) {
      console.warn('PDF guardado pero no se pudo abrir automáticamente:', errAbrir);
      mostrarAlerta(`PDF guardado en tu carpeta de Descargas: ${filename}`, 'info');
    }
  } catch (err) {
    console.error('No se pudo guardar el PDF con Tauri, intentando descarga del navegador:', err);
    try {
      doc.save(filename);
    } catch {
      mostrarAlerta('No se pudo guardar el PDF: ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  }
}

// ── PDF tirilla 80mm ──
async function pdfTicket(datos: DatosFactura, config: ConfigNegocio) {
  const { jsPDF } = await import('jspdf');

  // Doble pasada: 1) medir altura real, 2) renderizar en una página a la medida.
  const medidor = new jsPDF({ unit: 'mm', format: [80, 2000] });
  const alturaContenido = renderTicket(medidor, datos, config);

  const alturaPagina = Math.max(alturaContenido + 6, 90);
  const doc = new jsPDF({ unit: 'mm', format: [80, alturaPagina] });
  renderTicket(doc, datos, config);

  await entregarPDF(doc, nombreArchivo(datos, 'ticket'));
}

/** Dibuja la tirilla en el doc desde tirillaElementos y devuelve la Y final (mm). */
function renderTicket(doc: import('jspdf').jsPDF, datos: DatosFactura, config: ConfigNegocio): number {
  const W = 80, left = 4, right = 76, center = W / 2;
  const ancho = right - left;
  let y = 3 + 4; // 3mm de padding superior + 4mm

  const elementos = config.tirillaElementos?.length ? config.tirillaElementos : elementosPorDefecto();
  const s = config.ticketEscala > 0 ? config.ticketEscala : 1;
  const carSep = config.tirillaCarSep || '-';
  const negritaBase = config.ticketNegrita !== false;
  // px → pt (factor calibrado para que coincida con el formato POS clásico)
  const pt = (px?: number) => Math.max(5, (px ?? 11) * s * 0.78);
  const lh = (px?: number) => pt(px) * 0.42 + 0.6; // alto de línea en mm

  doc.setTextColor(0, 0, 0);

  const sepLine = (char: string = carSep) => {
    doc.setFont('courier', 'normal');
    doc.setFontSize(8 * s);
    const str = doc.splitTextToSize(char.repeat(120), ancho)[0] ?? '';
    doc.text(str, left, y);
    y += 3.1 * s;
  };

  for (const el of elementos.filter((e) => e.visible !== false)) {
    if (el.tipo === 'separador') {
      const c = el.char && el.char.length ? el.char : carSep;
      sepLine(c);
      if (el.doble) sepLine(c);
      continue;
    }
    if (el.tipo === 'espacio') {
      y += (el.size ?? 8) * s * 0.35;
      continue;
    }
    if (el.tipo === 'logo') {
      if (config.tirillaLogoBase64) {
        const h = config.tirillaLogoAlto || 20;
        const w = Math.min(h * 3, ancho);
        try { doc.addImage(config.tirillaLogoBase64, center - w / 2, y, w, h); } catch { /* formato no soportado */ }
        y += h + 2;
      }
      continue;
    }
    if (el.tipo === 'items') {
      doc.setFont('courier', el.bold ? 'bold' : 'normal');
      doc.setFontSize(pt(el.size));
      datos.items.forEach((item) => {
        const desc = `${item.cantidad}  ${item.nombre}`;
        const lineas: string[] = doc.splitTextToSize(desc, ancho - 14);
        doc.text(lineas[0], left, y);
        doc.text(fmt(item.subtotal), right, y, { align: 'right' });
        y += lh(el.size);
        for (let i = 1; i < lineas.length; i++) { doc.text(lineas[i], left, y); y += lh(el.size); }
      });
      continue;
    }
    // texto
    const { text, skip } = sustituirVariables(el.texto ?? '', datos, config);
    if (skip || !text.trim()) continue;
    doc.setFont('courier', (el.bold ?? negritaBase) ? 'bold' : 'normal');
    doc.setFontSize(pt(el.size));
    if (text.includes('{>}')) {
      const [izq, der = ''] = text.split('{>}');
      doc.text(izq.replace(/\n/g, ' '), left, y);
      doc.text(der.replace(/\n/g, ' '), right, y, { align: 'right' });
      y += lh(el.size);
    } else {
      const al = el.align ?? 'left';
      const x = al === 'center' ? center : al === 'right' ? right : left;
      const opt = al === 'left' ? undefined : { align: al as 'center' | 'right' };
      text.split('\n').forEach((seg) => {
        doc.splitTextToSize(seg, ancho).forEach((l: string) => { doc.text(l, x, y, opt); y += lh(el.size); });
      });
    }
  }

  return y;
}

// ── PDF factura electrónica (carta) ──
async function pdfElectronica(datos: DatosFactura, config: ConfigNegocio) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

  const cufe = await calcularCUFE(datos, config);
  const { base, iva } = discriminarIVA(datos.total, config.ivaPorcentaje);
  const qrTexto = `NumFac:${datos.folio ?? ''}|NitFac:${config.nit}|DocAdq:${datos.clienteDoc ?? ''}|ValTot:${datos.total.toFixed(2)}|CUFE:${cufe}`;
  const qr = await generarQR(qrTexto);

  const PW = doc.internal.pageSize.getWidth();   // ~215.9mm carta
  const margen = 14;
  const ancho = PW - margen * 2;
  let y = margen;

  // Cabecera: negocio (izq) + documento/QR (der)
  doc.setTextColor(5, 150, 105);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(config.nombre, margen, y + 4);

  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  let yi = y + 10;
  const negocioInfo = [
    `NIT: ${config.nit}`,
    `${config.direccion} — ${config.ciudad}`,
    `Tel: ${config.telefono}`,
    ...(config.resolucion ? [config.resolucion] : []),
    config.regimen,
  ];
  negocioInfo.forEach((t) => { doc.text(t, margen, yi); yi += 4; });

  // Badge documento (derecha)
  doc.setDrawColor(5, 150, 105);
  doc.setLineWidth(0.5);
  doc.roundedRect(PW - margen - 62, y, 62, 9, 1.5, 1.5, 'S');
  doc.setTextColor(5, 150, 105);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('FACTURA ELECTRÓNICA DE VENTA', PW - margen - 31, y + 5.8, { align: 'center' });
  if (datos.folio) {
    doc.setFontSize(12);
    doc.text(`No. ${datos.folio}`, PW - margen, y + 16, { align: 'right' });
  }
  // QR
  doc.addImage(qr, 'PNG', PW - margen - 26, y + 19, 26, 26);

  y = Math.max(yi, y + 48) + 2;

  // Bloque cliente
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.roundedRect(margen, y, ancho, 18, 2, 2, 'S');
  doc.setFontSize(9);
  const colW = ancho / 2;
  const campo = (label: string, valor: string, cx: number, cy: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 116, 139);
    doc.text(label, cx, cy);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text(valor, cx + 36, cy);
  };
  campo('Cliente:', datos.cliente, margen + 4, y + 6);
  campo(`${datos.clienteDocLabel ?? 'C.C / NIT'}:`, datos.clienteDoc ?? 'No registrado', margen + 4 + colW, y + 6);
  campo('Fecha generación:', datos.fecha, margen + 4, y + 13);
  campo('Forma de pago:', datos.formaPago ?? 'Efectivo / Contado', margen + 4 + colW, y + 13);
  y += 24;

  // Tabla de items
  doc.setFillColor(5, 150, 105);
  doc.rect(margen, y, ancho, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  const colItem = margen + 2;
  const colDesc = margen + 14;
  const colCant = margen + ancho - 70;
  const colUnit = margen + ancho - 38;
  const colTot = margen + ancho - 2;
  doc.text('Ítem', colItem, y + 5.3);
  doc.text('Descripción', colDesc, y + 5.3);
  doc.text('Cant.', colCant, y + 5.3, { align: 'right' });
  doc.text('Vr. Unit.', colUnit, y + 5.3, { align: 'right' });
  doc.text('Vr. Total', colTot, y + 5.3, { align: 'right' });
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(9);
  datos.items.forEach((item, idx) => {
    const descLineas: string[] = doc.splitTextToSize(item.nombre, colCant - colDesc - 4);
    const filaH = Math.max(7, descLineas.length * 4 + 3);
    if (idx % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margen, y, ancho, filaH, 'F');
    }
    const baseY = y + 5;
    doc.text(`${idx + 1}`, colItem, baseY);
    descLineas.forEach((l, i) => doc.text(l, colDesc, baseY + i * 4));
    doc.text(`${item.cantidad}`, colCant, baseY, { align: 'right' });
    doc.text(fmt(item.precio), colUnit, baseY, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(fmt(item.subtotal), colTot, baseY, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    y += filaH;
  });

  doc.setDrawColor(226, 232, 240);
  doc.line(margen, y, margen + ancho, y);
  y += 6;

  // Caja de totales (derecha)
  const boxW = 80;
  const boxX = margen + ancho - boxW;
  const trow = (label: string, valor: string, fin = false) => {
    if (fin) {
      doc.setFillColor(236, 253, 245);
      doc.rect(boxX, y - 4.5, boxW, 9, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(5, 150, 105);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(71, 85, 105);
    }
    doc.text(label, boxX + 3, y);
    doc.text(valor, boxX + boxW - 3, y, { align: 'right' });
    y += fin ? 7 : 6;
  };
  trow('Total Bruto', fmt(base));
  trow(`IVA ${config.ivaPorcentaje}%`, fmt(iva));
  if (datos.descuento > 0) trow('Descuento', `-${fmt(datos.descuento)}`);
  trow('Total a Pagar', fmt(datos.total), true);

  // CUFE + pie
  const PH = doc.internal.pageSize.getHeight();
  doc.setDrawColor(226, 232, 240);
  doc.line(margen, PH - 24, margen + ancho, PH - 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(30, 41, 59);
  doc.text('CUFE:', margen, PH - 19);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.splitTextToSize(cufe, ancho - 14).forEach((l: string, i: number) => {
    doc.text(l, margen + 14, PH - 19 + i * 3.4);
  });
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('Representación gráfica de factura electrónica · Generado por Magaji', PW / 2, PH - 8, { align: 'center' });

  await entregarPDF(doc, nombreArchivo(datos, 'electronica'));
}

function nombreArchivo(datos: DatosFactura, formato: FormatoFactura): string {
  const sufijo = formato === 'electronica' ? 'factura-electronica' : 'tirilla';
  const base = datos.folio ? datos.folio.replace(/[^\w-]/g, '') : `venta-${Date.now()}`;
  return `${base}_${sufijo}.pdf`;
}
