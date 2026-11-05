import type { Producto } from '../database/db';
import { NUEVE_CATEGORIAS_DEFECTO } from './factura';

export interface FilaFactura {
  clave: string;
  nombre: string;
  nombre_etiqueta: string;
  codigo_barras: string;
  categoria: string;
  cantidad: number | null;
  precio_compra: number | null;
  precio_venta: number | null;
  producto_id: number | null;
  revisado: boolean;
  origen: string;
  coincidencias_descartadas?: number[];
}

export const normalizarNombre = (nombre: string) => nombre.normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const nombreMayusculas = (nombre: string) => nombre.normalize('NFC').trim().replace(/\s+/g, ' ').toUpperCase();

export function dimensionesFactura(ancho: number, alto: number): { ancho: number; alto: number } {
  if (!Number.isSafeInteger(ancho) || !Number.isSafeInteger(alto) || ancho <= 0 || alto <= 0) throw new Error('Dimensiones de imagen inválidas.');
  const escala = Math.min(1, 2560 / Math.max(ancho, alto));
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) };
}

export function esFilaFactura(valor: unknown): valor is FilaFactura {
  if (!valor || typeof valor !== 'object') return false;
  const f = valor as Record<string, unknown>;
  return ['clave','nombre','nombre_etiqueta','codigo_barras','categoria','origen'].every(k => typeof f[k] === 'string') &&
    typeof f.revisado === 'boolean' && (f.producto_id === null || Number.isSafeInteger(f.producto_id)) &&
    ['cantidad','precio_compra','precio_venta'].every(k => f[k] === null || (typeof f[k] === 'number' && Number.isFinite(f[k]))) &&
    (f.coincidencias_descartadas === undefined || (Array.isArray(f.coincidencias_descartadas) && f.coincidencias_descartadas.every(id => Number.isSafeInteger(id) && id > 0)));
}

export interface CoincidenciaProducto { producto: Producto; motivo: string; puntuacion: number }

function paresNombre(texto: string): Map<string, number> {
  const pares = new Map<string, number>();
  const compacto = texto.replace(/\s/g, '');
  for (let i = 1; i < compacto.length; i++) {
    const par = compacto.slice(i - 1, i + 1);
    pares.set(par, (pares.get(par) ?? 0) + 1);
  }
  return pares;
}

function similitudNombre(a: Map<string, number>, b: Map<string, number>): number {
  let comunes = 0, total = 0;
  for (const [par, n] of a) { comunes += Math.min(n, b.get(par) ?? 0); total += n; }
  for (const n of b.values()) total += n;
  return total ? 2 * comunes / total : 0;
}

function prepararCatalogo(productos: Producto[]) {
  return {
    entradas: productos.filter(p => p.id).map(producto => {
      const nombre = normalizarNombre(producto.nombre);
      const etiqueta = normalizarNombre(producto.nombre_etiqueta ?? '');
      return { producto, nombre, etiqueta, pares: paresNombre(nombre), paresEtiqueta: paresNombre(etiqueta),
        busqueda: normalizarNombre(`${producto.nombre} ${producto.nombre_etiqueta ?? ''} ${producto.codigo_barras}`) };
    }),
    sugerencias: new Map<string, CoincidenciaProducto[]>(),
  };
}

// El catálogo se reemplaza al consultar la base: cada lectura usa un índice nuevo.
const catalogos = new WeakMap<Producto[], ReturnType<typeof prepararCatalogo>>();
function catalogoBusqueda(productos: Producto[]) {
  let catalogo = catalogos.get(productos);
  if (!catalogo) { catalogo = prepararCatalogo(productos); catalogos.set(productos, catalogo); }
  return catalogo;
}

