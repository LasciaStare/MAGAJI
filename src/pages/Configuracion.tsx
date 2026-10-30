import { useState, useEffect, useRef, Fragment } from 'react';
import {
  Printer, Eye, Check, Receipt, Palette, Upload, X, Plus, Trash2,
  ChevronUp, ChevronDown, Type, Minus, Image as ImageIcon,
  AlignLeft, AlignCenter, AlignRight, Bold, EyeOff, Maximize2, RotateCcw,
  HardDrive, FolderOpen, Clock, Archive, Loader2, Info, Lock, Sparkles,
} from 'lucide-react';
import { probarConexionIA } from '../services/facturaIA';
import SelectorModeloIA from '../components/SelectorModeloIA';
import {
  type ConfigRespaldo, type InfoRespaldo,
  obtenerConfigRespaldo, guardarConfigRespaldo,
  crearRespaldo, elegirCarpeta, listarRespaldos, eliminarRespaldo,
} from '../services/backup';
import {
  obtenerConfigNegocio,
  guardarConfigNegocio,
  descargarPDFFactura,
  elementosPorDefecto,
  CONFIG_DEFAULT,
  VARIABLES_TIRILLA,
  type ConfigNegocio,
  type ElementoTirilla,
  type AlineacionElemento,
  type TipoElemento,
  type DatosFactura,
  type FormatoFactura,
} from '../utils/factura';
import { cambiarPassword, hayPasswordPersonalizado } from '../utils/auth';
import { listarImpresoras, imprimirPruebaTermica } from '../utils/escpos';
import SelectorFormatoFactura from '../components/SelectorFormatoFactura';
import PreviewTirilla from '../components/PreviewTirilla';

const FACTURA_EJEMPLO: DatosFactura = {
  folio: 'POS-1',
  fecha: new Date().toLocaleString('es-CO'),
  cliente: 'CONSUMIDOR FINAL',
  clienteDoc: '222222222222',
  items: [
    { nombre: 'Producto de ejemplo A', precio: 100000, cantidad: 1, subtotal: 100000 },
    { nombre: 'Producto de ejemplo B', precio: 5000, cantidad: 2, subtotal: 10000 },
  ],
  subtotal: 110000,
  descuento: 0,
  total: 110000,
};



// Rasteriza cualquier imagen (SVG/PNG/JPG) a PNG sobre fondo blanco.
// jsPDF solo acepta raster; el SVG se ve en el navegador pero no en el PDF.
const LOGO_ANCHO_MAX = 512;
function rasterizarAPng(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w0 = img.naturalWidth || LOGO_ANCHO_MAX;
      const h0 = img.naturalHeight || LOGO_ANCHO_MAX;
      const escala = Math.min(1, LOGO_ANCHO_MAX / w0);
      const w = Math.max(1, Math.round(w0 * escala));
      const h = Math.max(1, Math.round(h0 * escala));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Sin contexto 2D')); return; }
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = dataUrl;
  });
}

const TIPO_INFO: Record<TipoElemento, { label: string; icono: typeof Type }> = {
  texto: { label: 'Texto', icono: Type },
  separador: { label: 'Separador', icono: Minus },
  items: { label: 'Tabla de productos', icono: Receipt },
  logo: { label: 'Logo', icono: ImageIcon },
  espacio: { label: 'Espacio en blanco', icono: ChevronDown },
};

type Tab = 'general' | 'diseno' | 'respaldo' | 'contrasena' | 'ia';

