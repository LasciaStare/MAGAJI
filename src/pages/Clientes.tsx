import { useState, useEffect } from 'react';
import {
  Plus, Edit, Trash2, UserCircle, X, Save, UserPlus, Users,
  Search, Building2, ChevronRight, User, AlertTriangle,
  SlidersHorizontal, ChevronUp, ChevronDown, RotateCcw,
} from 'lucide-react';
import {
  crearCliente, actualizarCliente, eliminarCliente, correoValido, mensajeError,
  contarVentasCliente, eliminarClienteReasignando, eliminarClienteConTodo,
  Cliente, Fundacion,
  crearFundacion, obtenerFundaciones, actualizarFundacion, eliminarFundacion,
  crearMiembro, obtenerMiembrosPorFundacion, obtenerClientesNormales, obtenerClientes,
} from '../database/db';
import { mostrarAlerta } from '../utils/alertGlobal';
import {
  CampoConfig,
  CAMPOS_CLIENTE_NORMAL, CAMPOS_FUNDACION, CAMPOS_MIEMBRO,
} from '../config/camposFormulario';

// ── localStorage para esquemas de campos ──────────────────────────────────────

const STORAGE_KEYS = {
  cliente: 'pos_campos_clientes',
  fundacion: 'pos_campos_fundacion',
  miembro: 'pos_campos_miembro',
} as const;

export type TipoEsquema = keyof typeof STORAGE_KEYS;

const DEFAULTS: Record<TipoEsquema, CampoConfig[]> = {
  cliente: CAMPOS_CLIENTE_NORMAL,
  fundacion: CAMPOS_FUNDACION,
  miembro: CAMPOS_MIEMBRO,
};

export function cargarEsquema(tipo: TipoEsquema): CampoConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[tipo]);
    if (raw) return JSON.parse(raw) as CampoConfig[];
  } catch { /* usa default */ }
  return DEFAULTS[tipo];
}

function guardarEsquema(tipo: TipoEsquema, campos: CampoConfig[]) {
  localStorage.setItem(STORAGE_KEYS[tipo], JSON.stringify(campos));
}

// ── helpers de formulario ────────────────────────────────────────────────────

function valoresDesde(data: Record<string, unknown>, campos: CampoConfig[]): Record<string, string> {
  const extras = (() => {
    try { return JSON.parse(String(data.datos_extra ?? '{}')); } catch { return {}; }
  })();
  const vals: Record<string, string> = {};
  for (const c of campos) {
    vals[c.nombre] = String(c.esExtra ? (extras[c.nombre] ?? '') : (data[c.nombre] ?? ''));
  }
  return vals;
}

function valorCampo(c: Cliente, campo: CampoConfig): string {
  if (campo.esExtra) {
    try { return JSON.parse(c.datos_extra ?? '{}')[campo.nombre] ?? ''; } catch { return ''; }
  }
  return String((c as unknown as Record<string, unknown>)[campo.nombre] ?? '');
}

function buildDatosExtra(vals: Record<string, string>, campos: CampoConfig[]): string {
  const extras: Record<string, string> = {};
  for (const c of campos.filter(x => x.esExtra)) {
    if (vals[c.nombre]) extras[c.nombre] = vals[c.nombre];
  }
  return JSON.stringify(extras);
}

function clienteDesde(vals: Record<string, string>, campos: CampoConfig[]): Cliente {
  return {
    nombre: vals.nombre ?? '',
    documento: vals.documento ?? '',
    telefono: vals.telefono ?? '',
    correo: vals.correo ?? '',
    direccion: vals.direccion ?? '',
    notas: vals.notas ?? '',
    datos_extra: buildDatosExtra(vals, campos),
  };
}

function fundacionDesde(vals: Record<string, string>, campos: CampoConfig[]): Fundacion {
  return {
    nombre: vals.nombre ?? '',
    documento: vals.documento ?? '',
    telefono: vals.telefono ?? '',
    correo: vals.correo ?? '',
    direccion: vals.direccion ?? '',
    notas: vals.notas ?? '',
    datos_extra: buildDatosExtra(vals, campos),
  };
}

// ── tipos internos ────────────────────────────────────────────────────────────

type Pestaña = 'normales' | 'fundaciones';
type ModoModal = 'cliente' | 'fundacion' | 'miembro';

// ── componente ────────────────────────────────────────────────────────────────