/** Solo propone: el parecido de nombres nunca autoriza sumar stock automáticamente. */
export function sugerirProductosExistentes(nombre: string, codigo: string, productos: Producto[]): CoincidenciaProducto[] {
  const consulta = normalizarNombre(nombre);
  const catalogo = catalogoBusqueda(productos);
  const clave = JSON.stringify([consulta, codigo]);
  const guardadas = catalogo.sugerencias.get(clave);
  if (guardadas) return guardadas;
  const pares = paresNombre(consulta);
  const coincidencias: CoincidenciaProducto[] = [];
  for (const { producto, nombre: actual, etiqueta, pares: paresActuales, paresEtiqueta } of catalogo.entradas) {
    if (codigo && codigo === producto.codigo_barras) {
      coincidencias.push({ producto, motivo: 'Mismo código de barras', puntuacion: 3 });
    } else if (consulta && (consulta === actual || consulta === etiqueta)) {
      coincidencias.push({ producto, motivo: codigo && codigo !== producto.codigo_barras ? 'Nombre igual; código diferente' : 'Mismo nombre', puntuacion: 2 });
    } else if (consulta.length >= 4) {
      // ponytail: parecido por pares de letras; las variantes se confirman manualmente.
      const puntuacion = Math.max(similitudNombre(pares, paresActuales), similitudNombre(pares, paresEtiqueta));
      if (puntuacion >= 0.72) coincidencias.push({ producto, motivo: 'Nombre parecido: revise presentación y tamaño', puntuacion });
    }
  }
  coincidencias.sort((a, b) => b.puntuacion - a.puntuacion || a.producto.nombre.localeCompare(b.producto.nombre) || a.producto.id! - b.producto.id!);
  if (catalogo.sugerencias.size >= 512) catalogo.sugerencias.clear();
  catalogo.sugerencias.set(clave, coincidencias);
  return coincidencias;
}

export function buscarProductosFactura(consulta: string, productos: Producto[]): Producto[] {
  const partes = normalizarNombre(consulta).split(' ').filter(Boolean);
  if (!partes.length) return [];
  return catalogoBusqueda(productos).entradas.filter(p => partes.every(parte => p.busqueda.includes(parte)))
    .map(p => p.producto)
    .sort((a, b) => Number(b.codigo_barras === consulta.trim()) - Number(a.codigo_barras === consulta.trim()) || a.nombre.localeCompare(b.nombre));
}

export function asociarFilaFactura(fila: FilaFactura, producto: Producto): FilaFactura {
  return { ...fila, producto_id: producto.id!, nombre: producto.nombre,
    nombre_etiqueta: producto.nombre_etiqueta ?? producto.nombre.slice(0, 16),
    codigo_barras: producto.codigo_barras, categoria: producto.categoria,
    precio_compra: producto.precio_compra, precio_venta: producto.precio_venta,
    revisado: false, coincidencias_descartadas: undefined };
}

export function proponerCoincidencia(nombre: string, codigo: string, productos: Producto[]): Producto | undefined {
  // Un código presente tiene prioridad; un código distinto nunca se asocia por nombre.
  if (codigo) return productos.find(p => p.codigo_barras === codigo);
  const coincidencias = productos.filter(p => normalizarNombre(p.nombre) === normalizarNombre(nombre));
  return coincidencias.length === 1 ? coincidencias[0] : undefined;
}

/** Valida y estructura los datos devueltos por la IA */
export function filasDesdeIA(datos: unknown, productos: Producto[]): FilaFactura[] {
  if (!datos || typeof datos !== 'object' || !('productos' in datos) || !Array.isArray(datos.productos) || datos.productos.length > 500) {
    throw new Error('La IA no devolvió una lista de productos válida en formato JSON.');
  }
  const categoriasValidas = Array.from(new Set([
    ...NUEVE_CATEGORIAS_DEFECTO,
    ...productos.map(p => p.categoria).filter(Boolean),
  ]));
  const monto = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  
  return datos.productos.map((valor: unknown) => {
    if (!valor || typeof valor !== 'object' || !('nombre' in valor) || typeof valor.nombre !== 'string' || !valor.nombre.trim()) {
      throw new Error('La IA devolvió una fila sin nombre de producto.');
    }
    const fila = valor as Record<string, unknown>;
    const nombre = nombreMayusculas(valor.nombre).slice(0, 300);
    const codigo = typeof fila.codigo_barras === 'string' ? fila.codigo_barras.trim().slice(0, 100) : '';
    const existente = proponerCoincidencia(nombre, codigo, productos);
    
    // Etiqueta: máximo 16 caracteres
    const etiquetaSugerida = typeof fila.nombre_etiqueta === 'string' && fila.nombre_etiqueta.trim()
      ? fila.nombre_etiqueta
      : nombre;
    const nombre_etiqueta = existente?.nombre_etiqueta ?? nombreMayusculas(etiquetaSugerida).slice(0, 16);

    // Categoría: asignar una de las 9 categorías
    const catEncontrada = categoriasValidas.find(c =>
      typeof fila.categoria === 'string' && normalizarNombre(c) === normalizarNombre(fila.categoria)
    ) ?? categoriasValidas.find(c =>
      typeof fila.categoria === 'string' && (normalizarNombre(c).includes(normalizarNombre(fila.categoria)) || normalizarNombre(fila.categoria).includes(normalizarNombre(c)))
    ) ?? NUEVE_CATEGORIAS_DEFECTO[0];

    const cantRaw = typeof fila.stock === 'number' ? fila.stock : fila.cantidad;
    const cantidad = typeof cantRaw === 'number' && Number.isSafeInteger(cantRaw) && cantRaw > 0 ? cantRaw : 1;

    return {
      clave: crypto.randomUUID(),
      nombre: existente?.nombre ?? nombre,
      nombre_etiqueta,
      codigo_barras: existente?.codigo_barras ?? codigo,
      categoria: existente?.categoria ?? catEncontrada,
      cantidad,
      precio_compra: existente?.precio_compra ?? monto(fila.precio_compra),
      precio_venta: existente?.precio_venta ?? monto(fila.precio_venta),
      producto_id: existente?.id ?? null,
      revisado: false,
      origen: typeof fila.observaciones === 'string' ? fila.observaciones.slice(0, 1000) : '',
    };
  });
}