export default function Configuracion() {
  const [config, setConfig] = useState<ConfigNegocio>(() => obtenerConfigNegocio());
  const [guardado, setGuardado] = useState(false);
  const [mostrarSelector, setMostrarSelector] = useState(false);
  const [impresoras, setImpresoras] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('general');
  const [pantallaCompleta, setPantallaCompleta] = useState(false);
  const [focoId, setFocoId] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // ── Estado del tab de IA ──
  const [probandoIa, setProbandoIa] = useState(false);
  const [mensajeIa, setMensajeIa] = useState<{ ok: boolean; texto: string } | null>(null);
  const [mostrarApiKeyIa, setMostrarApiKeyIa] = useState(false);

  // ── Estado del tab de Respaldos ──
  const [configRespaldo, setConfigRespaldo] = useState<ConfigRespaldo>(obtenerConfigRespaldo);
  const [creandoRespaldo, setCreandoRespaldo] = useState(false);
  const [mensajeRespaldo, setMensajeRespaldo] = useState<{ ok: boolean; texto: string } | null>(null);
  const [respaldos, setRespaldos] = useState<InfoRespaldo[]>([]);

  // ── Estado del tab de Contraseña ──
  const [passAntigua, setPassAntigua] = useState('');
  const [passNueva, setPassNueva] = useState('');
  const [passConfirmar, setPassConfirmar] = useState('');
  const [mostrarPassAntigua, setMostrarPassAntigua] = useState(false);
  const [mostrarPassNueva, setMostrarPassNueva] = useState(false);
  const [mostrarPassConfirmar, setMostrarPassConfirmar] = useState(false);
  const [mensajePass, setMensajePass] = useState<{ ok: boolean; texto: string } | null>(null);
  const [cambiandoPass, setCambiandoPass] = useState(false);
  const esPassDefault = !hayPasswordPersonalizado();

  useEffect(() => {
    listarImpresoras().then(setImpresoras).catch(() => setImpresoras([]));
  }, []);

  // Si hay un logo SVG guardado de antes, convertirlo a PNG (el SVG no sale en PDF/térmica).
  useEffect(() => {
    const logo = config.tirillaLogoBase64;
    if (logo && logo.startsWith('data:image/svg')) {
      rasterizarAPng(logo)
        .then(png => set('tirillaLogoBase64', png))
        .catch(() => { /* se mantiene el original */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Carga lista de respaldos al entrar al tab o cambiar la carpeta
  useEffect(() => {
    if (tab !== 'respaldo' || !configRespaldo.carpeta) { setRespaldos([]); return; }
    listarRespaldos(configRespaldo.carpeta).then(setRespaldos);
  }, [tab, configRespaldo.carpeta]);

  // ── Helpers del tab Respaldos ──
  const formatTamano = (b: number) =>
    b < 1024 ? `${b} B` : b < 1_048_576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1_048_576).toFixed(1)} MB`;

  const proximoRespaldo = (): string => {
    if (!configRespaldo.carpeta || configRespaldo.intervaloHoras <= 0) return 'No configurado';
    if (!configRespaldo.ultimoRespaldo) return 'Al iniciar la app';
    const d = new Date(new Date(configRespaldo.ultimoRespaldo).getTime() + configRespaldo.intervaloHoras * 3_600_000);
    return d.toLocaleString('es-CO');
  };

  const handleElegirCarpeta = async () => {
    const carpeta = await elegirCarpeta();
    if (carpeta) setConfigRespaldo(prev => ({ ...prev, carpeta }));
  };

  const handleCrearRespaldo = async () => {
    setCreandoRespaldo(true);
    setMensajeRespaldo(null);
    try {
      const nombre = await crearRespaldo(configRespaldo);
      setMensajeRespaldo({ ok: true, texto: `Respaldo creado: ${nombre}` });
      setConfigRespaldo(obtenerConfigRespaldo()); // refrescar timestamp
      setRespaldos(await listarRespaldos(configRespaldo.carpeta));
    } catch (e) {
      setMensajeRespaldo({ ok: false, texto: e instanceof Error ? e.message : 'Error al crear el respaldo.' });
    } finally {
      setCreandoRespaldo(false);
    }
  };

  const handleGuardarRespaldo = () => {
    guardarConfigRespaldo(configRespaldo);
    setMensajeRespaldo({ ok: true, texto: 'Configuración guardada.' });
    setTimeout(() => setMensajeRespaldo(null), 2500);
  };

  const handleEliminarRespaldo = async (r: InfoRespaldo) => {
    if (!window.confirm(`¿Eliminar el respaldo ${r.nombre}?`)) return;
    try {
      await eliminarRespaldo(r.ruta);
      setRespaldos(prev => prev.filter(x => x.nombre !== r.nombre));
    } catch (e) {
      alert('Error al eliminar: ' + (e instanceof Error ? e.message : e));
    }
  };

  const set = <K extends keyof ConfigNegocio>(campo: K, valor: ConfigNegocio[K]) =>
    setConfig(prev => ({ ...prev, [campo]: valor }));

  // ── Operaciones sobre los elementos de la tirilla ──
  const setElementos = (fn: (arr: ElementoTirilla[]) => ElementoTirilla[]) =>
    setConfig(prev => ({ ...prev, tirillaElementos: fn(prev.tirillaElementos) }));

  const updateEl = (id: string, patch: Partial<ElementoTirilla>) =>
    setElementos(arr => arr.map(el => (el.id === id ? { ...el, ...patch } : el)));

  const removeEl = (id: string) => setElementos(arr => arr.filter(el => el.id !== id));

  const reorder = (from: number, to: number) =>
    setElementos(arr => {
      const next = [...arr];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });

  const moveEl = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= config.tirillaElementos.length) return;
    reorder(index, to);
  };

  const nuevoElemento = (tipo: TipoElemento): ElementoTirilla => {
    const id = crypto.randomUUID?.() ?? `el-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const base: ElementoTirilla = { id, tipo, visible: true };
    if (tipo === 'texto') Object.assign(base, { texto: 'Texto nuevo', align: 'center', size: 11 });
    if (tipo === 'items') Object.assign(base, { size: 11 });
    if (tipo === 'separador') Object.assign(base, { doble: false });
    if (tipo === 'espacio') Object.assign(base, { size: 8 });
    return base;
  };

  const addEl = (tipo: TipoElemento) => setElementos(arr => [...arr, nuevoElemento(tipo)]);

  const insertAt = (index: number, tipo: TipoElemento) =>
    setElementos(arr => {
      const next = [...arr];
      next.splice(index, 0, nuevoElemento(tipo));
      return next;
    });

  const insertarVariable = (token: string) => {
    if (!focoId) return;
    setElementos(arr => arr.map(el => (el.id === focoId ? { ...el, texto: (el.texto ?? '') + token } : el)));
  };

  const handleGuardar = () => {
    guardarConfigNegocio(config);
    setGuardado(true);
    setTimeout(() => setGuardado(false), 2500);
  };

  const handleRestablecer = () => {
    if (!window.confirm('¿Restablecer el diseño de la tirilla a los valores por defecto?\n\nSe perderán los cambios de orden, textos, separadores, tamaños y logo. La información del negocio NO se borra.')) return;
    setConfig(prev => ({
      ...prev,
      tirillaElementos: elementosPorDefecto(),
      tirillaFuente: CONFIG_DEFAULT.tirillaFuente,
      tirillaCarSep: CONFIG_DEFAULT.tirillaCarSep,
      ticketEscala: CONFIG_DEFAULT.ticketEscala,
      ticketNegrita: CONFIG_DEFAULT.ticketNegrita,
      tirillaLogoBase64: '',
      tirillaLogoAlto: CONFIG_DEFAULT.tirillaLogoAlto,
    }));
  };

  const handleVistaPrevia = () => {
    guardarConfigNegocio(config);
    setMostrarSelector(true);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const result = ev.target?.result;
      if (typeof result !== 'string') return;
      // Convertir a PNG para que funcione en PDF y bitmap térmico (no solo en pantalla).
      try {
        set('tirillaLogoBase64', await rasterizarAPng(result));
      } catch {
        set('tirillaLogoBase64', result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const tabCls = (t: Tab) =>
    `flex items-center gap-2 px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
      tab === t ? 'border-pos-primary text-pos-primary' : 'border-transparent text-slate-500 hover:text-slate-700'
    }`;

  const fieldCls = 'w-full border border-slate-300 rounded-lg p-3 bg-white text-sm outline-none focus:border-pos-primary focus:ring-1 focus:ring-pos-primary';

  // ── Barra para insertar un elemento en la posición `index` ──
  const barraInsertar = (index: number) => (
    <div className="group/ins relative flex items-center justify-center h-4">
      <div className="h-px w-full bg-slate-100 group-hover/ins:bg-emerald-200 transition" />
      <div className="absolute flex gap-1 opacity-0 group-hover/ins:opacity-100 transition bg-white border border-slate-200 rounded-full px-1 py-0.5 shadow-sm z-10">
        <button onClick={() => insertAt(index, 'texto')} className="text-[10px] px-2 py-0.5 rounded-full text-slate-500 hover:bg-emerald-100 hover:text-pos-primary-dark transition">+ Texto</button>
        <button onClick={() => insertAt(index, 'separador')} className="text-[10px] px-2 py-0.5 rounded-full text-slate-500 hover:bg-emerald-100 hover:text-pos-primary-dark transition">+ Separador</button>
        <button onClick={() => insertAt(index, 'espacio')} className="text-[10px] px-2 py-0.5 rounded-full text-slate-500 hover:bg-emerald-100 hover:text-pos-primary-dark transition">+ Espacio</button>
      </div>
    </div>
  );

  // ── Render de una fila del editor de elementos ──
  const renderFila = (el: ElementoTirilla, i: number) => {
    const Icono = TIPO_INFO[el.tipo].icono;
    const tieneColumnas = (el.texto ?? '').includes('{>}');
    const oculto = el.visible === false;

    const btnIcon = 'p-1.5 rounded-md transition disabled:opacity-25';
    const alignBtn = (val: AlineacionElemento, Ico: typeof AlignLeft) => (
      <button
        onClick={() => updateEl(el.id, { align: val })}
        className={`${btnIcon} ${el.align === val ? 'bg-emerald-100 text-pos-primary-dark' : 'text-slate-400 hover:bg-slate-100'}`}
        title={`Alinear ${val}`}
      >
        <Ico className="w-3.5 h-3.5" />
      </button>
    );

    return (
      <div
        key={el.id}
        className={`flex gap-2 items-start p-2.5 border-b border-slate-100 last:border-b-0 group ${oculto ? 'bg-slate-50/60' : 'bg-white'}`}
      >
        {/* Reordenar con flechas */}
        <div className="flex flex-col items-center pt-1 text-slate-300 gap-0.5">
          <button onClick={() => moveEl(i, -1)} disabled={i === 0} className="hover:text-slate-600 disabled:opacity-20"><ChevronUp className="w-4 h-4" /></button>
          <button onClick={() => moveEl(i, 1)} disabled={i === config.tirillaElementos.length - 1} className="hover:text-slate-600 disabled:opacity-20"><ChevronDown className="w-4 h-4" /></button>
        </div>

        {/* Contenido editable */}
        <div className={`flex-1 min-w-0 ${oculto ? 'opacity-50' : ''}`}>
          <div className="flex items-center gap-1.5 mb-1 text-slate-400">
            <Icono className="w-3.5 h-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wide">{TIPO_INFO[el.tipo].label}</span>
            {el.tipo === 'items' && <span className="text-[10px] text-slate-300">(filas dinámicas)</span>}
          </div>

          {el.tipo === 'texto' && (
            <textarea
              value={el.texto ?? ''}
              onChange={(e) => updateEl(el.id, { texto: e.target.value })}
              onFocus={() => setFocoId(el.id)}
              rows={1}
              spellCheck={false}
              className="w-full resize-y border border-slate-200 rounded-md px-2 py-1.5 text-sm font-mono outline-none focus:border-pos-primary focus:ring-1 focus:ring-pos-primary min-h-[34px]"
              placeholder="Escribe el texto…"
            />
          )}
          {el.tipo === 'items' && (
            <p className="text-xs text-slate-400">Filas de productos (se generan con cada venta). Ajusta tamaño y negrita abajo.</p>
          )}
          {el.tipo === 'separador' && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 border border-slate-200 rounded-md px-2 py-1 shrink-0">
                <span className="text-[10px] text-slate-400">Carácter</span>
                <input
                  type="text"
                  value={el.char ?? ''}
                  onChange={(e) => updateEl(el.id, { char: e.target.value.slice(0, 1) })}
                  maxLength={1}
                  placeholder={config.tirillaCarSep || '-'}
                  className="w-8 text-sm font-mono text-center outline-none"
                />
              </label>
              <div className="font-mono text-slate-400 text-sm tracking-tighter overflow-hidden whitespace-nowrap flex-1 h-5">
                {(el.char && el.char.length ? el.char : (config.tirillaCarSep || '-')).repeat(40)}
              </div>
            </div>
          )}
          {el.tipo === 'logo' && (
            <p className="text-xs text-slate-400">Usa la imagen y la altura configuradas en la sección «Logo».</p>
          )}
          {el.tipo === 'espacio' && (
            <p className="text-xs text-slate-400">Línea en blanco (alto ajustable).</p>
          )}

          {/* Controles por elemento */}
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            {el.tipo === 'texto' && !tieneColumnas && (
              <div className="flex items-center gap-0.5 border border-slate-200 rounded-md p-0.5">
                {alignBtn('left', AlignLeft)}
                {alignBtn('center', AlignCenter)}
                {alignBtn('right', AlignRight)}
              </div>
            )}
            {el.tipo === 'texto' && tieneColumnas && (
              <span className="text-[10px] px-2 py-1 bg-slate-100 rounded-md text-slate-500 font-medium">↔ Izq / Der</span>
            )}

            {(el.tipo === 'texto' || el.tipo === 'items' || el.tipo === 'espacio') && (
              <label className="flex items-center gap-1 border border-slate-200 rounded-md px-2 py-1">
                <span className="text-[10px] text-slate-400">{el.tipo === 'espacio' ? 'Alto' : 'px'}</span>
                <input
                  type="number"
                  min={6}
                  max={40}
                  value={el.size ?? 11}
                  onChange={(e) => updateEl(el.id, { size: Number(e.target.value) || 11 })}
                  className="w-10 text-xs outline-none text-center"
                />
              </label>
            )}

            {(el.tipo === 'texto' || el.tipo === 'items') && (
              <button
                onClick={() => updateEl(el.id, { bold: !el.bold })}
                className={`${btnIcon} border border-slate-200 ${el.bold ? 'bg-emerald-100 text-pos-primary-dark' : 'text-slate-400 hover:bg-slate-100'}`}
                title="Negrita"
              >
                <Bold className="w-3.5 h-3.5" />
              </button>
            )}

            {el.tipo === 'separador' && (
              <label className="flex items-center gap-1.5 border border-slate-200 rounded-md px-2 py-1 cursor-pointer select-none">
                <input type="checkbox" checked={!!el.doble} onChange={(e) => updateEl(el.id, { doble: e.target.checked })} className="w-3.5 h-3.5 accent-pos-primary" />
                <span className="text-[11px] text-slate-500">Doble línea</span>
              </label>
            )}

            <div className="ml-auto flex items-center gap-0.5">
              <button
                onClick={() => updateEl(el.id, { visible: oculto })}
                className={`${btnIcon} ${oculto ? 'text-slate-300 hover:bg-slate-100' : 'text-pos-primary hover:bg-emerald-50'}`}
                title={oculto ? 'Mostrar' : 'Ocultar'}
              >
                {oculto ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button onClick={() => removeEl(el.id)} className={`${btnIcon} text-slate-300 hover:text-red-500 hover:bg-red-50`} title="Eliminar">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-6xl mx-auto w-full pos-fade-in overflow-y-auto">
      <h2 className="text-2xl font-bold mb-5">Configuración del Sistema</h2>

      {/* Tab bar */}
      <div className="flex border-b border-slate-200 mb-5">
        <button className={tabCls('general')} onClick={() => setTab('general')}>
          <Printer className="w-4 h-4" /> Impresión y Negocio
        </button>
        <button className={tabCls('diseno')} onClick={() => setTab('diseno')}>
          <Palette className="w-4 h-4" /> Diseño de Tirilla
        </button>
        <button className={tabCls('respaldo')} onClick={() => setTab('respaldo')}>
          <HardDrive className="w-4 h-4" /> Respaldos
        </button>
        <button className={tabCls('contrasena')} onClick={() => setTab('contrasena')}>
          <Lock className="w-4 h-4" /> Contraseña
        </button>
        <button className={tabCls('ia')} onClick={() => setTab('ia')}>
          <Sparkles className="w-4 h-4" /> Inteligencia Artificial
        </button>
      </div>

      {/* ═══════════════ TAB GENERAL ═══════════════ */}
      {tab === 'general' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Tamaño de papel</label>
                <select value={config.papel} onChange={e => set('papel', e.target.value)} className={fieldCls}>
                  <option>Ticket (80mm)</option>
                  <option>Ticket (58mm)</option>
                  <option>Carta (8.5 x 11 in)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Impresora térmica de Recibos</label>
                <select value={config.impresora} onChange={e => set('impresora', e.target.value)} className={fieldCls}>
                  {config.impresora && !impresoras.includes(config.impresora) && (
                    <option value={config.impresora}>{config.impresora}</option>
                  )}
                  {impresoras.length > 0 ? (
                    impresoras.map(n => <option key={n} value={n}>{n}</option>)
                  ) : (
                    <>
                      <option>POS-80C</option>
                      <option>3nStar RPT005</option>
                      <option>Microsoft Print to PDF</option>
                    </>
                  )}
                </select>
                <p className="text-xs text-slate-400 mt-1">Elige el nombre exacto de la impresora de recibos.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Impresora de Etiquetas</label>
                <select value={config.impresoraEtiquetas || ''} onChange={e => set('impresoraEtiquetas', e.target.value)} className={fieldCls}>
                  <option value="">Seleccione una impresora...</option>
                  {config.impresoraEtiquetas && !impresoras.includes(config.impresoraEtiquetas) && (
                    <option value={config.impresoraEtiquetas}>{config.impresoraEtiquetas}</option>
                  )}
                  {impresoras.length > 0 ? (
                    impresoras.map(n => <option key={n} value={n}>{n}</option>)
                  ) : (
                    <>
                      <option>DigitalPOS 2406t pro</option>
                      <option>Gainscha GS-2406t</option>
                    </>
                  )}
                </select>
                <p className="text-xs text-slate-400 mt-1">Impresora TSPL para los códigos de barras.</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => { guardarConfigNegocio(config); imprimirPruebaTermica(); }}
                className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 font-medium px-4 py-2 rounded-lg hover:bg-slate-100 transition shadow-sm text-sm"
              >
                <Receipt className="w-4 h-4" /> Imprimir tirilla de prueba
              </button>
              <span className="text-xs text-slate-400">Envía una tirilla con acentos y ñ a la impresora seleccionada.</span>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <h4 className="text-sm font-bold mb-4 text-slate-700">Información del negocio</h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Nombre del negocio</label>
                  <input type="text" value={config.nombre} onChange={e => set('nombre', e.target.value)} className={fieldCls} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">RUC / NIT</label>
                    <input type="text" value={config.nit} onChange={e => set('nit', e.target.value)} className={fieldCls} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Teléfono</label>
                    <input type="text" value={config.telefono} onChange={e => set('telefono', e.target.value)} className={fieldCls} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Dirección</label>
                    <input type="text" value={config.direccion} onChange={e => set('direccion', e.target.value)} className={fieldCls} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Ciudad</label>
                    <input type="text" value={config.ciudad} onChange={e => set('ciudad', e.target.value)} className={fieldCls} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Resolución DIAN (opcional)</label>
                  <input type="text" value={config.resolucion} onChange={e => set('resolucion', e.target.value)} placeholder="Ej. Resolución DIAN 18764000001 de 2024" className={fieldCls} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Responsabilidad IVA</label>
                    <select value={config.regimen} onChange={e => set('regimen', e.target.value)} className={fieldCls}>
                      <option>Responsable de IVA</option>
                      <option>No responsable de IVA</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">IVA (%)</label>
                    <select value={config.ivaPorcentaje} onChange={e => set('ivaPorcentaje', Number(e.target.value))} className={fieldCls}>
                      <option value={19}>19%</option>
                      <option value={5}>5%</option>
                      <option value={0}>0% / Excluido</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Mensaje del pie de página</label>
                  <input type="text" value={config.piePagina} onChange={e => set('piePagina', e.target.value)} className={fieldCls} />
                </div>
              </div>
            </div>
          </div>

          <div className="p-5 border-t border-slate-200 bg-slate-50 flex gap-4 justify-end items-center">
            {guardado && (
              <span className="flex items-center gap-1.5 text-pos-primary-dark text-sm font-medium mr-auto">
                <Check className="w-4 h-4" /> Cambios guardados
              </span>
            )}
            <button onClick={handleVistaPrevia} className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 font-medium px-5 py-2.5 rounded-xl hover:bg-slate-100 transition shadow-sm">
              <Eye className="w-4 h-4" /> Vista previa PDF
            </button>
            <button onClick={handleGuardar} className="bg-pos-primary text-white font-bold px-7 py-2.5 rounded-xl hover:bg-pos-primary-dark transition shadow-md">
              Guardar Cambios
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ TAB DISEÑO ═══════════════ */}
      {tab === 'diseno' && (
        <>
          {/* Toolbar superior: Restablecer + Guardar */}
          <div className="flex items-center gap-3 mb-5 pb-4 border-b border-slate-200">
            <span className="text-sm font-semibold text-slate-600">Editor de tirilla</span>
            {guardado && (
              <span className="flex items-center gap-1.5 text-pos-primary-dark text-sm font-medium">
                <Check className="w-4 h-4" /> Guardado
              </span>
            )}
            <div className="ml-auto flex gap-2">
              <button onClick={handleRestablecer} className="flex items-center gap-2 bg-white border border-slate-300 text-slate-600 font-medium px-4 py-2 rounded-lg hover:bg-slate-100 transition text-sm">
                <RotateCcw className="w-4 h-4" /> Restablecer todo
              </button>
              <button onClick={handleVistaPrevia} className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 font-medium px-4 py-2 rounded-lg hover:bg-slate-100 transition text-sm">
                <Eye className="w-4 h-4" /> PDF
              </button>
              <button onClick={handleGuardar} className="bg-pos-primary text-white font-bold px-6 py-2 rounded-lg hover:bg-pos-primary-dark transition shadow-md text-sm">
                Guardar Cambios
              </button>
            </div>
          </div>

          <div className="flex gap-6 items-start">
            {/* ── Columna de edición ── */}
            <div className="flex-1 min-w-0 space-y-4">

              {/* Logo */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-700">Logo</h3>
                {config.tirillaLogoBase64 ? (
                  <div className="flex items-start gap-4">
                    <img src={config.tirillaLogoBase64} alt="logo" className="h-16 object-contain border border-slate-200 rounded-lg p-1 bg-white" />
                    <div className="flex-1 space-y-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Altura: <span className="font-semibold">{config.tirillaLogoAlto} mm</span></label>
                        <input type="range" min={6} max={40} step={1} value={config.tirillaLogoAlto} onChange={e => set('tirillaLogoAlto', Number(e.target.value))} className="w-full accent-pos-primary" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => logoInputRef.current?.click()} className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50 transition">
                          <Upload className="w-3.5 h-3.5" /> Cambiar
                        </button>
                        <button onClick={() => set('tirillaLogoBase64', '')} className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition">
                          <X className="w-3.5 h-3.5" /> Quitar
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => logoInputRef.current?.click()} className="flex items-center gap-2 w-full justify-center border-2 border-dashed border-slate-300 rounded-xl py-5 text-slate-500 hover:border-pos-primary hover:text-pos-primary transition text-sm">
                    <Upload className="w-4 h-4" /> Subir logo (PNG, JPG, SVG)
                  </button>
                )}
                <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp" className="hidden" onChange={handleLogoUpload} />
                <p className="text-xs text-slate-400">Coloca el elemento «Logo» donde quieras en la lista de abajo. Se imprime en la térmica en blanco y negro (monocromo).</p>
              </div>

              {/* Editor de elementos */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-700">Contenido de la tirilla</h3>
                  <span className="text-xs text-slate-400">Usa ▲▼ para reordenar</span>
                </div>

                <div>
                  {config.tirillaElementos.map((el, i) => (
                    <Fragment key={el.id}>
                      {barraInsertar(i)}
                      {renderFila(el, i)}
                    </Fragment>
                  ))}
                  {barraInsertar(config.tirillaElementos.length)}
                </div>

                {/* Agregar elementos */}
                <div className="p-3 border-t border-slate-200 bg-slate-50 flex gap-2 flex-wrap">
                  <span className="text-xs text-slate-400 self-center mr-1">Agregar:</span>
                  <button onClick={() => addEl('texto')} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white border border-slate-300 rounded-lg hover:border-pos-primary hover:text-pos-primary transition">
                    <Plus className="w-3.5 h-3.5" /> Texto
                  </button>
                  <button onClick={() => addEl('separador')} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white border border-slate-300 rounded-lg hover:border-pos-primary hover:text-pos-primary transition">
                    <Plus className="w-3.5 h-3.5" /> Separador
                  </button>
                  <button onClick={() => addEl('espacio')} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white border border-slate-300 rounded-lg hover:border-pos-primary hover:text-pos-primary transition">
                    <Plus className="w-3.5 h-3.5" /> Espacio
                  </button>
                  <button onClick={() => addEl('logo')} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white border border-slate-300 rounded-lg hover:border-pos-primary hover:text-pos-primary transition">
                    <Plus className="w-3.5 h-3.5" /> Logo
                  </button>
                </div>
              </div>

              {/* Leyenda de variables */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                <h3 className="text-sm font-bold text-slate-700 mb-1">Variables disponibles</h3>
                <p className="text-xs text-slate-400 mb-3">
                  Haz clic en un campo de texto y luego en una variable para insertarla. Usa <code className="bg-slate-100 px-1 rounded">{'{>}'}</code> para alinear a la derecha y <code className="bg-slate-100 px-1 rounded">{'{variable?}'}</code> para ocultar la línea si el dato está vacío.
                </p>
                <div className="flex gap-1.5 flex-wrap">
                  {VARIABLES_TIRILLA.map(v => (
                    <button
                      key={v.token}
                      onClick={() => insertarVariable(v.token)}
                      disabled={!focoId}
                      title={v.descripcion}
                      className="text-xs font-mono px-2 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-emerald-100 hover:text-pos-primary-dark transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {v.token}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Preview ── */}
            <div className="flex-shrink-0 sticky top-20">
              <PreviewTirilla
                config={config}
                accion={
                  <button
                    onClick={() => setPantallaCompleta(true)}
                    className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 transition"
                    title="Pantalla completa"
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-slate-600" />
                  </button>
                }
              />
            </div>
          </div>
        </>
      )}

      {/* ═══════════════ TAB RESPALDOS ═══════════════ */}
      {tab === 'respaldo' && (
        <div className="space-y-4">

          {/* Carpeta destino */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-sm font-bold text-slate-700 mb-4">Carpeta de respaldo</h3>
            <div className="flex gap-2">
              <input
                readOnly
                value={configRespaldo.carpeta || ''}
                placeholder="Ninguna seleccionada"
                className={`${fieldCls} flex-1 bg-slate-50 text-slate-500 cursor-default`}
              />
              <button
                onClick={handleElegirCarpeta}
                className="flex items-center gap-2 bg-white border border-slate-300 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition shrink-0"
              >
                <FolderOpen className="w-4 h-4" /> Elegir carpeta
              </button>
            </div>
            <div className="mt-3 flex items-start gap-2 p-3 bg-blue-50 rounded-lg border border-blue-100">
              <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-700">
                Para sincronizar con la nube, elige una carpeta dentro de <strong>Google Drive</strong> o <strong>OneDrive</strong>.
                Los respaldos se subirán solos cuando haya internet.
              </p>
            </div>
          </div>

          {/* Configuración automática */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-sm font-bold text-slate-700 mb-4">Configuración automática</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Respaldos a conservar</label>
                <select
                  value={configRespaldo.limite}
                  onChange={e => setConfigRespaldo(prev => ({ ...prev, limite: Number(e.target.value) }))}
                  className={fieldCls}
                >
                  {[5, 7, 10, 15, 20, 30].map(n => (
                    <option key={n} value={n}>{n} respaldos</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">Los más antiguos se eliminan automáticamente.</p>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Frecuencia automática</label>
                <select
                  value={configRespaldo.intervaloHoras}
                  onChange={e => setConfigRespaldo(prev => ({ ...prev, intervaloHoras: Number(e.target.value) }))}
                  className={fieldCls}
                >
                  <option value={0}>Deshabilitado</option>
                  <option value={12}>Cada 12 horas</option>
                  <option value={24}>Cada 24 horas</option>
                  <option value={48}>Cada 48 horas</option>
                  <option value={168}>Cada semana</option>
                </select>
              </div>
            </div>
          </div>

          {/* Estado */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-sm font-bold text-slate-700 mb-4">Estado</h3>
            <div className="grid grid-cols-2 gap-6 text-sm">
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">Último respaldo</p>
                  <p className="font-medium text-slate-700">
                    {configRespaldo.ultimoRespaldo
                      ? new Date(configRespaldo.ultimoRespaldo).toLocaleString('es-CO')
                      : 'Nunca'}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">Próximo respaldo automático</p>
                  <p className="font-medium text-slate-700">{proximoRespaldo()}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Acciones */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex items-center gap-3">
            {mensajeRespaldo && (
              <span className={`flex items-center gap-1.5 text-sm font-medium mr-auto ${mensajeRespaldo.ok ? 'text-pos-primary-dark' : 'text-red-600'}`}>
                {mensajeRespaldo.ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                {mensajeRespaldo.texto}
              </span>
            )}
            <button
              onClick={handleCrearRespaldo}
              disabled={creandoRespaldo || !configRespaldo.carpeta}
              className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 font-medium px-5 py-2.5 rounded-xl hover:bg-slate-100 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
            >
              {creandoRespaldo
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <HardDrive className="w-4 h-4" />}
              {creandoRespaldo ? 'Creando respaldo…' : 'Crear respaldo ahora'}
            </button>
            <button
              onClick={handleGuardarRespaldo}
              className="bg-pos-primary text-white font-bold px-7 py-2.5 rounded-xl hover:bg-pos-primary-dark transition shadow-md"
            >
              Guardar cambios
            </button>
          </div>

          {/* Lista de respaldos existentes */}
          {configRespaldo.carpeta && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-200">
                <h3 className="text-sm font-bold text-slate-700">
                  Respaldos existentes
                  {respaldos.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      ({respaldos.length} de {configRespaldo.limite})
                    </span>
                  )}
                </h3>
              </div>
              {respaldos.length === 0 ? (
                <div className="p-10 text-center text-slate-400">
                  <Archive className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No hay respaldos en esta carpeta todavía.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {respaldos.map(r => (
                    <div key={r.nombre} className="flex items-center px-5 py-3 gap-3 hover:bg-slate-50 transition">
                      <Archive className="w-4 h-4 text-slate-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-mono text-slate-700 truncate">{r.nombre}</p>
                        <p className="text-xs text-slate-400">
                          {r.fecha.toLocaleString('es-CO')} · {formatTamano(r.tamanoBytes)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleEliminarRespaldo(r)}
                        className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition"
                        title="Eliminar este respaldo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════ TAB CONTRASEÑA ═══════════════ */}
      {tab === 'contrasena' && (
        <div className="max-w-md">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-slate-100 rounded-xl">
                  <Lock className="w-5 h-5 text-slate-600" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">Cambiar Contraseña</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Se requiere la contraseña actual para confirmar el cambio.</p>
                </div>
              </div>
            </div>

            {esPassDefault && (
              <div className="mx-6 mt-5 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">
                  Estás usando la contraseña por defecto: <span className="font-bold font-mono">admin</span>. Te recomendamos cambiarla.
                </p>
              </div>
            )}

            <div className="p-6 space-y-4">
              {/* Contraseña antigua */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Contraseña actual</label>
                <div className="relative">
                  <input
                    type={mostrarPassAntigua ? 'text' : 'password'}
                    value={passAntigua}
                    onChange={e => setPassAntigua(e.target.value)}
                    placeholder="Contraseña actual"
                    autoComplete="current-password"
                    className={fieldCls}
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarPassAntigua(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                    tabIndex={-1}
                  >
                    {mostrarPassAntigua ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Nueva contraseña */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Nueva contraseña</label>
                <div className="relative">
                  <input
                    type={mostrarPassNueva ? 'text' : 'password'}
                    value={passNueva}
                    onChange={e => setPassNueva(e.target.value)}
                    placeholder="Mínimo 4 caracteres"
                    autoComplete="new-password"
                    className={fieldCls}
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarPassNueva(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                    tabIndex={-1}
                  >
                    {mostrarPassNueva ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirmar contraseña */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirmar nueva contraseña</label>
                <div className="relative">
                  <input
                    type={mostrarPassConfirmar ? 'text' : 'password'}
                    value={passConfirmar}
                    onChange={e => setPassConfirmar(e.target.value)}
                    placeholder="Repite la nueva contraseña"
                    autoComplete="new-password"
                    className={`${fieldCls} pr-12 ${
                      passConfirmar && passNueva !== passConfirmar
                        ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
                        : ''
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarPassConfirmar(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                    tabIndex={-1}
                  >
                    {mostrarPassConfirmar ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {passConfirmar && passNueva !== passConfirmar && (
                  <p className="text-xs text-red-500 mt-1">Las contraseñas no coinciden.</p>
                )}
              </div>

              {/* Mensaje feedback */}
              {mensajePass && (
                <div className={`flex items-center gap-2 text-sm px-3 py-2.5 rounded-xl border ${
                  mensajePass.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}>
                  {mensajePass.ok
                    ? <Check className="w-4 h-4 shrink-0" />
                    : <X className="w-4 h-4 shrink-0" />
                  }
                  {mensajePass.texto}
                </div>
              )}

              {/* Botón */}
              <button
                disabled={cambiandoPass || !passAntigua || !passNueva || passNueva !== passConfirmar || passNueva.length < 4}
                onClick={async () => {
                  setCambiandoPass(true);
                  setMensajePass(null);
                  try {
                    const ok = await cambiarPassword(passAntigua, passNueva);
                    if (ok) {
                      setMensajePass({ ok: true, texto: '¡Contraseña actualizada correctamente!' });
                      setPassAntigua('');
                      setPassNueva('');
                      setPassConfirmar('');
                      setMostrarPassAntigua(false);
                      setMostrarPassNueva(false);
                      setMostrarPassConfirmar(false);
                    } else {
                      setMensajePass({ ok: false, texto: 'La contraseña actual es incorrecta.' });
                    }
                  } catch {
                    setMensajePass({ ok: false, texto: 'Error al actualizar la contraseña.' });
                  } finally {
                    setCambiandoPass(false);
                  }
                }}
                className="w-full flex items-center justify-center gap-2 bg-pos-primary hover:bg-pos-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-xl transition text-sm"
              >
                {cambiandoPass
                  ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Actualizando...</>
                  : <><Lock className="w-4 h-4" /> Actualizar contraseña</>
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ TAB IA ═══════════════ */}
      {tab === 'ia' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 space-y-6">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-pos-primary" />
                  Inteligencia Artificial para Importación de Facturas
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Configura el proveedor de IA y tu clave de API para procesar el texto obtenido por RapidOCR Small y extraer productos automáticamente.
                </p>
              </div>
            </div>

            {/* Selector de Proveedor */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Proveedor de IA</label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  {
                    id: 'google',
                    nombre: 'Google AI Studio',
                    desc: 'Consulte los modelos Gemini disponibles con su clave.',
                    modeloDefault: '',
                    link: 'https://aistudio.google.com/apikey',
                  },
                  {
                    id: 'openrouter',
                    nombre: 'OpenRouter',
                    desc: 'Acceso unificado a múltiples modelos (Gemini, Claude, Llama, DeepSeek).',
                    modeloDefault: 'openrouter/free',
                    link: 'https://openrouter.ai/keys',
                  },
                  {
                    id: 'groq',
                    nombre: 'Groq Cloud',
                    desc: 'Consulte el catálogo actual de su cuenta Groq.',
                    modeloDefault: '',
                    link: 'https://console.groq.com/keys',
                  },
                ].map(prov => {
                  const seleccionado = (config.aiProveedor || 'google') === prov.id;
                  return (
                    <div
                      key={prov.id}
                      onClick={() => {
                        setConfig(prev => ({
                          ...prev,
                          aiProveedor: prov.id as 'google' | 'openrouter' | 'groq',
                          aiModelo: prev.aiModelo && prev.aiProveedor === prov.id ? prev.aiModelo : prov.modeloDefault,
                        }));
                        setMensajeIa(null);
                      }}
                      className={`p-4 rounded-xl border-2 cursor-pointer transition flex flex-col justify-between ${
                        seleccionado
                          ? 'border-pos-primary bg-emerald-50/50 shadow-sm'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-sm text-slate-800">{prov.nombre}</span>
                          <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${seleccionado ? 'border-pos-primary bg-pos-primary' : 'border-slate-300'}`}>
                            {seleccionado && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">{prov.desc}</p>
                      </div>
                      <a
                        href={prov.link}
                        target="_blank"
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-[11px] text-pos-primary font-medium hover:underline mt-3 inline-block"
                      >
                        Obtener API Key &rarr;
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Campo API Key */}
            <div className="space-y-4 pt-2">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Clave de API (API Key)
                </label>
                <div className="relative">
                  <input
                    type={mostrarApiKeyIa ? 'text' : 'password'}
                    value={config.aiApiKey || ''}
                    onChange={e => set('aiApiKey', e.target.value.trim())}
                    placeholder={`Pega tu API Key de ${(config.aiProveedor || 'Google AI').toUpperCase()}...`}
                    className="w-full border border-slate-300 rounded-lg pl-3 pr-10 py-2.5 text-sm font-mono bg-white outline-none focus:border-pos-primary focus:ring-1 focus:ring-pos-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarApiKeyIa(!mostrarApiKeyIa)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {mostrarApiKeyIa ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Tu clave se almacena de forma local y segura en este equipo.
                </p>
              </div>

              <SelectorModeloIA proveedor={config.aiProveedor || 'google'} apiKey={config.aiApiKey || ''}
                value={config.aiModelo || ''} onChange={modelo => set('aiModelo', modelo)} />

              {/* Botón Probar Conexión */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  disabled={probandoIa || !config.aiApiKey?.trim()}
                  onClick={async () => {
                    if (!config.aiApiKey?.trim()) return;
                    setProbandoIa(true);
                    setMensajeIa(null);
                    try {
                      const res = await probarConexionIA(
                        config.aiProveedor || 'google',
                        config.aiApiKey || '',
                        config.aiModelo || ''
                      );
                      setMensajeIa({ ok: true, texto: res });
                    } catch (e) {
                      setMensajeIa({ ok: false, texto: e instanceof Error ? e.message : 'Error al conectar con la IA.' });
                    } finally {
                      setProbandoIa(false);
                    }
                  }}
                  className="flex items-center gap-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold px-4 py-2 rounded-lg text-sm transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {probandoIa ? <Loader2 className="w-4 h-4 animate-spin text-pos-primary" /> : <Sparkles className="w-4 h-4 text-pos-primary" />}
                  {probandoIa ? 'Probando conexión...' : 'Probar conexión'}
                </button>
                <button
                  type="button"
                  onClick={handleGuardar}
                  className="flex items-center gap-2 bg-pos-primary hover:bg-pos-primary-dark text-white font-bold px-5 py-2 rounded-lg text-sm transition shadow-md"
                >
                  <Check className="w-4 h-4" /> Guardar configuración de IA
                </button>
              </div>

              {mensajeIa && (
                <div className={`p-4 rounded-xl text-sm ${mensajeIa.ok ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                  <p className="font-semibold mb-0.5">{mensajeIa.ok ? 'Conexión exitosa' : 'Fallo en la conexión'}</p>
                  <p className="text-xs opacity-90 whitespace-pre-wrap">{mensajeIa.texto}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de vista previa a pantalla completa */}
      {pantallaCompleta && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-6 pos-overlay-in" onClick={() => setPantallaCompleta(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-h-[92vh] overflow-auto relative pos-modal-panel" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setPantallaCompleta(false)} className="absolute top-3 right-3 p-2 rounded-lg hover:bg-slate-100 transition z-10" title="Cerrar">
              <X className="w-5 h-5 text-slate-500" />
            </button>
            <PreviewTirilla config={config} initialZoom={1} zoomMax={2.5} />
          </div>
        </div>
      )}

      {mostrarSelector && (
        <SelectorFormatoFactura
          titulo="Vista previa — elige el formato"
          onClose={() => setMostrarSelector(false)}
          onSelect={(formato: FormatoFactura) => {
            descargarPDFFactura(FACTURA_EJEMPLO, formato);
            setMostrarSelector(false);
          }}
        />
      )}
    </div>
  );
}