export default function Clientes() {
  // ── tab principal ──
  const [pestaña, setPestaña] = useState<Pestaña>('normales');

  // ── normales ──
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [busquedaNormales, setBusquedaNormales] = useState('');

  // ── fundaciones ──
  const [fundaciones, setFundaciones] = useState<Fundacion[]>([]);
  const [fundacionActiva, setFundacionActiva] = useState<Fundacion | null>(null);
  const [miembros, setMiembros] = useState<Cliente[]>([]);
  const [busquedaFund, setBusquedaFund] = useState('');
  const [busquedaMiembro, setBusquedaMiembro] = useState('');

  // ── modal CRUD ──
  const [modal, setModal] = useState<{ abierto: boolean; modo: ModoModal; idEditando: number | null }>({
    abierto: false, modo: 'cliente', idEditando: null,
  });
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  // ── esquemas de campos (desde localStorage) ──
  const [esquemas, setEsquemas] = useState<Record<TipoEsquema, CampoConfig[]>>(() => ({
    cliente: cargarEsquema('cliente'),
    fundacion: cargarEsquema('fundacion'),
    miembro: cargarEsquema('miembro'),
  }));

  // ── panel de configuración de campos ──
  const [panelConfig, setPanelConfig] = useState(false);
  const [tabConfig, setTabConfig] = useState<TipoEsquema>('cliente');
  const [borradores, setBorradores] = useState<Record<TipoEsquema, CampoConfig[]>>({
    cliente: [], fundacion: [], miembro: [],
  });
  const [agregarAbierto, setAgregarAbierto] = useState(false);
  const [nuevoLabel, setNuevoLabel] = useState('');
  const [nuevoTipo, setNuevoTipo] = useState<CampoConfig['tipo']>('text');
  const [nuevoObligatorio, setNuevoObligatorio] = useState(false);
  const [nuevoCompleto, setNuevoCompleto] = useState(false);

  // ── modal eliminar cliente con ventas ──
  const [modalEliminar, setModalEliminar] = useState<{
    abierto: boolean;
    cliente: Cliente | null;
    cantidadVentas: number;
    modoDestino: 'consumidor' | 'cliente';
    reasignarTargetId: number | null;
    busquedaReasignar: string;
    clientesParaReasignar: Cliente[];
  }>({
    abierto: false,
    cliente: null,
    cantidadVentas: 0,
    modoDestino: 'consumidor',
    reasignarTargetId: null,
    busquedaReasignar: '',
    clientesParaReasignar: [],
  });

  // ── carga de datos ──
  useEffect(() => { cargarClientes(); cargarFundaciones(); }, []);
  useEffect(() => { if (pestaña === 'fundaciones') cargarFundaciones(); }, [pestaña]);
  useEffect(() => {
    setBusquedaMiembro('');
    if (fundacionActiva?.id != null) cargarMiembros(fundacionActiva.id);
    else setMiembros([]);
  }, [fundacionActiva]);

  async function cargarClientes() {
    try { setClientes(await obtenerClientesNormales()); } catch (e) { console.error(e); }
  }
  async function cargarFundaciones() {
    try {
      const lista = await obtenerFundaciones();
      setFundaciones(lista);
      if (fundacionActiva?.id != null)
        setFundacionActiva(lista.find(f => f.id === fundacionActiva.id) ?? null);
    } catch (e) { console.error(e); }
  }
  async function cargarMiembros(fid: number) {
    try { setMiembros(await obtenerMiembrosPorFundacion(fid)); } catch (e) { console.error(e); }
  }

  // ── esquema activo para el modal en curso ──
  function camposModal(): CampoConfig[] {
    if (modal.modo === 'fundacion') return esquemas.fundacion;
    if (modal.modo === 'miembro') return esquemas.miembro;
    return esquemas.cliente;
  }

  // ── abrir modal CRUD ──
  function abrirCrearCliente() {
    setFormValues(valoresDesde({}, esquemas.cliente));
    setModal({ abierto: true, modo: 'cliente', idEditando: null });
  }
  function abrirEditarCliente(c: Cliente) {
    setFormValues(valoresDesde(c as unknown as Record<string, unknown>, esquemas.cliente));
    setModal({ abierto: true, modo: 'cliente', idEditando: c.id! });
  }
  function abrirCrearFundacion() {
    setFormValues(valoresDesde({}, esquemas.fundacion));
    setModal({ abierto: true, modo: 'fundacion', idEditando: null });
  }
  function abrirEditarFundacion(f: Fundacion) {
    setFormValues(valoresDesde(f as unknown as Record<string, unknown>, esquemas.fundacion));
    setModal({ abierto: true, modo: 'fundacion', idEditando: f.id! });
  }
  function abrirCrearMiembro() {
    setFormValues(valoresDesde({}, esquemas.miembro));
    setModal({ abierto: true, modo: 'miembro', idEditando: null });
  }
  function abrirEditarMiembro(m: Cliente) {
    setFormValues(valoresDesde(m as unknown as Record<string, unknown>, esquemas.miembro));
    setModal({ abierto: true, modo: 'miembro', idEditando: m.id! });
  }

  // ── guardar CRUD ──
  async function handleGuardar() {
    const campos = camposModal();

    for (const c of campos.filter(x => x.obligatorio)) {
      if (!(formValues[c.nombre] ?? '').trim()) {
        mostrarAlerta(`El campo "${c.label}" es obligatorio.`, 'advertencia');
        return;
      }
    }
    // Valida email solo si el campo correo existe con tipo email en el esquema activo
    const correoField = campos.find(c => c.nombre === 'correo' && c.tipo === 'email');
    if (correoField && !correoValido(formValues.correo ?? '')) {
      mostrarAlerta('El correo electrónico no tiene un formato válido.', 'advertencia');
      return;
    }

    try {
      if (modal.modo === 'cliente') {
        const data = clienteDesde(formValues, campos);
        if (modal.idEditando !== null) await actualizarCliente(modal.idEditando, data);
        else await crearCliente(data);
        await cargarClientes();
      } else if (modal.modo === 'fundacion') {
        const data = fundacionDesde(formValues, campos);
        if (modal.idEditando !== null) await actualizarFundacion(modal.idEditando, data);
        else await crearFundacion(data);
        await cargarFundaciones();
      } else {
        const data = clienteDesde(formValues, campos);
        if (modal.idEditando !== null) {
          await actualizarCliente(modal.idEditando, { ...data, tipo: 'miembro' });
        } else {
          await crearMiembro(data, fundacionActiva!.id!, fundacionActiva!.nombre);
        }
        await cargarMiembros(fundacionActiva!.id!);
      }
      setModal(m => ({ ...m, abierto: false }));
    } catch (error) {
      mostrarAlerta(mensajeError(error, 'No se pudo guardar. Verifique los datos e intente de nuevo.'), 'error');
    }
  }

  // ── eliminar ──
  function cerrarModalEliminar() {
    setModalEliminar({
      abierto: false,
      cliente: null,
      cantidadVentas: 0,
      modoDestino: 'consumidor',
      reasignarTargetId: null,
      busquedaReasignar: '',
      clientesParaReasignar: [],
    });
  }

  async function abrirModalEliminar(clienteObj: Cliente, cantidad: number) {
    try {
      const todos = await obtenerClientes();
      const disponibles = todos.filter(c => c.id !== clienteObj.id);
      setModalEliminar({
        abierto: true,
        cliente: clienteObj,
        cantidadVentas: cantidad,
        modoDestino: 'consumidor',
        reasignarTargetId: null,
        busquedaReasignar: '',
        clientesParaReasignar: disponibles,
      });
    } catch (e) {
      console.error(e);
    }
  }

  async function handleEliminarCliente(id: number, nombre: string) {
    const cantidad = await contarVentasCliente(id);
    if (cantidad > 0) {
      const clienteObj = clientes.find(c => c.id === id) ?? { id, nombre, documento: '', telefono: '', correo: '', direccion: '', notas: '' };
      await abrirModalEliminar(clienteObj, cantidad);
    } else {
      if (!confirm(`¿Eliminar al cliente "${nombre}"?`)) return;
      try { await eliminarCliente(id); await cargarClientes(); }
      catch (e) { mostrarAlerta(mensajeError(e, 'No se pudo eliminar el cliente.'), 'error'); }
    }
  }

  async function handleReasignarYEliminar() {
    if (!modalEliminar.cliente?.id) return;
    const targetId = modalEliminar.modoDestino === 'cliente' ? modalEliminar.reasignarTargetId : null;
    try {
      await eliminarClienteReasignando(modalEliminar.cliente.id, targetId);
      await cargarClientes();
      if (fundacionActiva?.id != null) await cargarMiembros(fundacionActiva.id);
      const targetNombre = targetId
        ? (modalEliminar.clientesParaReasignar.find(c => c.id === targetId)?.nombre || 'otro cliente')
        : 'Consumidor Final';
      cerrarModalEliminar();
      mostrarAlerta(`Cliente eliminado. Sus ventas se reasignaron a ${targetNombre}.`, 'info');
    } catch (e) { mostrarAlerta(mensajeError(e, 'No se pudo eliminar el cliente.'), 'error'); }
  }

  async function handleEliminarConTodo() {
    if (!modalEliminar.cliente?.id) return;
    if (!confirm(`¿Confirma eliminar "${modalEliminar.cliente.nombre}" y sus ${modalEliminar.cantidadVentas} venta(s)? Esta acción no se puede deshacer.`)) return;
    try {
      await eliminarClienteConTodo(modalEliminar.cliente.id);
      await cargarClientes();
      if (fundacionActiva?.id != null) await cargarMiembros(fundacionActiva.id);
      cerrarModalEliminar();
      mostrarAlerta('Cliente y sus ventas han sido eliminados del sistema.', 'info');
    } catch (e) { mostrarAlerta(mensajeError(e, 'No se pudo eliminar.'), 'error'); }
  }

  async function handleEliminarFundacion(f: Fundacion) {
    if (!confirm(`¿Eliminar la fundación "${f.nombre}"?\nSolo es posible si no tiene miembros registrados.`)) return;
    try {
      await eliminarFundacion(f.id!);
      if (fundacionActiva?.id === f.id) setFundacionActiva(null);
      await cargarFundaciones();
    } catch (e) { mostrarAlerta(mensajeError(e, 'No se pudo eliminar la fundación.'), 'error'); }
  }

  async function handleEliminarMiembro(id: number, nombre: string) {
    const cantidad = await contarVentasCliente(id);
    if (cantidad > 0) {
      const clienteObj = miembros.find(m => m.id === id) ?? { id, nombre, documento: '', telefono: '', correo: '', direccion: '', notas: '' };
      await abrirModalEliminar(clienteObj, cantidad);
    } else {
      if (!confirm(`¿Eliminar al miembro "${nombre}"?`)) return;
      try {
        await eliminarCliente(id);
        if (fundacionActiva?.id != null) await cargarMiembros(fundacionActiva.id);
      } catch (e) {
        mostrarAlerta(mensajeError(e, 'No se pudo eliminar el miembro.'), 'error');
      }
    }
  }

  // ── configuración de campos ──────────────────────────────────────────────────

  function abrirConfig() {
    setBorradores({
      cliente: esquemas.cliente.map(c => ({ ...c })),
      fundacion: esquemas.fundacion.map(c => ({ ...c })),
      miembro: esquemas.miembro.map(c => ({ ...c })),
    });
    setTabConfig('cliente');
    setAgregarAbierto(false);
    setNuevoLabel('');
    setPanelConfig(true);
  }

  function getBorrador(): CampoConfig[] {
    return borradores[tabConfig] ?? [];
  }

  function actualizarCampo(idx: number, clave: keyof CampoConfig, valor: unknown) {
    setBorradores(prev => ({
      ...prev,
      [tabConfig]: prev[tabConfig].map((c, i) => i === idx ? { ...c, [clave]: valor } : c),
    }));
  }

  function moverCampo(idx: number, dir: -1 | 1) {
    setBorradores(prev => {
      const next = [...prev[tabConfig]];
      const [item] = next.splice(idx, 1);
      next.splice(idx + dir, 0, item);
      return { ...prev, [tabConfig]: next };
    });
  }

  function eliminarCampoConfig(idx: number) {
    setBorradores(prev => ({
      ...prev,
      [tabConfig]: prev[tabConfig].filter((_, i) => i !== idx),
    }));
  }

  function agregarCampo() {
    const label = nuevoLabel.trim();
    if (!label) { mostrarAlerta('Escribe un nombre para el nuevo campo.', 'advertencia'); return; }

    // Derivar nombre de clave desde el label
    let nombre = label.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
    if (!nombre) nombre = `campo_${Date.now()}`;

    // Evitar colisiones con nombres existentes en el borrador
    const usados = new Set(getBorrador().map(c => c.nombre));
    let candidato = nombre;
    let sufijo = 2;
    while (usados.has(candidato)) { candidato = `${nombre}_${sufijo++}`; }

    const nuevo: CampoConfig = {
      nombre: candidato,
      label,
      tipo: nuevoTipo,
      obligatorio: nuevoObligatorio,
      columnaCompleta: nuevoCompleto,
      esExtra: true,
    };
    setBorradores(prev => ({ ...prev, [tabConfig]: [...prev[tabConfig], nuevo] }));
    setNuevoLabel('');
    setNuevoTipo('text');
    setNuevoObligatorio(false);
    setNuevoCompleto(false);
    setAgregarAbierto(false);
  }

  function resetearBorrador() {
    if (!confirm(`¿Restaurar los campos de "${LABELS_TIPO[tabConfig]}" a los valores por defecto?`)) return;
    setBorradores(prev => ({ ...prev, [tabConfig]: DEFAULTS[tabConfig].map(c => ({ ...c })) }));
  }

  function guardarConfig() {
    for (const tipo of (['cliente', 'fundacion', 'miembro'] as TipoEsquema[])) {
      guardarEsquema(tipo, borradores[tipo]);
    }
    setEsquemas({ ...borradores });
    setPanelConfig(false);
  }

  // ── listas filtradas ──
  const clientesFiltrados = clientes.filter(c =>
    c.nombre.toLowerCase().includes(busquedaNormales.toLowerCase()) ||
    (c.documento ?? '').toLowerCase().includes(busquedaNormales.toLowerCase()) ||
    (c.correo ?? '').toLowerCase().includes(busquedaNormales.toLowerCase())
  );
  const fundacionesFiltradas = fundaciones.filter(f =>
    f.nombre.toLowerCase().includes(busquedaFund.toLowerCase()) ||
    (f.documento ?? '').toLowerCase().includes(busquedaFund.toLowerCase())
  );
  const miembrosFiltrados = miembros.filter(m =>
    m.nombre.toLowerCase().includes(busquedaMiembro.toLowerCase()) ||
    (m.codigo_miembro ?? '').toLowerCase().includes(busquedaMiembro.toLowerCase()) ||
    (m.documento ?? '').toLowerCase().includes(busquedaMiembro.toLowerCase())
  );

  // Columnas de la tabla de clientes: todo excepto 'nombre' y textareas, máximo 3
  const columnasTabla = esquemas.cliente
    .filter(c => c.nombre !== 'nombre' && c.tipo !== 'textarea')
    .slice(0, 3);

  // Columnas de la tabla de miembros: todo excepto 'nombre' y textareas, máximo 3
  const columnasTablaFundacion = esquemas.miembro
    .filter(c => c.nombre !== 'nombre' && c.tipo !== 'textarea')
    .slice(0, 3);

  // ── misc ──
  const LABELS_TIPO: Record<TipoEsquema, string> = {
    cliente: 'Clientes',
    fundacion: 'Fundaciones',
    miembro: 'Miembros',
  };

  function tituloModal() {
    if (modal.modo === 'fundacion') return modal.idEditando ? 'Editar Fundación' : 'Registrar Nueva Fundación';
    if (modal.modo === 'miembro') return modal.idEditando ? 'Editar Miembro' : `Nuevo Miembro — ${fundacionActiva?.nombre ?? ''}`;
    return modal.idEditando ? 'Editar Cliente' : 'Registrar Nuevo Cliente';
  }

  function renderCampo(campo: CampoConfig, autoFocus = false) {
    const base = 'w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary focus:ring-1 focus:ring-pos-primary';
    const value = formValues[campo.nombre] ?? '';
    const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setFormValues(prev => ({ ...prev, [campo.nombre]: e.target.value }));
    return (
      <div key={campo.nombre} className={campo.columnaCompleta ? 'md:col-span-2' : ''}>
        <label className="block text-xs font-medium text-slate-500 mb-1">
          {campo.label} {campo.obligatorio && <span className="text-red-500">*</span>}
        </label>
        {campo.tipo === 'textarea' ? (
          <textarea name={campo.nombre} value={value} onChange={onChange}
            placeholder={campo.placeholder} rows={2} className={`${base} resize-none`} />
        ) : (
          <input name={campo.nombre} type={campo.tipo} value={value} onChange={onChange}
            placeholder={campo.placeholder} autoFocus={autoFocus} className={base} />
        )}
      </div>
    );
  }

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col overflow-hidden relative pos-fade-in">

      {/* Barra de pestañas */}
      <div className="px-8 pt-6 pb-0 shrink-0">
        <div className="flex items-end gap-1 border-b border-slate-200">
          {(['normales', 'fundaciones'] as Pestaña[]).map(p => (
            <button key={p}
              onClick={() => setPestaña(p)}
              className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${
                pestaña === p
                  ? 'border-pos-primary text-pos-primary bg-emerald-50'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {p === 'normales' ? <User className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
              {p === 'normales' ? 'Clientes' : 'Fundaciones'}
              <span className="ml-0.5 bg-slate-200 text-slate-600 text-xs font-bold rounded-full px-2 py-0.5 leading-none">
                {p === 'normales' ? clientes.length : fundaciones.length}
              </span>
            </button>
          ))}

          {/* Botón configurar campos */}
          <button
            onClick={abrirConfig}
            title="Configurar campos de los formularios"
            className="ml-auto mb-1 flex items-center gap-1.5 text-xs text-slate-500 hover:text-pos-primary border border-slate-200 hover:border-pos-primary px-3 py-1.5 rounded-lg transition bg-white"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" /> Campos del formulario
          </button>
        </div>
      </div>

      {/* ── Pestaña: Clientes Normales ── */}
      {pestaña === 'normales' && (
        <div className="p-8 pt-6 flex-1 flex gap-6 overflow-hidden">
          <aside className="w-64 flex flex-col shrink-0 bg-white border border-slate-200 rounded-xl p-4 shadow-sm overflow-hidden">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Users className="w-4 h-4" /> Directorio
            </h3>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" placeholder="Buscar cliente..."
                value={busquedaNormales} onChange={e => setBusquedaNormales(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-pos-primary bg-slate-50"
              />
            </div>
            <div className="bg-slate-50 border border-slate-200 p-3 rounded-lg text-center">
              <p className="text-2xl font-bold text-pos-primary-dark">{clientes.length}</p>
              <p className="text-xs text-slate-500 uppercase font-medium">Registrados</p>
            </div>
          </aside>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex justify-between items-center mb-6 shrink-0">
              <div>
                <h2 className="text-xl font-bold text-slate-800">Cartera de Clientes</h2>
                <p className="text-sm text-slate-500">Gestione la información para facturación rápida</p>
              </div>
              <button onClick={abrirCrearCliente}
                className="flex items-center gap-2 bg-pos-primary text-white font-bold px-5 py-2.5 rounded-xl hover:bg-pos-primary-dark transition shadow-md">
                <Plus className="w-5 h-5" /> Agregar Cliente
              </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 flex flex-col overflow-hidden">
              <div className="overflow-auto flex-1">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-slate-50 text-slate-600 sticky top-0 border-b border-slate-200 z-10">
                    <tr>
                      <th className="p-4 font-semibold">Cliente</th>
                      {columnasTabla.map(col => (
                        <th key={col.nombre} className="p-4 font-semibold">{col.label}</th>
                      ))}
                      <th className="p-4 font-semibold text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700 divide-y divide-slate-100">
                    {clientesFiltrados.length === 0 ? (
                      <tr><td colSpan={columnasTabla.length + 2} className="p-8 text-center text-slate-500">
                        {busquedaNormales ? 'No se encontraron clientes con esa búsqueda.' : 'No hay clientes registrados.'}
                      </td></tr>
                    ) : clientesFiltrados.map(c => (
                      <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 font-medium">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                              <UserCircle className="w-5 h-5" />
                            </div>
                            <span className="truncate max-w-[200px]" title={c.nombre}>{c.nombre}</span>
                          </div>
                        </td>
                        {columnasTabla.map(col => (
                          <td key={col.nombre} className="p-4 text-slate-500 truncate max-w-[160px]">
                            {valorCampo(c, col) || '—'}
                          </td>
                        ))}
                        <td className="p-4 text-center space-x-3">
                          <button onClick={() => abrirEditarCliente(c)} title="Editar"
                            className="text-slate-400 hover:text-blue-600 transition p-1"><Edit className="w-4 h-4 inline" /></button>
                          <button onClick={() => handleEliminarCliente(c.id!, c.nombre)} title="Eliminar"
                            className="text-slate-400 hover:text-red-600 transition p-1"><Trash2 className="w-4 h-4 inline" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Pestaña: Fundaciones ── */}
      {pestaña === 'fundaciones' && (
        <div className="p-8 pt-6 flex-1 flex gap-6 overflow-hidden">
          <aside className="w-72 flex flex-col shrink-0 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="p-3 border-b border-slate-100">
              <button onClick={abrirCrearFundacion}
                className="w-full flex items-center justify-center gap-2 bg-pos-primary text-white font-bold px-4 py-2 rounded-lg hover:bg-pos-primary-dark transition text-sm">
                <Plus className="w-4 h-4" /> Nueva Fundación
              </button>
            </div>
            <div className="p-3 border-b border-slate-100">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input type="text" placeholder="Buscar fundación..."
                  value={busquedaFund} onChange={e => setBusquedaFund(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm outline-none focus:border-pos-primary bg-slate-50"
                />
              </div>
            </div>
            <div className="flex-1 overflow-auto divide-y divide-slate-100">
              {fundacionesFiltradas.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-400">
                  {busquedaFund ? 'Sin resultados.' : 'Sin fundaciones registradas.'}
                </p>
              ) : fundacionesFiltradas.map(f => (
                <button key={f.id} onClick={() => setFundacionActiva(f)}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                    fundacionActiva?.id === f.id
                      ? 'bg-emerald-50 border-l-2 border-l-pos-primary'
                      : 'hover:bg-slate-50 border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-purple-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 truncate">{f.nombre}</p>
                    {f.documento && <p className="text-xs text-slate-500 font-mono">{f.documento}</p>}
                  </div>
                  {fundacionActiva?.id === f.id && <ChevronRight className="w-4 h-4 text-pos-primary shrink-0" />}
                </button>
              ))}
            </div>
          </aside>

          <div className="flex-1 flex flex-col overflow-hidden">
            {!fundacionActiva ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
                <Building2 className="w-12 h-12 opacity-40" />
                <p className="font-semibold text-slate-500">Selecciona una fundación</p>
                <p className="text-sm">o crea una nueva desde el panel lateral</p>
              </div>
            ) : (
              <>
                <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 shrink-0 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
                        <Building2 className="w-5 h-5 text-purple-600" />
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-lg font-bold text-slate-800 truncate">{fundacionActiva.nombre}</h2>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm text-slate-500 mt-0.5">
                          {fundacionActiva.documento && <span className="font-mono">NIT: {fundacionActiva.documento}</span>}
                          {fundacionActiva.telefono && <span>{fundacionActiva.telefono}</span>}
                          {fundacionActiva.correo && <span className="truncate">{fundacionActiva.correo}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => abrirEditarFundacion(fundacionActiva)}
                        className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-blue-600 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition">
                        <Edit className="w-3.5 h-3.5" /> Editar
                      </button>
                      <button onClick={() => handleEliminarFundacion(fundacionActiva)}
                        className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-red-600 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition">
                        <Trash2 className="w-3.5 h-3.5" /> Eliminar
                      </button>
                    </div>
                  </div>
                  {fundacionActiva.notas && (
                    <p className="mt-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">{fundacionActiva.notas}</p>
                  )}
                </div>

                <div className="flex justify-between items-center mb-3 shrink-0">
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold text-slate-700">Miembros</h3>
                    <span className="bg-purple-100 text-purple-700 text-xs font-bold rounded-full px-2 py-0.5">{miembros.length}</span>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                      <input type="text" placeholder="Buscar miembro o código..."
                        value={busquedaMiembro} onChange={e => setBusquedaMiembro(e.target.value)}
                        className="pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm outline-none focus:border-pos-primary w-56 bg-white"
                      />
                    </div>
                  </div>
                  <button onClick={abrirCrearMiembro}
                    className="flex items-center gap-2 bg-pos-primary text-white font-bold px-4 py-2 rounded-xl hover:bg-pos-primary-dark transition shadow text-sm">
                    <UserPlus className="w-4 h-4" /> Nuevo Miembro
                  </button>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 flex flex-col overflow-hidden">
                  <div className="overflow-auto flex-1">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-slate-50 text-slate-600 sticky top-0 border-b border-slate-200 z-10">
                        <tr>
                          <th className="p-3 font-semibold">Miembro</th>
                          {columnasTablaFundacion.map(col => (
                            <th key={col.nombre} className="p-3 font-semibold">{col.label}</th>
                          ))}
                          <th className="p-3 font-semibold text-center">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-700 divide-y divide-slate-100">
                        {miembrosFiltrados.length === 0 ? (
                          <tr><td colSpan={columnasTablaFundacion.length + 2} className="p-8 text-center text-slate-500">
                            {busquedaMiembro ? 'No se encontraron miembros con esa búsqueda.' : 'Esta fundación no tiene miembros registrados aún.'}
                          </td></tr>
                        ) : miembrosFiltrados.map(m => (
                          <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                            <td className="p-3 font-medium">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                                  <UserCircle className="w-4 h-4 text-blue-600" />
                                </div>
                                <span className="truncate max-w-[180px]" title={m.nombre}>{m.nombre}</span>
                              </div>
                            </td>
                            {columnasTablaFundacion.map(col => (
                              <td key={col.nombre} className="p-3 text-slate-500 truncate max-w-[160px]">
                                {valorCampo(m, col) || '—'}
                              </td>
                            ))}
                            <td className="p-3 text-center space-x-3">
                              <button onClick={() => abrirEditarMiembro(m)} title="Editar"
                                className="text-slate-400 hover:text-blue-600 transition p-1"><Edit className="w-4 h-4 inline" /></button>
                              <button onClick={() => handleEliminarMiembro(m.id!, m.nombre)} title="Eliminar"
                                className="text-slate-400 hover:text-red-600 transition p-1"><Trash2 className="w-4 h-4 inline" /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Modal CRUD ── */}
      {modal.abierto && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 pos-overlay-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-full pos-modal-panel">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h3 className="text-xl font-bold text-slate-800">{tituloModal()}</h3>
              <button onClick={() => setModal(m => ({ ...m, abierto: false }))}
                className="text-slate-400 hover:bg-slate-100 p-2 rounded-full transition"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 overflow-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {camposModal().map((campo, i) => renderCampo(campo, i === 0))}
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl shrink-0">
              <button onClick={() => setModal(m => ({ ...m, abierto: false }))}
                className="px-6 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-100 transition">Cancelar</button>
              <button onClick={handleGuardar}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-pos-primary text-white font-bold hover:bg-pos-primary-dark transition shadow-md">
                <Save className="w-4 h-4" />
                {modal.idEditando !== null ? 'Guardar Cambios' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Panel: Configurar Campos ── */}
      {panelConfig && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 pos-overlay-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col pos-modal-panel" style={{ maxHeight: '90vh' }}>

            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-pos-primary" />
                <h3 className="text-lg font-bold text-slate-800">Configurar Campos del Formulario</h3>
              </div>
              <button onClick={() => setPanelConfig(false)}
                className="text-slate-400 hover:bg-slate-100 p-2 rounded-full transition"><X className="w-5 h-5" /></button>
            </div>

            {/* Sub-pestañas por tipo */}
            <div className="px-5 pt-4 pb-0 shrink-0">
              <div className="flex gap-1 border-b border-slate-200">
                {(['cliente', 'fundacion', 'miembro'] as TipoEsquema[]).map(t => (
                  <button key={t}
                    onClick={() => { setTabConfig(t); setAgregarAbierto(false); }}
                    className={`px-4 py-2 text-sm font-semibold rounded-t-md border-b-2 transition-colors ${
                      tabConfig === t
                        ? 'border-pos-primary text-pos-primary bg-emerald-50'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {LABELS_TIPO[t]}
                    <span className="ml-1.5 text-xs text-slate-400 font-normal">
                      ({borradores[t]?.length ?? 0})
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Lista de campos */}
            <div className="flex-1 overflow-auto p-5 space-y-2">

              {getBorrador().length === 0 && (
                <p className="text-center text-sm text-slate-400 py-4">Sin campos configurados. Agrega uno abajo.</p>
              )}

              {getBorrador().map((campo, i) => {
                const bd = getBorrador();
                const esProtegido = campo.nombre === 'nombre' && !campo.esExtra;
                return (
                  <div key={`${campo.nombre}-${i}`}
                    className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5">

                    {/* Fila principal */}
                    <div className="flex items-center gap-2">

                      {/* Subir / bajar */}
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button onClick={() => moverCampo(i, -1)} disabled={i === 0}
                          className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed rounded">
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => moverCampo(i, 1)} disabled={i === bd.length - 1}
                          className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed rounded">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Etiqueta */}
                      <input type="text" value={campo.label}
                        onChange={e => actualizarCampo(i, 'label', e.target.value)}
                        className="flex-1 border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-700 outline-none focus:border-pos-primary bg-white"
                        placeholder="Etiqueta del campo"
                      />

                      {/* Tipo */}
                      <select value={campo.tipo}
                        onChange={e => actualizarCampo(i, 'tipo', e.target.value as CampoConfig['tipo'])}
                        className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-600 outline-none focus:border-pos-primary bg-white"
                      >
                        <option value="text">Texto</option>
                        <option value="email">Email</option>
                        <option value="tel">Teléfono</option>
                        <option value="textarea">Párrafo</option>
                      </select>

                      {/* Obligatorio */}
                      <button
                        onClick={() => actualizarCampo(i, 'obligatorio', !campo.obligatorio)}
                        title={campo.obligatorio ? 'Obligatorio — clic para hacer opcional' : 'Opcional — clic para hacer obligatorio'}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold border-2 transition shrink-0 ${
                          campo.obligatorio
                            ? 'border-red-300 bg-red-50 text-red-500 shadow-sm'
                            : 'border-slate-200 text-slate-300 hover:border-slate-300 hover:text-slate-400'
                        }`}
                      >*</button>

                      {/* Ancho completo */}
                      <button
                        onClick={() => actualizarCampo(i, 'columnaCompleta', !campo.columnaCompleta)}
                        title={campo.columnaCompleta ? 'Ancho completo — clic para mitad' : 'Media columna — clic para ancho completo'}
                        className={`h-8 px-2 flex items-center justify-center rounded-lg text-xs font-mono font-bold border-2 transition shrink-0 ${
                          campo.columnaCompleta
                            ? 'border-blue-300 bg-blue-50 text-blue-600 shadow-sm'
                            : 'border-slate-200 text-slate-300 hover:border-slate-300 hover:text-slate-400'
                        }`}
                      >{campo.columnaCompleta ? '1/1' : '1/2'}</button>

                      {/* Eliminar */}
                      <button
                        onClick={() => eliminarCampoConfig(i)}
                        disabled={esProtegido}
                        title={esProtegido ? 'El campo "Nombre" no puede eliminarse' : 'Eliminar campo'}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 border border-slate-200 hover:border-red-200 transition shrink-0 disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:text-slate-300 disabled:hover:bg-transparent disabled:hover:border-slate-200"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Fila placeholder */}
                    <div className="pl-7">
                      <input type="text" value={campo.placeholder ?? ''}
                        onChange={e => actualizarCampo(i, 'placeholder', e.target.value)}
                        className="w-full border border-dashed border-slate-300 rounded-lg px-2.5 py-1 text-xs text-slate-500 outline-none focus:border-pos-primary bg-white placeholder:text-slate-300"
                        placeholder="Texto de ejemplo (placeholder)…"
                      />
                    </div>

                    {/* Badge tipo campo */}
                    {campo.esExtra && (
                      <div className="pl-7">
                        <span className="text-xs text-purple-500 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">campo personalizado</span>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Agregar nuevo campo */}
              <div className="pt-1">
                {agregarAbierto ? (
                  <div className="border-2 border-dashed border-pos-primary/50 rounded-xl p-4 bg-emerald-50/50 space-y-3">
                    <p className="text-xs font-semibold text-pos-primary uppercase tracking-wide">Nuevo campo personalizado</p>
                    <div className="flex gap-2">
                      <input type="text" value={nuevoLabel}
                        onChange={e => setNuevoLabel(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && agregarCampo()}
                        placeholder="Ej. WhatsApp, Ciudad, Fecha de ingreso..."
                        autoFocus
                        className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-pos-primary bg-white"
                      />
                      <select value={nuevoTipo} onChange={e => setNuevoTipo(e.target.value as CampoConfig['tipo'])}
                        className="border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white outline-none focus:border-pos-primary">
                        <option value="text">Texto</option>
                        <option value="email">Email</option>
                        <option value="tel">Teléfono</option>
                        <option value="textarea">Párrafo</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <label className="flex items-center gap-2 cursor-pointer text-slate-600">
                        <input type="checkbox" checked={nuevoObligatorio} onChange={e => setNuevoObligatorio(e.target.checked)}
                          className="w-4 h-4 rounded accent-pos-primary" />
                        Obligatorio
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-slate-600">
                        <input type="checkbox" checked={nuevoCompleto} onChange={e => setNuevoCompleto(e.target.checked)}
                          className="w-4 h-4 rounded accent-pos-primary" />
                        Ancho completo
                      </label>
                      <div className="ml-auto flex gap-2">
                        <button onClick={() => setAgregarAbierto(false)}
                          className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg hover:bg-white transition">
                          Cancelar
                        </button>
                        <button onClick={agregarCampo}
                          className="px-4 py-1.5 text-sm bg-pos-primary text-white rounded-lg hover:bg-pos-primary-dark transition font-medium">
                          Agregar
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setAgregarAbierto(true)}
                    className="w-full py-2.5 border-2 border-dashed border-slate-300 rounded-xl text-sm text-slate-400 hover:border-pos-primary hover:text-pos-primary transition flex items-center justify-center gap-2">
                    <Plus className="w-4 h-4" /> Agregar campo personalizado
                  </button>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3 rounded-b-2xl shrink-0">
              <button onClick={resetearBorrador}
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 px-3 py-2 rounded-lg hover:bg-white transition">
                <RotateCcw className="w-3.5 h-3.5" /> Restaurar por defecto
              </button>
              <div className="flex gap-3">
                <button onClick={() => setPanelConfig(false)}
                  className="px-5 py-2 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-white transition text-sm">
                  Cancelar
                </button>
                <button onClick={guardarConfig}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-pos-primary text-white font-bold hover:bg-pos-primary-dark transition shadow-md text-sm">
                  <Save className="w-4 h-4" /> Guardar cambios
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: ELIMINAR CLIENTE CON VENTAS ── */}
      {modalEliminar.abierto && modalEliminar.cliente && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            {/* Encabezado */}
            <div className="flex items-start gap-4 mb-5">
              <div className="bg-amber-100 p-3 rounded-xl shrink-0">
                <AlertTriangle className="w-6 h-6 text-amber-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-slate-800 text-lg leading-tight">
                  Cliente con ventas registradas
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  <span className="font-semibold text-slate-700">{modalEliminar.cliente.nombre}</span>
                  {' '}tiene <span className="font-bold text-amber-600">{modalEliminar.cantidadVentas} venta(s)</span> asociada(s).
                </p>
              </div>
              <button
                onClick={cerrarModalEliminar}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Opción 1: Reasignar ventas y eliminar cliente */}
            <div className="border border-slate-200 rounded-xl p-4 mb-4 bg-slate-50">
              <h4 className="font-bold text-slate-800 text-sm mb-1">
                Opción 1: Conservar ventas y eliminar cliente
              </h4>
              <p className="text-xs text-slate-500 mb-3">
                El cliente será eliminado, pero sus ventas permanecerán registradas en el sistema.
              </p>

              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Reasignar ventas a:
              </label>

              <div className="space-y-2 mb-3">
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    name="reasignarDestino"
                    checked={modalEliminar.modoDestino === 'consumidor'}
                    onChange={() => setModalEliminar(prev => ({ ...prev, modoDestino: 'consumidor', reasignarTargetId: null }))}
                    className="accent-pos-primary"
                  />
                  <span>Consumidor Final</span>
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    name="reasignarDestino"
                    checked={modalEliminar.modoDestino === 'cliente'}
                    onChange={() => setModalEliminar(prev => ({ ...prev, modoDestino: 'cliente' }))}
                    className="accent-pos-primary"
                  />
                  <span>Otro cliente registrado</span>
                </label>
              </div>

              {modalEliminar.modoDestino === 'cliente' && (() => {
                const clienteDestino = modalEliminar.clientesParaReasignar.find(c => c.id === modalEliminar.reasignarTargetId);

                return (
                  <div className="mb-3 space-y-2">
                    {clienteDestino ? (
                      <div className="flex items-center justify-between p-3 bg-white border-2 border-pos-primary rounded-xl">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-emerald-100 text-pos-primary font-bold flex items-center justify-center text-xs">
                            {clienteDestino.nombre.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-800">{clienteDestino.nombre}</p>
                            <p className="text-xs text-slate-400 font-mono">{clienteDestino.documento || 'Sin documento'}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setModalEliminar(prev => ({ ...prev, reasignarTargetId: null }))}
                          className="text-xs text-pos-primary hover:underline font-semibold px-2 py-1"
                        >
                          Cambiar
                        </button>
                      </div>
                    ) : (
                      <div className="bg-white p-3 rounded-xl border border-slate-200">
                        <div className="relative mb-2">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                          <input
                            type="text"
                            value={modalEliminar.busquedaReasignar}
                            onChange={e => setModalEliminar(prev => ({ ...prev, busquedaReasignar: e.target.value }))}
                            placeholder="Buscar por nombre o documento..."
                            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-pos-primary focus:ring-1 focus:ring-pos-primary"
                            autoFocus
                          />
                        </div>

                        <ul className="max-h-40 overflow-y-auto divide-y divide-slate-100">
                          {(() => {
                            const term = modalEliminar.busquedaReasignar.trim().toLowerCase();
                            const filtrados = modalEliminar.clientesParaReasignar.filter(c =>
                              c.nombre.toLowerCase().includes(term) ||
                              (c.documento ?? '').includes(term)
                            ).slice(0, 8);

                            if (modalEliminar.clientesParaReasignar.length === 0) {
                              return (
                                <li className="text-xs text-slate-400 text-center py-3">
                                  No hay otros clientes registrados en el sistema.
                                </li>
                              );
                            }

                            if (filtrados.length === 0) {
                              return (
                                <li className="text-xs text-slate-400 text-center py-3">
                                  No se encontraron clientes con "{modalEliminar.busquedaReasignar}".
                                </li>
                              );
                            }

                            return filtrados.map(c => (
                              <li
                                key={c.id}
                                onClick={() => setModalEliminar(prev => ({ ...prev, reasignarTargetId: c.id!, busquedaReasignar: '' }))}
                                className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 cursor-pointer transition"
                              >
                                <div>
                                  <p className="text-sm font-semibold text-slate-700">{c.nombre}</p>
                                  <p className="text-xs text-slate-400 font-mono">{c.documento || 'Sin documento'}</p>
                                </div>
                                <span className="text-xs text-pos-primary font-medium">Seleccionar</span>
                              </li>
                            ));
                          })()}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })()}

              <button
                disabled={modalEliminar.modoDestino === 'cliente' && !modalEliminar.reasignarTargetId}
                onClick={handleReasignarYEliminar}
                className="w-full py-2.5 bg-pos-primary text-white text-sm font-bold rounded-lg hover:bg-pos-primary-dark transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reasignar ventas y eliminar cliente
              </button>
            </div>

            {/* Opción 2: Eliminar todo */}
            <div className="border border-red-200 rounded-xl p-4 mb-4 bg-red-50/50">
              <h4 className="font-bold text-red-700 text-sm mb-1">
                Opción 2: Eliminar cliente y todas sus ventas
              </h4>
              <p className="text-xs text-red-600/80 mb-3">
                Se borrarán permanentemente el cliente y sus {modalEliminar.cantidadVentas} venta(s) asociadas. Esta acción no se puede deshacer.
              </p>
              <button
                onClick={handleEliminarConTodo}
                className="w-full py-2.5 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700 transition"
              >
                Eliminar cliente y todas sus ventas
              </button>
            </div>

            <button
              onClick={cerrarModalEliminar}
              className="w-full py-2.5 rounded-xl border border-slate-300 text-slate-600 font-medium hover:bg-slate-50 text-sm transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
