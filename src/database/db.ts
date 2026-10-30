import Database from '@tauri-apps/plugin-sql';
import { erroresFila, nombreMayusculas, type FilaFactura } from '../utils/importacionFactura';

// ============================================================
//  Errores de negocio + helpers de validación
// ============================================================

/**
 * Error con un `code` estable que la UI puede mapear a un mensaje claro,
 * más un `mensaje` legible por defecto y un `detalle` opcional (datos del caso).
 */
export class ErrorNegocio extends Error {
  code: string;
  detalle?: Record<string, unknown>;
  constructor(code: string, mensaje: string, detalle?: Record<string, unknown>) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.code = code;
    this.detalle = detalle;
  }
}

/**
 * Traduce cualquier error de la capa de datos a un mensaje claro para el usuario.
 * Reconoce los ErrorNegocio y los errores de restricción UNIQUE de SQLite.
 */
export function mensajeError(error: unknown, fallback = 'Ocurrió un error inesperado.'): string {
  if (error instanceof ErrorNegocio) return error.message;
  const raw = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed:\s*productos\.codigo_barras/i.test(raw)) return 'Ya existe un producto con ese código de barras.';
  if (/UNIQUE constraint failed:\s*clientes\.documento/i.test(raw)) return 'Ya existe un cliente con ese documento.';
  if (/UNIQUE constraint failed:\s*fundaciones\.nombre/i.test(raw)) return 'Ya existe una fundación con ese nombre.';
  if (/UNIQUE constraint failed/i.test(raw)) return 'Ese registro ya existe (dato duplicado).';
  return fallback;
}

/** Convierte a entero >= 0 (descarta NaN, negativos, decimales y basura). */
function aEnteroNoNeg(v: unknown): number {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Convierte a monto >= 0 con 2 decimales (descarta NaN y negativos). */
function aMonto(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

// ============================================================
//  Funciones para Códigos de Barras EAN-8 con RCN
// ============================================================

/**
 * Calcula el dígito verificador (checksum) para EAN-8 usando módulo 10.
 * @param base String de 7 dígitos
 * @returns El dígito verificador (posición 0-9)
 */
export function calcularChecksumEAN8(base: string): string {
  if (!/^\d{7}$/.test(base)) {
    throw new ErrorNegocio('CODIGO_BASE_INVALIDO', 'El código base debe contener exactamente 7 dígitos.');
  }
  let suma = 0;
  for (let i = 0; i < 7; i++) {
    const digito = parseInt(base[i], 10);
    const peso = (i % 2 === 0) ? 3 : 1;
    suma += digito * peso;
  }
  const checksum = (10 - (suma % 10)) % 10;
  return checksum.toString();
}

/**
 * Obtiene el siguiente consecutivo disponible para códigos RCN internos (20xxxxxX).
 * Busca el máximo consecutivo existente y retorna el siguiente.
 */
export async function obtenerSiguienteConsecutivoRCN(): Promise<number> {
  const db = await getDbConnection();
  const result = await db.select<{ max_id: number | null }[]>(
    `SELECT MAX(CAST(SUBSTR(codigo_barras, 3, 5) AS INTEGER)) as max_id
     FROM productos
     WHERE codigo_barras LIKE '20%' AND LENGTH(codigo_barras) = 8`
  );
  const maxConsecutivo = result[0]?.max_id ?? 0;
  return maxConsecutivo + 1;
}

/**
 * Genera un código EAN-8 RCN automático (Circulación Restringida Nacional).
 * Formato: "20" + 5 dígitos (consecutivo con padding) + 1 dígito verificador (checksum)
 * Ejemplo: consecutivo 15 -> "2000015" (base) -> "20000158" (con checksum)
 */
export async function generarCodigoRCN(): Promise<string> {
  const consecutivo = await obtenerSiguienteConsecutivoRCN();
  if (consecutivo > 99999) {
    throw new ErrorNegocio('RCN_AGOTADO', 'Se agotaron los consecutivos internos EAN-8 (20 + 5 dígitos).');
  }
  const base = '20' + String(consecutivo).padStart(5, '0');
  const checksum = calcularChecksumEAN8(base);
  return base + checksum;
}

/**
 * Valida que un código de barras manual contiene solo números y tiene a lo sumo 13 dígitos
 * (RCN de 8 o EAN-13). @param codigo String a validar @returns true si es válido, false en caso contrario
 */
export function esCodigoBarrasValido(codigo: string): boolean {
  const limpio = codigo.trim();
  return /^\d+$/.test(limpio) && limpio.length <= 13;
}

/**
 * Verifica si un código de barras ya existe en la base de datos.
 * @param codigo Código a buscar
 * @param productoIdExcluir ID del producto a excluir (para ediciones)
 * @returns true si existe (y no es el del producto excluido), false en caso contrario
 */
export async function codigoBarrasYaExiste(codigo: string, productoIdExcluir?: number): Promise<boolean> {
  const db = await getDbConnection();
  const query = productoIdExcluir
    ? 'SELECT id FROM productos WHERE codigo_barras = $1 AND id != $2 LIMIT 1'
    : 'SELECT id FROM productos WHERE codigo_barras = $1 LIMIT 1';
  const params = productoIdExcluir ? [codigo, productoIdExcluir] : [codigo];
  const result = await db.select<{ id: number }[]>(query, params);
  return result.length > 0;
}

// Mantenemos la conexión en memoria para no abrir múltiples conexiones a la vez
let dbInstance: Database | null = null;

// Función para obtener la conexión activa
export async function getDbConnection() {
  if (dbInstance) return dbInstance;
  // Carga o crea el archivo SQLite local
  dbInstance = await Database.load('sqlite:inventario.db');
  return dbInstance;
}

// Función maestra para crear las tablas al arrancar la app
export async function initDB() {
  try {
    const db = await getDbConnection();

    // 1. Tabla de Productos (Catálogo)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS productos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo_barras TEXT UNIQUE NOT NULL,
        nombre TEXT NOT NULL,
        categoria TEXT,
        precio_compra REAL NOT NULL,
        precio_venta REAL NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0,
        stock_minimo INTEGER NOT NULL DEFAULT 5
      );
    `);

    // 2. Tabla de Clientes (Directorio)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        documento TEXT UNIQUE,
        telefono TEXT,
        correo TEXT,
        direccion TEXT,
        notas TEXT
      );
    `);

    // 3. Tabla de Ventas (Cabecera del recibo)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ventas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
        total REAL NOT NULL,
        descuento REAL DEFAULT 0,
        cliente_id INTEGER,
        FOREIGN KEY (cliente_id) REFERENCES clientes(id)
      );
    `);

    // 4. Tabla de Detalles de Venta (Los productos dentro del recibo)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS venta_detalles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venta_id INTEGER NOT NULL,
        producto_id INTEGER NOT NULL,
        cantidad INTEGER NOT NULL,
        precio_unitario REAL NOT NULL,
        subtotal REAL NOT NULL,
        FOREIGN KEY (venta_id) REFERENCES ventas(id),
        FOREIGN KEY (producto_id) REFERENCES productos(id)
      );
    `);

    // 5. Tabla de Fundaciones (organizaciones vinculadas a clientes de tipo miembro)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS fundaciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        documento TEXT,
        telefono TEXT,
        correo TEXT,
        direccion TEXT,
        notas TEXT,
        datos_extra TEXT DEFAULT '{}'
      );
    `);

    // 6. Tabla de Movimientos de Inventario (Auditoría)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS movimientos_inventario (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        producto_id INTEGER NOT NULL,
        tipo TEXT NOT NULL, -- 'entrada' o 'salida'
        cantidad INTEGER NOT NULL,
        motivo TEXT,
        fecha DATETIME DEFAULT (datetime('now', 'localtime')),
        usuario TEXT DEFAULT 'Admin',
        FOREIGN KEY (producto_id) REFERENCES productos(id)
      );
    `);

    // Migraciones: agregar columnas nuevas a tablas existentes (falla silenciosamente si ya existen)
    try { await db.execute('ALTER TABLE productos ADD COLUMN nombre_etiqueta TEXT'); } catch { /* ya existe */ }
    try { await db.execute("ALTER TABLE clientes ADD COLUMN tipo TEXT DEFAULT 'normal'"); } catch { /* ya existe */ }
    try { await db.execute("ALTER TABLE clientes ADD COLUMN datos_extra TEXT DEFAULT '{}'"); } catch { /* ya existe */ }
    try { await db.execute('ALTER TABLE clientes ADD COLUMN fundacion_id INTEGER'); } catch { /* ya existe */ }
    try { await db.execute('ALTER TABLE clientes ADD COLUMN codigo_miembro TEXT'); } catch { /* ya existe */ }

    return true;
  } catch (error) {
    console.error("Error al inicializar la base de datos:", error);
    return false;
  }
  
}

