/**
 * auth.ts — Gestión de contraseña del Administrador
 * La contraseña se almacena como hash SHA-256 en localStorage.
 * Nunca se guarda en texto plano.
 */

const STORAGE_KEY = 'pos_admin_hash';

// Hash SHA-256 de "admin" (contraseña por defecto)
const HASH_DEFAULT = '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918';

/** Convierte un string a su representación hex SHA-256 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Devuelve el hash guardado (o el hash por defecto si no hay ninguno) */
function getHashGuardado(): string {
  return localStorage.getItem(STORAGE_KEY) ?? HASH_DEFAULT;
}

/** Verifica si la contraseña dada es correcta */
export async function verificarPassword(password: string): Promise<boolean> {
  const hash = await hashPassword(password);
  return hash === getHashGuardado();
}

/**
 * Cambia la contraseña del administrador.
 * @returns true si el cambio fue exitoso, false si la contraseña antigua es incorrecta.
 */
export async function cambiarPassword(antigua: string, nueva: string): Promise<boolean> {
  const esValida = await verificarPassword(antigua);
  if (!esValida) return false;
  const nuevoHash = await hashPassword(nueva);
  localStorage.setItem(STORAGE_KEY, nuevoHash);
  return true;
}

/** Indica si hay una contraseña personalizada guardada (o se usa la por defecto) */
export function hayPasswordPersonalizado(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}
