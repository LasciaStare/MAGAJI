export interface CampoConfig {
  nombre: string;
  label: string;
  tipo: 'text' | 'email' | 'tel' | 'textarea';
  placeholder?: string;
  obligatorio?: boolean;
  columnaCompleta?: boolean;
  /** Si es true, el valor se persiste dentro de la columna datos_extra (JSON) en lugar de una columna propia. */
  esExtra?: boolean;
}

/** Para agregar, reordenar o quitar un campo solo edita este archivo — sin tocar la lógica del componente ni hacer migraciones. */

export const CAMPOS_CLIENTE_NORMAL: CampoConfig[] = [
  {
    nombre: 'nombre',
    label: 'Nombre Completo / Razón Social',
    tipo: 'text',
    placeholder: 'Ej. Juan Pérez o Empresa SAS',
    obligatorio: true,
    columnaCompleta: true,
  },
  {
    nombre: 'documento',
    label: 'Documento (CC / NIT / Pasaporte)',
    tipo: 'text',
    placeholder: 'Número de documento',
  },
  {
    nombre: 'telefono',
    label: 'Teléfono Móvil / Fijo',
    tipo: 'tel',
    placeholder: 'Ej. 300 123 4567',
  },
  {
    nombre: 'correo',
    label: 'Correo Electrónico',
    tipo: 'email',
    placeholder: 'cliente@correo.com',
    columnaCompleta: true,
  },
  {
    nombre: 'direccion',
    label: 'Dirección Física',
    tipo: 'text',
    placeholder: 'Calle, Carrera, Barrio, Ciudad...',
    columnaCompleta: true,
  },
  {
    nombre: 'notas',
    label: 'Notas Adicionales',
    tipo: 'textarea',
    placeholder: 'Ej. Prefiere factura electrónica, cliente mayorista...',
    columnaCompleta: true,
  },
];

export const CAMPOS_FUNDACION: CampoConfig[] = [
  {
    nombre: 'nombre',
    label: 'Nombre de la Fundación / ONG',
    tipo: 'text',
    placeholder: 'Ej. Fundación Corazón Verde',
    obligatorio: true,
    columnaCompleta: true,
  },
  {
    nombre: 'documento',
    label: 'NIT',
    tipo: 'text',
    placeholder: 'NIT de la organización',
  },
  {
    nombre: 'telefono',
    label: 'Teléfono Institucional',
    tipo: 'tel',
    placeholder: 'Ej. 601 234 5678',
  },
  {
    nombre: 'correo',
    label: 'Correo Institucional',
    tipo: 'email',
    placeholder: 'info@fundacion.org',
    columnaCompleta: true,
  },
  {
    nombre: 'direccion',
    label: 'Dirección Sede',
    tipo: 'text',
    placeholder: 'Dirección física de la sede principal',
    columnaCompleta: true,
  },
  {
    nombre: 'notas',
    label: 'Notas / Descripción',
    tipo: 'textarea',
    placeholder: 'Convenios, acuerdos especiales, descripción...',
    columnaCompleta: true,
  },
];

export const CAMPOS_MIEMBRO: CampoConfig[] = [
  {
    nombre: 'nombre',
    label: 'Nombre del Miembro',
    tipo: 'text',
    placeholder: 'Nombre completo',
    obligatorio: true,
    columnaCompleta: true,
  },
  {
    nombre: 'documento',
    label: 'Cod Fundación',
    tipo: 'text',
    placeholder: 'Código de la fundación',
  },
  {
    nombre: 'telefono',
    label: 'Teléfono',
    tipo: 'tel',
    placeholder: 'Ej. 300 123 4567',
  },
  {
    nombre: 'correo',
    label: 'Correo',
    tipo: 'email',
    placeholder: 'miembro@correo.com',
    columnaCompleta: true,
  },
  {
    nombre: 'cargo',
    label: 'Cargo / Rol en la Fundación',
    tipo: 'text',
    placeholder: 'Ej. Directivo, Beneficiario, Voluntario',
    esExtra: true,
    columnaCompleta: true,
  },
  {
    nombre: 'notas',
    label: 'Notas',
    tipo: 'textarea',
    placeholder: 'Información relevante del miembro...',
    columnaCompleta: true,
  },
];