// Agrega esto al final de src/database/db.ts

export interface Producto {
  id?: number; // Es opcional porque al crear uno nuevo, SQLite lo asigna solo
  codigo_barras: string;
  nombre: string;
  categoria: string;
  precio_compra: number;
  precio_venta: number;
  stock: number;
  stock_minimo: number;
  nombre_etiqueta: string; // nombre corto para la etiqueta (máx 16); vacío = usar el nombre truncado
}

// ── Tipos para filas de consultas (reportes, movimientos y ventas) ──

/** Fila de la gráfica de stock por producto (reportes). */
export interface ProductoStockReporte {
  nombre: string;
  stock: number;
  stock_minimo: number;
  precio_venta: number;
  precio_compra: number;
  categoria: string;
}

/** Movimiento de inventario con el nombre del producto (JOIN). */
export interface MovimientoInventario {
  id: number;
  producto_id: number;
  tipo: 'entrada' | 'salida';
  cantidad: number;
  motivo: string | null;
  fecha: string;
  usuario: string | null;
  producto_nombre: string;
}

/** Artículo del carrito como lo espera registrarVenta(). */
export interface ItemCarritoVenta {
  producto: Pick<Producto, 'id' | 'precio_venta'>;
  cantidad: number;
  subtotal: number;
}

/** Fila de la cabecera de una venta (incluye nombre del cliente si existe). */
export interface VentaRow {
  id: number;
  fecha: string;
  total: number;
  descuento: number;
  cliente_id: number | null;
  cliente_nombre?: string | null;
}

/** Línea de detalle de una venta (incluye nombre del producto). */
export interface DetalleVenta {
  id: number;
  venta_id: number;
  producto_id: number;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  producto_nombre: string;
}

/** Datos agregados para el panel de reportes. */
export interface ReportesData {
  kpis: { totalVentas: number; valorInventario: number; stockCritico: number };
  categorias: { name: string; value: number }[];
  productosStock: ProductoStockReporte[];
  ventasLinea: { mes: string; ventas: number }[];
}

/**
 * Sanea y valida los campos de un producto antes de escribirlo.
 * Si el código de barras está vacío, genera automáticamente un EAN-8 RCN.
 * Si el código está presente, valida que sea solo números y que no exista en BD.
 */
async function sanearProducto(p: Producto, productoIdExcluir?: number): Promise<Producto> {
  const codigo_manual = (p.codigo_barras ?? '').trim();
  const nombre = (p.nombre ?? '').trim();
  if (!nombre) throw new ErrorNegocio('NOMBRE_REQUERIDO', 'El nombre del producto es obligatorio.');
  const nombre_etiqueta = (p.nombre_etiqueta ?? '').trim().slice(0, 16) || nombre.slice(0, 16);

  let codigo_barras: string;

  if (!codigo_manual) {
    // Si no hay código, generar automáticamente un EAN-8 RCN
    codigo_barras = await generarCodigoRCN();
  } else {
    // Si hay código manual, validar que sea solo números
    if (!esCodigoBarrasValido(codigo_manual)) {
      throw new ErrorNegocio('CODIGO_INVALIDO', 'El código de barras debe contener solo números.');
    }
    // Verificar que no exista en BD
    const yaExiste = await codigoBarrasYaExiste(codigo_manual, productoIdExcluir);
    if (yaExiste) {
      throw new ErrorNegocio('CODIGO_DUPLICADO', 'Ya existe un producto con ese código de barras.');
    }
    codigo_barras = codigo_manual;
  }

  const precio_venta = aMonto(p.precio_venta);
  if (precio_venta <= 0) throw new ErrorNegocio('PRECIO_VENTA_INVALIDO', 'El precio de venta debe ser mayor a 0.');

  return {
    ...p,
    codigo_barras,
    nombre,
    nombre_etiqueta,
    categoria: (p.categoria ?? '').trim() || 'Sin Categoría',
    precio_compra: aMonto(p.precio_compra),
    precio_venta,
    stock: aEnteroNoNeg(p.stock),
    stock_minimo: aEnteroNoNeg(p.stock_minimo),
  };
}

