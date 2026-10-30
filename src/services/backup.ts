import { appDataDir, join } from '@tauri-apps/api/path';
import { readFile, writeFile, remove, readDir, stat } from '@tauri-apps/plugin-fs';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { getDbConnection } from '../database/db';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface ConfigRespaldo {
  carpeta: string;
  limite: number;
  intervaloHoras: number; // 0 = deshabilitado
  ultimoRespaldo: string | null;
}

const CLAVE_STORAGE = 'pos_config_respaldo';

const CONFIG_DEFAULT: ConfigRespaldo = {
  carpeta: '',
  limite: 10,
  intervaloHoras: 24,
  ultimoRespaldo: null,
};

export function obtenerConfigRespaldo(): ConfigRespaldo {
  try {
    const raw = localStorage.getItem(CLAVE_STORAGE);
    if (raw) return { ...CONFIG_DEFAULT, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...CONFIG_DEFAULT };
}

export function guardarConfigRespaldo(config: ConfigRespaldo): void {
  localStorage.setItem(CLAVE_STORAGE, JSON.stringify(config));
}

// ─── Selección de carpeta ────────────────────────────────────────────────────

export async function elegirCarpeta(): Promise<string | null> {
  const resultado = await dialogOpen({
    directory: true,
    title: 'Seleccionar carpeta de respaldos',
  });
  return typeof resultado === 'string' ? resultado : null;
}

// ─── Compresión gzip (sin dependencias extra) ────────────────────────────────

async function comprimirGzip(datos: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(datos);
  writer.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

// ─── Crear respaldo ───────────────────────────────────────────────────────────

export async function crearRespaldo(config: ConfigRespaldo): Promise<string> {
  if (!config.carpeta) throw new Error('No hay carpeta de respaldo configurada.');

  const appDir = await appDataDir();
  const tempPath = await join(appDir, 'inventario_snap.db');
  // VACUUM INTO requiere forward slashes en Windows
  const sqlitePath = tempPath.replace(/\\/g, '/');

  // Limpiar temp de una ejecución fallida anterior
  try { await remove(tempPath); } catch { /* no existía */ }

  // 1. Snapshot limpio sin cerrar la conexión activa
  const db = await getDbConnection();
  await db.execute(`VACUUM INTO '${sqlitePath.replace(/'/g, "''")}'`);

  // 2. Leer + comprimir en memoria (60-80% reducción)
  const bytes = await readFile(tempPath);
  const compressed = await comprimirGzip(bytes);

  // 3. Guardar con nombre sortable por fecha ISO
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const nombreArchivo = `inventario-${ts}.db.gz`;
  const destPath = await join(config.carpeta, nombreArchivo);
  await writeFile(destPath, compressed);

  // 4. Eliminar snapshot temporal
  await remove(tempPath);

  // 5. Rotar: eliminar los más viejos que superen el límite
  await podarRespaldos(config.carpeta, config.limite);

  // 6. Persistir timestamp
  guardarConfigRespaldo({ ...config, ultimoRespaldo: new Date().toISOString() });

  return nombreArchivo;
}

// ─── Poda (rotación automática) ──────────────────────────────────────────────

async function podarRespaldos(carpeta: string, limite: number): Promise<void> {
  const entries = await readDir(carpeta);
  const backups = entries
    .filter(e => e.isFile && e.name?.startsWith('inventario-') && e.name.endsWith('.db.gz'))
    .map(e => e.name!)
    .sort(); // nombre ISO → orden cronológico natural

  const aEliminar = backups.slice(0, Math.max(0, backups.length - limite));
  for (const nombre of aEliminar) {
    try { await remove(await join(carpeta, nombre)); } catch { /* ignorar */ }
  }
}

// ─── Listado para UI ─────────────────────────────────────────────────────────

export interface InfoRespaldo {
  nombre: string;
  ruta: string;
  fecha: Date;
  tamanoBytes: number;
}

export async function listarRespaldos(carpeta: string): Promise<InfoRespaldo[]> {
  if (!carpeta) return [];
  try {
    const entries = await readDir(carpeta);
    const backups = entries.filter(
      e => e.isFile && e.name?.startsWith('inventario-') && e.name.endsWith('.db.gz')
    );

    const resultado: InfoRespaldo[] = [];
    for (const e of backups) {
      const ruta = await join(carpeta, e.name!);
      try {
        const info = await stat(ruta);
        const fecha = parseFechaDesdeNombre(e.name!) ?? info.mtime ?? new Date();
        resultado.push({ nombre: e.name!, ruta, fecha, tamanoBytes: Number(info.size) });
      } catch { /* ignorar */ }
    }
    return resultado.sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
  } catch {
    return [];
  }
}

function parseFechaDesdeNombre(nombre: string): Date | null {
  // "inventario-2026-06-16T14-30-00.db.gz" → Date
  const m = nombre.match(/inventario-(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})\.db\.gz/);
  if (!m) return null;
  return new Date(`${m[1]}:${m[2]}:${m[3]}`);
}

export async function eliminarRespaldo(ruta: string): Promise<void> {
  await remove(ruta);
}

// ─── Respaldo automático ──────────────────────────────────────────────────────

export function respaldoEsNecesario(config: ConfigRespaldo): boolean {
  if (!config.carpeta || config.intervaloHoras <= 0) return false;
  if (!config.ultimoRespaldo) return true;
  const transcurrido = Date.now() - new Date(config.ultimoRespaldo).getTime();
  return transcurrido >= config.intervaloHoras * 3_600_000;
}

export async function verificarRespaldoAutomatico(): Promise<void> {
  const config = obtenerConfigRespaldo();
  console.info('[Respaldo] Verificando necesidad de respaldo automático...', {
    carpeta: config.carpeta || '(no configurada)',
    intervaloHoras: config.intervaloHoras,
    ultimoRespaldo: config.ultimoRespaldo ?? '(nunca)',
    esNecesario: respaldoEsNecesario(config),
  });
  if (!respaldoEsNecesario(config)) return;
  try {
    const nombre = await crearRespaldo(config);
    console.info('[Respaldo] Automático creado:', nombre, new Date().toLocaleString());
  } catch (err) {
    console.error('[Respaldo] Error en respaldo automático:', err);
    // Notificación no bloqueante para el usuario
    try {
      const { mostrarAlerta } = await import('../utils/alertGlobal');
      mostrarAlerta(
        `El respaldo automático falló: ${err instanceof Error ? err.message : String(err)}`,
        'advertencia'
      );
    } catch { /* si alertGlobal no está listo, ignorar */ }
  }
}