export interface DuplicadoLote {
  /** Mensaje listo para mostrar en la fila afectada. */
  mensaje: string;
  /** Clave de la otra fila nueva con la que choca. */
  claveOtra: string;
}

/**
 * Detecta choques entre filas nuevas del mismo lote (mismo nombre normalizado
 * o mismo código de barras). No compara contra el catálogo: eso lo hace erroresFila.
 */
export function duplicadosEnLote(filas: FilaFactura[]): Map<string, DuplicadoLote> {
  const porNombre = new Map<string, FilaFactura>();
  const porCodigo = new Map<string, FilaFactura>();
  const duplicados = new Map<string, DuplicadoLote>();
  const registrar = (actual: FilaFactura, otra: FilaFactura, mensaje: string) => {
    if (!duplicados.has(actual.clave)) duplicados.set(actual.clave, { mensaje, claveOtra: otra.clave });
    if (!duplicados.has(otra.clave)) duplicados.set(otra.clave, { mensaje, claveOtra: actual.clave });
  };
  for (const fila of filas) {
    if (fila.producto_id !== null) continue;
    const nombre = normalizarNombre(fila.nombre);
    if (nombre) {
      const previa = porNombre.get(nombre);
      if (previa) registrar(fila, previa, `Nombre repetido: «${fila.nombre}»`);
      else porNombre.set(nombre, fila);
    }
    if (fila.codigo_barras) {
      const previa = porCodigo.get(fila.codigo_barras);
      if (previa) registrar(fila, previa, `Código de barras repetido: ${fila.codigo_barras}`);
      else porCodigo.set(fila.codigo_barras, fila);
    }
  }
  return duplicados;
}

export function erroresFila(fila: FilaFactura, productos: Producto[]): string[] {
  const errores: string[] = [];
  if (!fila.clave.trim() || fila.clave.length > 100) errores.push('Identificador de fila inválido');
  if (!fila.revisado) errores.push('Confirmar revisión');
  if (!Number.isSafeInteger(fila.cantidad) || (fila.cantidad ?? 0) <= 0) errores.push('Cantidad entera mayor a 0');
  if (fila.producto_id !== null) {
    if (!productos.some(p => p.id === fila.producto_id)) errores.push('Producto existente no disponible');
    return errores;
  }
  if (!fila.nombre.trim()) errores.push('Nombre obligatorio');
  if (fila.nombre.length > 300) errores.push('Nombre demasiado largo');
  
  const catsValidas = new Set([
    ...NUEVE_CATEGORIAS_DEFECTO,
    ...productos.map(p => p.categoria).filter(Boolean),
  ]);
  if (!fila.categoria || !catsValidas.has(fila.categoria)) errores.push('Elegir una categoría válida');

  if (fila.precio_compra === null || !Number.isFinite(fila.precio_compra) || fila.precio_compra < 0) errores.push('Revisar precio de compra');
  if (fila.precio_venta === null || !Number.isFinite(fila.precio_venta) || fila.precio_venta <= 0) errores.push('Precio de venta mayor a 0');
  if (fila.nombre_etiqueta.length > 16) errores.push('Etiqueta de máximo 16 caracteres');
  if (fila.codigo_barras && !/^\d{1,13}$/.test(fila.codigo_barras)) errores.push('Código de 1 a 13 dígitos');
  if (fila.codigo_barras && productos.some(p => p.codigo_barras === fila.codigo_barras)) errores.push('Código ya existente: asociar producto');
  const pendientes = sugerirProductosExistentes(fila.nombre, fila.codigo_barras, productos)
    .some(c => !fila.coincidencias_descartadas?.includes(c.producto.id!));
  if (pendientes) errores.push('Resolver las coincidencias del inventario antes de crear un producto nuevo');
  return errores;
}