// Función para INSERTAR un producto nuevo
export async function crearProducto(producto: Producto) {
  const db = await getDbConnection();
  const p = await sanearProducto(producto);
  const result = await db.execute(
    `INSERT INTO productos (codigo_barras, nombre, nombre_etiqueta, categoria, precio_compra, precio_venta, stock, stock_minimo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      p.codigo_barras,
      p.nombre,
      p.nombre_etiqueta,
      p.categoria,
      p.precio_compra,
      p.precio_venta,
      p.stock,
      p.stock_minimo,
    ]
  );
  // Registrar el stock inicial como entrada en el historial
  if (p.stock > 0) {
    await db.execute(
      'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo) VALUES ($1, $2, $3, $4)',
      [result.lastInsertId, 'entrada', p.stock, 'Stock inicial del producto']
    );
  }
  return result;
}

// Función para LEER todos los productos
export async function obtenerProductos(): Promise<Producto[]> {
  const db = await getDbConnection();
  // Los ordenamos para que el más nuevo salga primero
  const productos = await db.select<Producto[]>('SELECT * FROM productos ORDER BY id DESC');
  return productos;
}

// Agrega esto al final de src/database/db.ts

// Función para buscar un producto específico por su código de barras
export async function buscarProductoPorCodigo(codigo: string): Promise<Producto | null> {
  try {
    const db = await getDbConnection();
    // Buscamos coincidencia exacta del código. LIMIT 1 lo hace más rápido.
    const result = await db.select<Producto[]>(
      'SELECT * FROM productos WHERE codigo_barras = $1 LIMIT 1', 
      [codigo]
    );
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("Error al buscar producto:", error);
    return null;
  }
}

// Agrega esto al final de src/database/db.ts

// Función para ACTUALIZAR un producto existente
export async function actualizarProducto(id: number, producto: Producto) {
  const db = await getDbConnection();
  const p = await sanearProducto(producto, id);

  // Detectar si el stock cambió para registrar el movimiento correspondiente
  const rows = await db.select<{ stock: number }[]>('SELECT stock FROM productos WHERE id = $1', [id]);
  if (rows.length === 0) throw new ErrorNegocio('PRODUCTO_NO_EXISTE', 'El producto que intenta editar ya no existe.');
  const stockAnterior = rows[0]?.stock ?? 0;
  const diferencia = p.stock - stockAnterior;

  const result = await db.execute(
    `UPDATE productos
     SET codigo_barras = $1, nombre = $2, nombre_etiqueta = $3, categoria = $4, precio_compra = $5, precio_venta = $6, stock = $7, stock_minimo = $8
     WHERE id = $9`,
    [
      p.codigo_barras,
      p.nombre,
      p.nombre_etiqueta,
      p.categoria,
      p.precio_compra,
      p.precio_venta,
      p.stock,
      p.stock_minimo,
      id
    ]
  );

  if (diferencia !== 0) {
    await db.execute(
      'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo) VALUES ($1, $2, $3, $4)',
      [id, diferencia > 0 ? 'entrada' : 'salida', Math.abs(diferencia), 'Ajuste manual desde Productos']
    );
  }

  return result;
}

// Función para ELIMINAR un producto de la base de datos
export async function eliminarProducto(id: number) {
  const db = await getDbConnection();

  // Verificar si el producto tiene ventas registradas (no se puede eliminar)
  const ventas = await db.select<{ total: number }[]>(
    'SELECT COUNT(*) as total FROM venta_detalles WHERE producto_id = $1',
    [id]
  );
  if ((ventas[0]?.total ?? 0) > 0) {
    throw new ErrorNegocio('TIENE_VENTAS', 'No se puede eliminar: el producto tiene ventas registradas.');
  }

  // Eliminar movimientos de inventario asociados primero (FK)
  await db.execute('DELETE FROM movimientos_inventario WHERE producto_id = $1', [id]);
  return await db.execute('DELETE FROM productos WHERE id = $1', [id]);
}

// ==========================================
// MÓDULO DE CLIENTES
// ==========================================

export interface Cliente {
  id?: number;
  nombre: string;
  documento: string;
  telefono: string;
  correo: string;
  direccion: string;
  notas: string;
  tipo?: string;           // 'normal' | 'miembro'
  datos_extra?: string;    // JSON para campos flexibles
  fundacion_id?: number | null;
  codigo_miembro?: string | null;
}

export interface Fundacion {
  id?: number;
  nombre: string;
  documento: string;
  telefono: string;
  correo: string;
  direccion: string;
  notas: string;
  datos_extra?: string;
}

/** Valida que un correo tenga forma básica válida (o esté vacío). */
export function correoValido(correo: string): boolean {
  const c = (correo ?? '').trim();
  if (!c) return true; // el correo es opcional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c);
}

/** Sanea y valida los campos de un cliente antes de escribirlo. */
function sanearCliente(c: Cliente): Cliente {
  const nombre = (c.nombre ?? '').trim();
  if (!nombre) throw new ErrorNegocio('NOMBRE_REQUERIDO', 'El nombre del cliente es obligatorio.');
  const correo = (c.correo ?? '').trim();
  if (!correoValido(correo)) throw new ErrorNegocio('CORREO_INVALIDO', 'El correo electrónico no tiene un formato válido.');
  return {
    ...c,
    nombre,
    documento: (c.documento ?? '').trim(),
    telefono: (c.telefono ?? '').trim(),
    correo,
    direccion: (c.direccion ?? '').trim(),
    notas: (c.notas ?? '').trim(),
  };
}

// Función para INSERTAR un nuevo cliente
export async function crearCliente(cliente: Cliente) {
  const db = await getDbConnection();
  const c = sanearCliente(cliente);
  return await db.execute(
    `INSERT INTO clientes (nombre, documento, telefono, correo, direccion, notas, tipo, datos_extra, fundacion_id, codigo_miembro)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      c.nombre,
      c.documento || null,
      c.telefono,
      c.correo,
      c.direccion,
      c.notas,
      c.tipo ?? 'normal',
      c.datos_extra ?? '{}',
      c.fundacion_id ?? null,
      c.codigo_miembro ?? null,
    ]
  );
}

// Retorna todos los clientes (normales + miembros) — usado en Ventas para el selector de cliente
export async function obtenerClientes(): Promise<Cliente[]> {
  const db = await getDbConnection();
  return await db.select<Cliente[]>('SELECT * FROM clientes ORDER BY id DESC');
}

// Retorna solo los clientes de tipo normal — usado en la pestaña Clientes Normales
export async function obtenerClientesNormales(): Promise<Cliente[]> {
  const db = await getDbConnection();
  return await db.select<Cliente[]>(
    "SELECT * FROM clientes WHERE tipo = 'normal' OR tipo IS NULL ORDER BY id DESC"
  );
}

// Función para ACTUALIZAR un cliente existente
export async function actualizarCliente(id: number, cliente: Cliente) {
  const db = await getDbConnection();
  const c = sanearCliente(cliente);
  return await db.execute(
    `UPDATE clientes
     SET nombre = $1, documento = $2, telefono = $3, correo = $4, direccion = $5, notas = $6, tipo = $7, datos_extra = $8
     WHERE id = $9`,
    [
      c.nombre,
      c.documento || null,
      c.telefono,
      c.correo,
      c.direccion,
      c.notas,
      c.tipo ?? 'normal',
      c.datos_extra ?? '{}',
      id,
    ]
  );
}

// Función para ELIMINAR un cliente
export async function contarVentasCliente(id: number): Promise<number> {
  const db = await getDbConnection();
  const result = await db.select<{ total: number }[]>(
    'SELECT COUNT(*) as total FROM ventas WHERE cliente_id = $1', [id]
  );
  return result[0]?.total ?? 0;
}

/** Reasigna las ventas del cliente a otro (o a NULL = Consumidor Final) y luego lo elimina. */
export async function eliminarClienteReasignando(id: number, nuevoClienteId: number | null = null) {
  const db = await getDbConnection();
  if (nuevoClienteId !== null) {
    await db.execute('UPDATE ventas SET cliente_id = $1 WHERE cliente_id = $2', [nuevoClienteId, id]);
  } else {
    await db.execute('UPDATE ventas SET cliente_id = NULL WHERE cliente_id = $1', [id]);
  }
  return await db.execute('DELETE FROM clientes WHERE id = $1', [id]);
}

/** Elimina el cliente y TODAS sus ventas (y los detalles de esas ventas) en cascada. */
export async function eliminarClienteConTodo(id: number) {
  const db = await getDbConnection();
  // Obtener IDs de ventas del cliente
  const ventasDelCliente = await db.select<{ id: number }[]>(
    'SELECT id FROM ventas WHERE cliente_id = $1', [id]
  );
  for (const v of ventasDelCliente) {
    await db.execute('DELETE FROM venta_detalles WHERE venta_id = $1', [v.id]);
  }
  await db.execute('DELETE FROM ventas WHERE cliente_id = $1', [id]);
  return await db.execute('DELETE FROM clientes WHERE id = $1', [id]);
}

export async function eliminarCliente(id: number) {
  const db = await getDbConnection();

  // No se puede eliminar un cliente con ventas asociadas: dejaría las ventas
  // huérfanas y rompería el historial/reportes.
  const ventas = await db.select<{ total: number }[]>(
    'SELECT COUNT(*) as total FROM ventas WHERE cliente_id = $1', [id]
  );
  if ((ventas[0]?.total ?? 0) > 0) {
    throw new ErrorNegocio('TIENE_VENTAS', 'No se puede eliminar: el cliente tiene ventas registradas.');
  }

  return await db.execute('DELETE FROM clientes WHERE id = $1', [id]);
}

// ==========================================
// MÓDULO DE FUNDACIONES Y MIEMBROS
// ==========================================

function sanearFundacion(f: Fundacion): Fundacion {
  const nombre = (f.nombre ?? '').trim();
  if (!nombre) throw new ErrorNegocio('NOMBRE_REQUERIDO', 'El nombre de la fundación es obligatorio.');
  const correo = (f.correo ?? '').trim();
  if (!correoValido(correo)) throw new ErrorNegocio('CORREO_INVALIDO', 'El correo electrónico no tiene un formato válido.');
  return {
    ...f,
    nombre,
    documento: (f.documento ?? '').trim(),
    telefono: (f.telefono ?? '').trim(),
    correo,
    direccion: (f.direccion ?? '').trim(),
    notas: (f.notas ?? '').trim(),
    datos_extra: f.datos_extra ?? '{}',
  };
}

export async function crearFundacion(fundacion: Fundacion) {
  const db = await getDbConnection();
  const f = sanearFundacion(fundacion);
  return await db.execute(
    `INSERT INTO fundaciones (nombre, documento, telefono, correo, direccion, notas, datos_extra)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [f.nombre, f.documento || null, f.telefono, f.correo, f.direccion, f.notas, f.datos_extra]
  );
}

export async function obtenerFundaciones(): Promise<Fundacion[]> {
  const db = await getDbConnection();
  return await db.select<Fundacion[]>('SELECT * FROM fundaciones ORDER BY nombre ASC');
}

export async function actualizarFundacion(id: number, fundacion: Fundacion) {
  const db = await getDbConnection();
  const f = sanearFundacion(fundacion);
  return await db.execute(
    `UPDATE fundaciones SET nombre = $1, documento = $2, telefono = $3, correo = $4, direccion = $5, notas = $6, datos_extra = $7 WHERE id = $8`,
    [f.nombre, f.documento || null, f.telefono, f.correo, f.direccion, f.notas, f.datos_extra, id]
  );
}

export async function eliminarFundacion(id: number) {
  const db = await getDbConnection();
  const miembros = await db.select<{ total: number }[]>(
    'SELECT COUNT(*) as total FROM clientes WHERE fundacion_id = $1', [id]
  );
  if ((miembros[0]?.total ?? 0) > 0) {
    throw new ErrorNegocio('TIENE_MIEMBROS', 'No se puede eliminar: la fundación tiene miembros registrados. Elimine los miembros primero.');
  }
  return await db.execute('DELETE FROM fundaciones WHERE id = $1', [id]);
}

async function generarCodigoMiembro(fundacion_id: number, nombreFundacion: string): Promise<string> {
  const db = await getDbConnection();
  const sinAcentos = Array.from(nombreFundacion.toUpperCase().normalize('NFD'))
    .filter(ch => ch.charCodeAt(0) < 768)
    .join('');
  const prefijo = sinAcentos.replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'MBR';
  const rows = await db.select<{ total: number }[]>(
    'SELECT COUNT(*) as total FROM clientes WHERE fundacion_id = $1', [fundacion_id]
  );
  const seq = (rows[0]?.total ?? 0) + 1;
  return `${prefijo}-${String(seq).padStart(3, '0')}`;
}

export async function crearMiembro(cliente: Cliente, fundacion_id: number, nombreFundacion: string) {
  const db = await getDbConnection();
  const c = sanearCliente(cliente);
  const codigo_miembro = await generarCodigoMiembro(fundacion_id, nombreFundacion);
  return await db.execute(
    `INSERT INTO clientes (nombre, documento, telefono, correo, direccion, notas, tipo, datos_extra, fundacion_id, codigo_miembro)
     VALUES ($1, $2, $3, $4, $5, $6, 'miembro', $7, $8, $9)`,
    [c.nombre, c.documento || null, c.telefono, c.correo, c.direccion, c.notas, c.datos_extra ?? '{}', fundacion_id, codigo_miembro]
  );
}

export async function obtenerMiembrosPorFundacion(fundacion_id: number): Promise<Cliente[]> {
  const db = await getDbConnection();
  return await db.select<Cliente[]>(
    "SELECT * FROM clientes WHERE fundacion_id = $1 AND tipo = 'miembro' ORDER BY nombre ASC",
    [fundacion_id]
  );
}

// ==========================================
// MÓDULO DE ANALÍTICAS Y REPORTES
// ==========================================

export async function obtenerReportes(): Promise<ReportesData> {
  const db = await getDbConnection();
  
  // 1. KPIs (Indicadores Rápidos)
  const ventasRes = await db.select<{total: number}[]>('SELECT COALESCE(SUM(total), 0) as total FROM ventas');
  const invRes = await db.select<{total: number}[]>('SELECT COALESCE(SUM(stock * precio_compra), 0) as total FROM productos');
  const critRes = await db.select<{total: number}[]>('SELECT COUNT(*) as total FROM productos WHERE stock <= stock_minimo');
  
  // 2. Gráfica de Pastel (Productos por Categoría)
  const categorias = await db.select<{name: string, value: number}[]>(`
    SELECT 
      CASE WHEN categoria = '' OR categoria IS NULL THEN 'Sin Categoría' ELSE categoria END as name, 
      COUNT(*) as value 
    FROM productos 
    GROUP BY name
  `);

  // 3. Gráfica de Barras (Stock por cada producto)
  const productosStock = await db.select<ProductoStockReporte[]>(`
    SELECT
      nombre,
      stock,
      stock_minimo,
      precio_venta,
      precio_compra,
      CASE WHEN categoria = '' OR categoria IS NULL THEN 'Sin Categoría' ELSE categoria END as categoria
    FROM productos
  `);

  // 4. Gráfica de Líneas (Ventas por Mes)
  const ventasLinea = await db.select<{mes: string, ventas: number}[]>(`
    SELECT strftime('%m-%Y', fecha) as mes, COALESCE(SUM(total), 0) as ventas 
    FROM ventas 
    GROUP BY mes 
    ORDER BY fecha ASC 
    LIMIT 6
  `);

  return {
    kpis: { 
      totalVentas: ventasRes[0]?.total || 0, 
      valorInventario: invRes[0]?.total || 0, 
      stockCritico: critRes[0]?.total || 0 
    },
    categorias,
    productosStock,
    ventasLinea
  };
}

// ==========================================
// MÓDULO DE INVENTARIO Y MOVIMIENTOS
// ==========================================

export async function registrarMovimiento(producto_id: number, tipo: string, cantidad: number, motivo: string) {
  const db = await getDbConnection();

  // ── Validaciones ──
  if (tipo !== 'entrada' && tipo !== 'salida') {
    throw new ErrorNegocio('TIPO_INVALIDO', 'El tipo de movimiento debe ser entrada o salida.');
  }
  const cant = aEnteroNoNeg(cantidad);
  if (cant <= 0) {
    throw new ErrorNegocio('CANTIDAD_INVALIDA', 'La cantidad debe ser un número entero mayor a 0.');
  }

  const rows = await db.select<{ stock: number; nombre: string }[]>(
    'SELECT stock, nombre FROM productos WHERE id = $1', [producto_id]
  );
  if (rows.length === 0) {
    throw new ErrorNegocio('PRODUCTO_NO_EXISTE', 'El producto seleccionado ya no existe.');
  }
  // Una salida no puede dejar el stock en negativo.
  if (tipo === 'salida' && rows[0].stock < cant) {
    throw new ErrorNegocio(
      'STOCK_INSUFICIENTE',
      `No hay stock suficiente de "${rows[0].nombre}": disponibles ${rows[0].stock}, se intentan retirar ${cant}.`,
      { nombre: rows[0].nombre, disponible: rows[0].stock, requerido: cant }
    );
  }

  // 1. Guardar en el historial
  await db.execute(
    'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo) VALUES ($1, $2, $3, $4)',
    [producto_id, tipo, cant, motivo]
  );

  // 2. Actualizar el stock del producto automáticamente
  if (tipo === 'entrada') {
    await db.execute('UPDATE productos SET stock = stock + $1 WHERE id = $2', [cant, producto_id]);
  } else {
    await db.execute('UPDATE productos SET stock = stock - $1 WHERE id = $2 AND stock >= $1', [cant, producto_id]);
  }
}

export async function obtenerMovimientos(): Promise<MovimientoInventario[]> {
  const db = await getDbConnection();
  // Hacemos un JOIN para traer el nombre del producto junto con el movimiento
  return await db.select<MovimientoInventario[]>(`
    SELECT m.id, m.producto_id, m.tipo, m.cantidad, m.motivo, m.fecha, m.usuario,
           p.nombre as producto_nombre
    FROM movimientos_inventario m
    JOIN productos p ON m.producto_id = p.id
    ORDER BY m.id DESC
  `);
}

export async function obtenerEstadisticasInventario() {
  const db = await getDbConnection();
  // Calculamos las entradas y salidas del mes actual
  const entradas = await db.select<{total: number}[]>("SELECT COALESCE(SUM(cantidad), 0) as total FROM movimientos_inventario WHERE tipo = 'entrada' AND strftime('%m-%Y', fecha) = strftime('%m-%Y', 'now', 'localtime')");
  const salidas = await db.select<{total: number}[]>("SELECT COALESCE(SUM(cantidad), 0) as total FROM movimientos_inventario WHERE tipo = 'salida' AND strftime('%m-%Y', fecha) = strftime('%m-%Y', 'now', 'localtime')");
  
  return {
    entradasMes: entradas[0]?.total || 0,
    salidasMes: salidas[0]?.total || 0
  };
}

// ==========================================
// MÓDULO DE VENTAS Y CAJA
// ==========================================

// Registrar una venta completa (Cabecera, Detalles y Descuento de Stock)
export async function registrarVenta(total: number, descuento: number, cliente_id: number | null, carrito: ItemCarritoVenta[]) {
  const db = await getDbConnection();

  // ── Validaciones previas (antes de escribir nada) ──
  if (!Array.isArray(carrito) || carrito.length === 0) {
    throw new ErrorNegocio('CARRITO_VACIO', 'No hay productos en el carrito.');
  }
  if (!Number.isFinite(total) || total < 0) {
    throw new ErrorNegocio('TOTAL_INVALIDO', 'El total de la venta no es válido.');
  }

  // Verificar que cada producto exista y tenga stock suficiente. Como un mismo
  // producto puede venir en varias líneas, sumamos por id.
  const requerido = new Map<number, number>();
  for (const item of carrito) {
    const id = item?.producto?.id;
    const cant = Math.trunc(Number(item?.cantidad));
    if (id == null || !Number.isFinite(cant) || cant <= 0) {
      throw new ErrorNegocio('ITEM_INVALIDO', 'Hay un producto con cantidad inválida en el carrito.');
    }
    requerido.set(id, (requerido.get(id) ?? 0) + cant);
  }
  for (const [id, cant] of requerido) {
    const rows = await db.select<{ stock: number; nombre: string }[]>(
      'SELECT stock, nombre FROM productos WHERE id = $1', [id]
    );
    if (rows.length === 0) {
      throw new ErrorNegocio('PRODUCTO_NO_EXISTE', 'Un producto del carrito ya no existe en el catálogo.');
    }
    if (rows[0].stock < cant) {
      throw new ErrorNegocio(
        'STOCK_INSUFICIENTE',
        `Stock insuficiente de "${rows[0].nombre}": disponibles ${rows[0].stock}, se intentan vender ${cant}.`,
        { nombre: rows[0].nombre, disponible: rows[0].stock, requerido: cant }
      );
    }
  }

  try {
    await db.execute('BEGIN TRANSACTION');

    // 1. Crear la cabecera de la venta
    const resVenta = await db.execute(
      "INSERT INTO ventas (total, descuento, cliente_id, fecha) VALUES ($1, $2, $3, datetime('now', 'localtime'))",
      [total, Math.max(0, descuento) || 0, cliente_id]
    );

    const venta_id = resVenta.lastInsertId;

    // 2. Insertar los detalles, descontar el stock y registrar movimiento.
    //    El UPDATE lleva guard `stock >= cantidad` como segunda línea de defensa.
    for (const item of carrito) {
      await db.execute(
        'INSERT INTO venta_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES ($1, $2, $3, $4, $5)',
        [venta_id, item.producto.id, item.cantidad, item.producto.precio_venta, item.subtotal]
      );
      await db.execute(
        'UPDATE productos SET stock = stock - $1 WHERE id = $2 AND stock >= $1',
        [item.cantidad, item.producto.id]
      );
      await db.execute(
        'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo) VALUES ($1, $2, $3, $4)',
        [item.producto.id, 'salida', item.cantidad, `Venta #${venta_id}`]
      );
    }

    await db.execute('COMMIT');
    return resVenta.lastInsertId ?? venta_id;
  } catch (err) {
    try { await db.execute('ROLLBACK'); } catch { /* ignore rollback error */ }
    if (err instanceof ErrorNegocio) throw err;
    throw new ErrorNegocio('DB_TRANSACTION_ERROR', 'Error registrando venta', { detalle: err instanceof Error ? err.message : String(err) });
  }
}

// Obtener las últimas ventas para la barra lateral
export async function obtenerUltimasVentas(): Promise<VentaRow[]> {
  const db = await getDbConnection();
  return await db.select<VentaRow[]>(`
    SELECT v.*, c.nombre as cliente_nombre
    FROM ventas v
    LEFT JOIN clientes c ON v.cliente_id = c.id
    ORDER BY v.fecha DESC LIMIT 15
  `);
}

// Obtener todas las ventas para el historial completo
export async function obtenerTodasLasVentas(): Promise<VentaRow[]> {
  const db = await getDbConnection();
  return await db.select<VentaRow[]>(`
    SELECT v.*, c.nombre as cliente_nombre
    FROM ventas v
    LEFT JOIN clientes c ON v.cliente_id = c.id
    ORDER BY v.fecha DESC
  `);
}

// Obtener los productos exactos que se vendieron en un recibo específico
export async function obtenerDetallesDeVenta(venta_id: number): Promise<DetalleVenta[]> {
  const db = await getDbConnection();
  return await db.select<DetalleVenta[]>(`
    SELECT vd.id, vd.venta_id, vd.producto_id, vd.cantidad, vd.precio_unitario, vd.subtotal,
           p.nombre as producto_nombre
    FROM venta_detalles vd
    JOIN productos p ON vd.producto_id = p.id
    WHERE vd.venta_id = $1
  `, [venta_id]);
}

// Anular una venta: elimina registros y restaura el stock
export async function anularVenta(venta_id: number) {
  const db = await getDbConnection();

  try {
    await db.execute('BEGIN TRANSACTION');

    const detalles = await db.select<{ producto_id: number; cantidad: number }[]>(
      'SELECT producto_id, cantidad FROM venta_detalles WHERE venta_id = $1',
      [venta_id]
    );
    for (const d of detalles) {
      await db.execute(
        'UPDATE productos SET stock = stock + $1 WHERE id = $2',
        [d.cantidad, d.producto_id]
      );
      await db.execute(
        'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo) VALUES ($1, $2, $3, $4)',
        [d.producto_id, 'entrada', d.cantidad, `Anulación venta #${venta_id}`]
      );
    }

    await db.execute('DELETE FROM venta_detalles WHERE venta_id = $1', [venta_id]);
    await db.execute('DELETE FROM ventas WHERE id = $1', [venta_id]);

    await db.execute('COMMIT');
  } catch (err) {
    try { await db.execute('ROLLBACK'); } catch { /* ignore */ }
    if (err instanceof ErrorNegocio) throw err;
    throw new ErrorNegocio('DB_TRANSACTION_ERROR', 'Error anulando venta', { detalle: err instanceof Error ? err.message : String(err) });
  }
}

// Actualizar una venta: cliente, descuento e items (ajusta stock según diferencias)
export async function actualizarVenta(
  venta_id: number,
  cliente_id: number | null,
  descuento: number,
  itemsEditados: { id: number; producto_id: number; cantidad_nueva: number; cantidad_anterior: number; precio_unitario: number }[]
) {
  const db = await getDbConnection();

  // ── Pre-validar incrementos de cantidad contra el stock disponible ──
  // (aumentar la cantidad de una línea retira más stock; no puede quedar negativo)
  for (const item of itemsEditados) {
    const extra = item.cantidad_nueva - item.cantidad_anterior; // > 0 si aumenta
    if (item.cantidad_nueva > 0 && extra > 0) {
      const rows = await db.select<{ stock: number; nombre: string }[]>(
        'SELECT stock, nombre FROM productos WHERE id = $1', [item.producto_id]
      );
      if (rows.length === 0) {
        throw new ErrorNegocio('PRODUCTO_NO_EXISTE', 'Un producto de la venta ya no existe en el catálogo.');
      }
      if (rows[0].stock < extra) {
        throw new ErrorNegocio(
          'STOCK_INSUFICIENTE',
          `Stock insuficiente de "${rows[0].nombre}": disponibles ${rows[0].stock}, faltan ${extra} para el aumento.`,
          { nombre: rows[0].nombre, disponible: rows[0].stock, requerido: extra }
        );
      }
    }
  }

  try {
    await db.execute('BEGIN TRANSACTION');

    for (const item of itemsEditados) {
      const diff = item.cantidad_anterior - item.cantidad_nueva; // positivo = devolver stock, negativo = quitar más
      const esNuevo = !item.id || item.id <= 0;

      if (item.cantidad_nueva === 0) {
        if (!esNuevo) {
          // Item eliminado: restaurar todo el stock
          await db.execute('DELETE FROM venta_detalles WHERE id = $1', [item.id]);
          await db.execute('UPDATE productos SET stock = stock + $1 WHERE id = $2', [item.cantidad_anterior, item.producto_id]);
          await db.execute(
            'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo) VALUES ($1, $2, $3, $4)',
            [item.producto_id, 'entrada', item.cantidad_anterior, `Edición venta #${venta_id} — item eliminado`]
          );
        }
      } else {
        const nuevoSubtotal = item.cantidad_nueva * item.precio_unitario;
        if (esNuevo) {
          // Insertar nuevo ítem en la venta
          await db.execute(
            'INSERT INTO venta_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES ($1, $2, $3, $4, $5)',
            [venta_id, item.producto_id, item.cantidad_nueva, item.precio_unitario, nuevoSubtotal]
          );
          // Descontar stock
          await db.execute('UPDATE productos SET stock = stock - $1 WHERE id = $2', [item.cantidad_nueva, item.producto_id]);
          await db.execute(
            'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo) VALUES ($1, $2, $3, $4)',
            [item.producto_id, 'salida', item.cantidad_nueva, `Edición venta #${venta_id} — producto agregado`]
          );
        } else {
          // Cantidad o subtotal cambió
          await db.execute(
            'UPDATE venta_detalles SET cantidad = $1, subtotal = $2 WHERE id = $3',
            [item.cantidad_nueva, nuevoSubtotal, item.id]
          );
          if (diff > 0) {
            // Se redujo la cantidad — devolver stock
            await db.execute('UPDATE productos SET stock = stock + $1 WHERE id = $2', [diff, item.producto_id]);
            await db.execute(
              'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo) VALUES ($1, $2, $3, $4)',
              [item.producto_id, 'entrada', diff, `Edición venta #${venta_id}`]
            );
          } else if (diff < 0) {
            // Se aumentó la cantidad — quitar más stock
            await db.execute('UPDATE productos SET stock = stock - $1 WHERE id = $2', [Math.abs(diff), item.producto_id]);
            await db.execute(
              'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo) VALUES ($1, $2, $3, $4)',
              [item.producto_id, 'salida', Math.abs(diff), `Edición venta #${venta_id}`]
            );
          }
        }
      }
    }

    // Recalcular total desde los detalles que quedaron
    const rows = await db.select<{ subtotal: number }[]>(
      'SELECT COALESCE(SUM(subtotal), 0) as subtotal FROM venta_detalles WHERE venta_id = $1',
      [venta_id]
    );
    const subtotal = rows[0]?.subtotal ?? 0;
    const total = Math.max(0, subtotal - descuento);

    await db.execute(
      'UPDATE ventas SET cliente_id = $1, descuento = $2, total = $3 WHERE id = $4',
      [cliente_id, descuento, total, venta_id]
    );

    await db.execute('COMMIT');
  } catch (err) {
    try { await db.execute('ROLLBACK'); } catch { /* ignore */ }
    if (err instanceof ErrorNegocio) throw err;
    throw new ErrorNegocio('DB_TRANSACTION_ERROR', 'Error actualizando venta', { detalle: err instanceof Error ? err.message : String(err) });
  }
}


export async function obtenerVentasVsCompras(desde: string, hasta: string) {
  const db = await getDbConnection();
  
  // 1. Obtener ventas agrupadas por día en el rango
  const ventas = await db.select<{fecha: string, total: number}[]>(`
    SELECT date(fecha) as fecha, SUM(total) as total
    FROM ventas
    WHERE date(fecha) >= date($1) AND date(fecha) <= date($2)
    GROUP BY date(fecha)
    ORDER BY date(fecha) ASC
  `, [desde, hasta]);

  // 2. Obtener compras (entradas de inventario) agrupadas por día en el rango
  const compras = await db.select<{fecha: string, total: number}[]>(`
    SELECT date(m.fecha) as fecha, SUM(m.cantidad * p.precio_compra) as total
    FROM movimientos_inventario m
    JOIN productos p ON m.producto_id = p.id
    WHERE m.tipo = 'entrada' AND date(m.fecha) >= date($1) AND date(m.fecha) <= date($2)
    GROUP BY date(m.fecha)
    ORDER BY date(m.fecha) ASC
  `, [desde, hasta]);

  return { ventas, compras };
}

async function prepararImportacionesFactura() {
  const db = await getDbConnection();
  await db.execute(`CREATE TABLE IF NOT EXISTS importaciones_factura (
    clave TEXT PRIMARY KEY, estado TEXT NOT NULL, producto_id INTEGER,
    nombre TEXT NOT NULL, cantidad INTEGER NOT NULL,
    fecha DATETIME DEFAULT (datetime('now', 'localtime'))
  )`);
  return db;
}

export async function obtenerProgresoFactura(claves: string[]): Promise<{ clave: string; estado: string; producto_id: number | null }[]> {
  const db = await prepararImportacionesFactura();
  if (!claves.length) return [];
  return db.select<{ clave: string; estado: string; producto_id: number | null }[]>(
    `SELECT clave, estado, producto_id FROM importaciones_factura WHERE clave IN (${claves.map((_, i) => `$${i + 1}`).join(',')})`, claves
  );
}

/** Progreso durable por fila: una escritura interrumpida nunca se reintenta a ciegas. */
export async function importarFilaFactura(fila: FilaFactura): Promise<number> {
  const db = await prepararImportacionesFactura();
  const progreso = await db.select<{ estado: string; producto_id: number | null }[]>(
    'SELECT estado, producto_id FROM importaciones_factura WHERE clave = $1', [fila.clave]
  );
  if (progreso[0]?.estado === 'completado') return progreso[0].producto_id!;
  if (progreso.length) throw new ErrorNegocio('IMPORTACION_INCIERTA',
    `La fila "${fila.nombre}" tuvo una escritura interrumpida. Revise su stock e historial en Inventario antes de retirarla de esta importación. No se volverá a aplicar automáticamente.`);
  const productos = await obtenerProductos();
  const errores = erroresFila(fila, productos);
  if (errores.length) throw new ErrorNegocio('FACTURA_INVALIDA', `${fila.nombre}: ${errores.join(', ')}.`);
  // Reserva persistente antes de escribir. UNIQUE bloquea incluso dos confirmaciones simultáneas.
  await db.execute('INSERT INTO importaciones_factura (clave, estado, nombre, cantidad) VALUES ($1, $2, $3, $4)',
    [fila.clave, 'procesando', fila.nombre, fila.cantidad]);
  try {
    let productoId: number;
    if (fila.producto_id !== null) {
      productoId = fila.producto_id;
      await registrarMovimiento(productoId, 'entrada', fila.cantidad!, 'Importación de factura');
    } else {
      const resultado = await crearProducto({
        nombre: nombreMayusculas(fila.nombre), nombre_etiqueta: nombreMayusculas(fila.nombre_etiqueta),
        codigo_barras: fila.codigo_barras, categoria: fila.categoria,
        precio_compra: fila.precio_compra!, precio_venta: fila.precio_venta!,
        stock: fila.cantidad!, stock_minimo: 1,
      });
      productoId = resultado.lastInsertId!;
    }
    await db.execute('UPDATE importaciones_factura SET estado = $1, producto_id = $2 WHERE clave = $3',
      ['completado', productoId, fila.clave]);
    return productoId;
  } catch (error) {
    throw new ErrorNegocio('IMPORTACION_INCIERTA',
      `Se interrumpió la fila "${fila.nombre}": ${mensajeError(error)} Revise el stock y el historial antes de continuar; esta fila queda bloqueada para evitar duplicados.`);
  }
}
