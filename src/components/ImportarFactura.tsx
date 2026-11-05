import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Upload, X, Check, Eye, EyeOff, Trash2, Plus, Loader2,
  Info, Save, RefreshCw, ScanLine, CircleCheck, TriangleAlert, Settings2, FileText, ChevronDown,
} from 'lucide-react';
import { importarFilaFactura, obtenerProductos, obtenerProgresoFactura, type Producto } from '../database/db';
import { duplicadosEnLote, erroresFila, esFilaFactura, type FilaFactura } from '../utils/importacionFactura';
import { analizarFacturaOcrIA, ejecutarOcrFactura, probarConexionIA, type ResultadoOCR } from '../services/facturaIA';
import { guardarConfigNegocio, obtenerConfigNegocio, NUEVE_CATEGORIAS_DEFECTO, type ConfigNegocio } from '../utils/factura';
import SelectorModeloIA from './SelectorModeloIA';
import AsociarProductoFactura from './AsociarProductoFactura';

const CLAVE_BORRADOR = 'pos-factura-borrador-v1';
interface Borrador { filas: FilaFactura[]; guardados: number[] }
function cargarBorrador(): Borrador {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE_BORRADOR) ?? 'null') as Borrador | null;
    if (datos && Array.isArray(datos.filas) && datos.filas.length <= 500 && datos.filas.every(esFilaFactura) &&
      new Set(datos.filas.map(f => f.clave)).size === datos.filas.length &&
      Array.isArray(datos.guardados) && datos.guardados.every(id => Number.isSafeInteger(id) && id > 0)) return datos;
  } catch { /* Borrador ausente o inválido. */ }
  return { filas: [], guardados: [] };
}

type ProveedorIA = 'google' | 'openrouter' | 'groq';

const PROVEEDORES: { id: ProveedorIA; nombre: string; desc: string; link: string; modelo: string }[] = [
  { id: 'google', nombre: 'Google AI Studio', desc: 'Consulte los modelos Gemini disponibles con su clave.', link: 'https://aistudio.google.com/apikey', modelo: '' },
  { id: 'openrouter', nombre: 'OpenRouter', desc: 'Modelos de distintos proveedores, incluidos gratuitos.', link: 'https://openrouter.ai/keys', modelo: 'openrouter/free' },
  { id: 'groq', nombre: 'Groq Cloud', desc: 'Consulte el catálogo actual de su cuenta Groq.', link: 'https://console.groq.com/keys', modelo: '' },
];

export default function ImportarFactura({ onClose, onImportado }: { onClose: () => void; onImportado: () => Promise<void> }) {
  const [borrador, setBorrador] = useState<Borrador>(cargarBorrador);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [config, setConfig] = useState<ConfigNegocio>(() => obtenerConfigNegocio());
  const [imagen, setImagen] = useState<File | null>(null);
  const [urlImagen, setUrlImagen] = useState('');
  const [ocr, setOcr] = useState<ResultadoOCR | null>(null);
  const [optimizarFoto, setOptimizarFoto] = useState(true);
  const [analizando, setAnalizando] = useState(false);
  const [estadoAnalisis, setEstadoAnalisis] = useState('');
  const [segundos, setSegundos] = useState(0);
  const [ocupado, setOcupado] = useState(true);
  const [error, setError] = useState('');
  const [diagnostico, setDiagnostico] = useState('');
  const [errorBorrador, setErrorBorrador] = useState('');
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [mostrarOcr, setMostrarOcr] = useState(false);
  const [mostrarAjustesIA, setMostrarAjustesIA] = useState(false);
  const [mostrarClave, setMostrarClave] = useState(false);
  const [probandoConexion, setProbandoConexion] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const dialogo = useRef<HTMLDialogElement>(null);
  const confirmando = useRef(false);
  const navigate = useNavigate();

  const proveedor = (config.aiProveedor ?? 'google') as ProveedorIA;
  const proveedorInfo = PROVEEDORES.find(p => p.id === proveedor)!;
  const iaLista = !!config.aiApiKey?.trim();

  const categorias = useMemo(() => Array.from(new Set([
    ...NUEVE_CATEGORIAS_DEFECTO,
    ...productos.map(p => p.categoria).filter(Boolean),
  ])).sort(), [productos]);

  const seleccionadas = borrador.filas.filter(f => seleccion.has(f.clave));
  const totalUnidades = seleccionadas.reduce((suma, fila) => suma + (fila.cantidad ?? 0), 0);
  const nuevas = seleccionadas.filter(f => f.producto_id === null).length;
  // Solo chocan entre sí las filas nuevas marcadas: las asociadas se suman al stock existente.
  const duplicados = duplicadosEnLote(seleccionadas);
  const numeroFila = (clave: string) => borrador.filas.findIndex(f => f.clave === clave) + 1;
  const erroresDeFila = (fila: FilaFactura) => {
    const errores = erroresFila(fila, productos);
    const duplicado = duplicados.get(fila.clave);
    if (!duplicado) return errores;
    const otra = numeroFila(duplicado.claveOtra);
    return [...errores, otra > 0 ? `${duplicado.mensaje} (también en la fila ${otra})` : duplicado.mensaje];
  };
  const pendientes = seleccionadas.filter(f => erroresDeFila(f).length > 0).length;
  const listas = seleccionadas.length - pendientes;
  const todasSeleccionadas = borrador.filas.length > 0 && seleccionadas.length === borrador.filas.length;
  const campo = 'border border-slate-300 rounded-lg px-3 py-2 w-full text-sm bg-white outline-none focus:border-pos-primary focus:ring-1 focus:ring-pos-primary';

  const alternarSeleccion = (clave: string) => setSeleccion(prev => {
    const siguiente = new Set(prev);
    if (siguiente.has(clave)) siguiente.delete(clave); else siguiente.add(clave);
    return siguiente;
  });

  useEffect(() => { const d = dialogo.current; d?.showModal(); return () => d?.close(); }, []);
  useEffect(() => {
    if (!analizando) return;
    setSegundos(0);
    const inicio = Date.now();
    const timer = window.setInterval(() => setSegundos(Math.floor((Date.now() - inicio) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [analizando]);

  useEffect(() => {
    Promise.all([obtenerProductos(), obtenerProgresoFactura(borrador.filas.map(f => f.clave))]).then(([catalogo, progreso]) => {
      setProductos(catalogo);
      const completadas = progreso.filter(p => p.estado === 'completado');
      setBorrador(prev => {
        const filas = prev.filas.filter(f => !completadas.some(p => p.clave === f.clave));
        setSeleccion(new Set(filas.map(f => f.clave)));
        return { filas, guardados: [...new Set([...prev.guardados, ...completadas.map(p => p.producto_id!).filter(Boolean)])] };
      });
      if (progreso.some(p => p.estado === 'procesando')) setError('Hay filas con escrituras interrumpidas. Revise el stock e historial antes de retirarlas del borrador; no se volverán a aplicar automáticamente.');
    }).catch(() => setError('No se pudo cargar el inventario. Cierre y vuelva a intentar.')).finally(() => setOcupado(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try { localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(borrador)); setErrorBorrador(''); }
    catch { setErrorBorrador('No se pudo conservar el borrador. Libere espacio local antes de confirmar.'); }
  }, [borrador]);
  useEffect(() => {
    if (!imagen) { setUrlImagen(''); return; }
    const url = URL.createObjectURL(imagen);
    setUrlImagen(url);
    return () => URL.revokeObjectURL(url);
  }, [imagen]);
  const actualizarIA = (cambio: Partial<ConfigNegocio>) => setConfig(prev => ({ ...prev, ...cambio }));

  const elegirProveedor = (id: ProveedorIA) => {
    const info = PROVEEDORES.find(p => p.id === id)!;
    setConfig(prev => {
      const mismo = prev.aiProveedor === id && !!prev.aiModelo;
      const next: ConfigNegocio = { ...prev, aiProveedor: id, aiModelo: mismo ? prev.aiModelo : info.modelo };
      guardarConfigNegocio(next);
      return next;
    });
    setDiagnostico('');
    setError('');
  };

  const guardarIA = () => {
    guardarConfigNegocio(config);
    setError('');
    setDiagnostico('Configuración de IA guardada en este equipo.');
  };

  const probarConexion = async () => {
    if (!iaLista) return;
    setProbandoConexion(true); setOcupado(true); setError(''); setDiagnostico('');
    try { setDiagnostico(await probarConexionIA(proveedor, config.aiApiKey ?? '', config.aiModelo ?? '')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falló la prueba de conexión.'); }
    finally { setProbandoConexion(false); setOcupado(false); }
  };

  const aceptarArchivo = (archivo: File | null | undefined) => {
    if (!archivo) return;
    if (!archivo.type.startsWith('image/')) { setError('Seleccione una imagen (JPG, PNG o WEBP).'); return; }
    setImagen(archivo); setOcr(null); setError(''); setEstadoAnalisis('');
  };

  const leerFactura = async () => {
    if (!imagen) return;
    if (!iaLista) { setError('Configura tu API Key de IA en «Ajustes de IA» o en la pestaña Inteligencia Artificial de Configuración.'); return; }
    if (!config.aiModelo?.trim()) { setMostrarAjustesIA(true); setError('Pulse «Actualizar modelos» y seleccione un modelo antes de leer la factura.'); return; }
    if (borrador.filas.length && !window.confirm('¿Reemplazar las filas pendientes por una nueva lectura?')) return;
    setOcupado(true); setAnalizando(true); setError(''); setDiagnostico(''); setOcr(null);
    try {
      const lectura = await ejecutarOcrFactura(imagen, optimizarFoto, setEstadoAnalisis);
      setOcr(lectura);
      if (!lectura.texto_completo.trim()) {
        setEstadoAnalisis('El OCR no detectó texto legible.');
        setError('RapidOCR no detectó texto en la imagen. Pruebe con mejor luz, de frente y sin sombras.');
        return;
      }
      const filas = await analizarFacturaOcrIA(lectura.texto_completo, proveedor, config.aiApiKey ?? '', config.aiModelo ?? '', productos, setEstadoAnalisis);
      setBorrador(prev => ({ ...prev, filas }));
      setSeleccion(new Set(filas.map(f => f.clave)));
      setEstadoAnalisis(`Listo: ${filas.length} ${filas.length === 1 ? 'fila' : 'filas'} detectadas. Revise y corrija antes de importar.`);
      if (!filas.length) setError('La IA no encontró productos en el texto. Revise el texto OCR o agregue filas manualmente.');
    } catch (e) {
      setEstadoAnalisis('La lectura no se completó.');
      setError(e instanceof Error ? e.message : 'No se pudo leer la imagen.');
    } finally { setOcupado(false); setAnalizando(false); }
  };

  const editar = (clave: string, cambio: Partial<FilaFactura>) => setBorrador(prev => ({
    ...prev, filas: prev.filas.map(f => f.clave === clave ? {
      ...f, revisado: false, ...cambio,
      ...(('nombre' in cambio || 'codigo_barras' in cambio) ? { coincidencias_descartadas: undefined } : {}),
    } : f),
  }));

  const agregarFila = () => {
    const nueva: FilaFactura = { clave: crypto.randomUUID(), nombre: '', nombre_etiqueta: '', codigo_barras: '', categoria: NUEVE_CATEGORIAS_DEFECTO[0], cantidad: 1, precio_compra: null, precio_venta: null, producto_id: null, revisado: false, origen: 'Fila manual' };
    setBorrador(prev => ({ ...prev, filas: [...prev.filas, nueva] }));
    setSeleccion(prev => new Set(prev).add(nueva.clave));
  };

  const nuevaFactura = () => {
    if (borrador.filas.length && !window.confirm('¿Descartar las filas pendientes e iniciar otra factura?')) return;
    setBorrador({ filas: [], guardados: [] });
    setSeleccion(new Set());
    setImagen(null); setOcr(null); setError(''); setEstadoAnalisis('');
  };

  const quitarFila = (clave: string) => {
    setBorrador(prev => ({ ...prev, filas: prev.filas.filter(f => f.clave !== clave) }));
    setSeleccion(prev => { const s = new Set(prev); s.delete(clave); return s; });
  };

  const eliminarSeleccionadas = () => {
    if (!seleccionadas.length) return;
    const claves = new Set(seleccion);
    setBorrador(prev => ({ ...prev, filas: prev.filas.filter(f => !claves.has(f.clave)) }));
    setSeleccion(new Set());
  };

  const confirmar = async () => {
    if (confirmando.current) return;
    const filasAImportar = borrador.filas.filter(f => seleccion.has(f.clave));
    if (!filasAImportar.length) { setError('Seleccione al menos una fila para importar.'); return; }
    confirmando.current = true; setOcupado(true); setError('');
    try {
      const actuales = await obtenerProductos().catch(() => null);
      if (!actuales) { setError('No se pudo consultar el stock actual.'); return; }
      setProductos(actuales);
      for (const fila of filasAImportar) {
        const errores = erroresFila(fila, actuales);
        if (errores.length) { setError(`Fila ${numeroFila(fila.clave)}${fila.nombre ? ` (${fila.nombre})` : ''}: ${errores.join(', ')}.`); return; }
      }
      const repetidos = duplicadosEnLote(filasAImportar);
      if (repetidos.size) {
        const paresVistos = new Set<string>();
        const lineas: string[] = [];
        for (const fila of filasAImportar) {
          const duplicado = repetidos.get(fila.clave);
          if (!duplicado) continue;
          const par = [fila.clave, duplicado.claveOtra].sort().join('|');
          if (paresVistos.has(par)) continue;
          paresVistos.add(par);
          lineas.push(`• Filas ${numeroFila(fila.clave)} y ${numeroFila(duplicado.claveOtra)}: ${duplicado.mensaje}`);
        }
        setError(`Hay productos nuevos repetidos:\n${lineas.join('\n')}\nCombine sus cantidades o corrija sus nombres/códigos.`); return;
      }
      if (filasAImportar.some(f => f.producto_id === null && f.precio_venta! < f.precio_compra!) &&
        !window.confirm('Hay productos con precio de venta menor al costo. ¿Importarlos de todas formas?')) return;
      // Antes de escribir, conservar las claves usadas para impedir reintentos duplicados.
      try { localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(borrador)); }
      catch { setErrorBorrador('No se pudo conservar el borrador; no se inició la importación.'); return; }
      let estado = borrador;
      try {
        for (const fila of filasAImportar) {
          const id = await importarFilaFactura(fila);
          estado = { filas: estado.filas.filter(f => f.clave !== fila.clave), guardados: [...new Set([...estado.guardados, id])] };
          setBorrador(estado);
          localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(estado));
        }
      } catch (e) { setError(e instanceof Error ? e.message : 'Importación interrumpida. Revise el inventario antes de continuar.'); }
      finally {
        setSeleccion(prev => new Set([...prev].filter(c => estado.filas.some(f => f.clave === c))));
        try { setProductos(await obtenerProductos()); await onImportado(); }
        catch { setError(prev => `${prev} No se pudo refrescar el inventario; vuelva a abrirlo.`); }
      }
    } finally { confirmando.current = false; setOcupado(false); }
  };

  const paso = (n: number, titulo: string, descripcion: string) => (
    <div className="flex items-start gap-3">
      <span className="shrink-0 w-7 h-7 rounded-full bg-pos-primary/10 text-pos-primary-dark text-sm font-bold flex items-center justify-center">{n}</span>
      <div>
        <h3 className="text-sm font-bold text-slate-800 leading-7">{titulo}</h3>
        <p className="text-xs text-slate-500 -mt-0.5">{descripcion}</p>
      </div>
    </div>
  );

  return <dialog ref={dialogo} onCancel={e => { e.preventDefault(); if (!ocupado) onClose(); }} aria-labelledby="titulo-importacion" className="bg-white rounded-2xl w-[calc(100%-2rem)] max-w-[110rem] max-h-[95vh] flex flex-col shadow-2xl p-0 m-auto backdrop:bg-slate-900/50">
      <header className="p-5 border-b border-slate-200 flex justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-50 text-pos-primary"><Sparkles className="w-5 h-5" /></div>
          <div>
            <h2 id="titulo-importacion" className="font-bold text-xl text-slate-800">Importar factura con IA</h2>
            <p className="text-xs text-slate-500">RapidOCR Small + <span className="font-semibold text-slate-600">{proveedorInfo.nombre}</span> · {config.aiModelo}</p>
          </div>
        </div>
        <button disabled={ocupado} onClick={onClose} className="flex items-center gap-1.5 p-2 px-3 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"><X className="w-4 h-4" /> Cerrar</button>
      </header>

      <div className="p-5 overflow-auto space-y-6">
        <fieldset disabled={ocupado} className="space-y-6">

          {/* ── PASO 1: Motor de IA ── */}
          <section className="rounded-xl border border-slate-200 overflow-hidden">
            <button type="button" onClick={() => setMostrarAjustesIA(v => !v)} className="w-full flex items-center justify-between gap-3 p-4 bg-slate-50 hover:bg-slate-100 transition text-left">
              <div className="flex items-center gap-3">
                <Settings2 className="w-4 h-4 text-pos-primary" />
                <div>
                  <p className="text-sm font-bold text-slate-700">Motor de Inteligencia Artificial</p>
                  <p className="text-xs text-slate-500">{proveedorInfo.nombre} · {config.aiModelo} · {iaLista ? <span className="text-emerald-600 font-medium">API Key configurada</span> : <span className="text-amber-600 font-medium">Falta la API Key</span>}</p>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${mostrarAjustesIA ? 'rotate-180' : ''}`} />
            </button>
            {mostrarAjustesIA && (
              <div className="p-4 space-y-4 border-t border-slate-200 pos-fade-up">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {PROVEEDORES.map(prov => {
                    const seleccionado = proveedor === prov.id;
                    return (
                      <button type="button" key={prov.id} onClick={() => elegirProveedor(prov.id)}
                        className={`p-3 rounded-xl border-2 text-left transition ${seleccionado ? 'border-pos-primary bg-emerald-50/60' : 'border-slate-200 hover:border-slate-300 bg-white'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-sm text-slate-800">{prov.nombre}</span>
                          <span className={`w-3.5 h-3.5 rounded-full border-2 ${seleccionado ? 'bg-pos-primary border-pos-primary' : 'border-slate-300'}`} />
                        </div>
                        <p className="text-[11px] text-slate-500 leading-snug">{prov.desc}</p>
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Clave de API</label>
                    <div className="relative">
                      <input type={mostrarClave ? 'text' : 'password'} autoComplete="off" className={`${campo} pr-10 font-mono`} value={config.aiApiKey ?? ''} onChange={e => actualizarIA({ aiApiKey: e.target.value.trim() })} placeholder="Pegue aquí su API Key" />
                      <button type="button" onClick={() => setMostrarClave(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{mostrarClave ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                    </div>
                    <a className="text-[11px] text-pos-primary hover:underline mt-1 inline-block" href={proveedorInfo.link} target="_blank" rel="noreferrer">Obtener API Key en {proveedorInfo.nombre} &rarr;</a>
                  </div>
                  <SelectorModeloIA proveedor={proveedor} apiKey={config.aiApiKey ?? ''}
                    value={config.aiModelo ?? ''} onChange={aiModelo => actualizarIA({ aiModelo })} />
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <button type="button" disabled={!iaLista || probandoConexion} onClick={probarConexion} className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    {probandoConexion ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Probar conexión
                  </button>
                  <button type="button" onClick={guardarIA} className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Save className="w-4 h-4" /> Guardar ajustes</button>
                  <p className="text-[11px] text-slate-400">La clave se guarda localmente en este equipo y también puede editarse en Configuración → Inteligencia Artificial.</p>
                </div>
              </div>
            )}
          </section>

          {/* ── PASO 2: Foto de la factura ── */}
          <section className="rounded-xl border border-slate-200 p-4 space-y-4">
            {paso(1, 'Foto de la factura', 'Suba una imagen de la factura. Debe verse de frente y con buena luz.')}
            <label
              onDragOver={e => { e.preventDefault(); setArrastrando(true); }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={e => { e.preventDefault(); setArrastrando(false); aceptarArchivo(e.dataTransfer.files?.[0]); }}
              className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl py-8 px-4 text-center cursor-pointer transition ${arrastrando ? 'border-pos-primary bg-emerald-50/60' : 'border-slate-300 hover:border-pos-primary hover:bg-slate-50'}`}>
              <Upload className="w-6 h-6 text-slate-400" />
              <span className="text-sm font-medium text-slate-600">Arrastre la imagen aquí o haga clic para elegirla</span>
              <span className="text-xs text-slate-400">JPG, PNG o WEBP</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { aceptarArchivo(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {imagen && urlImagen && <div className="flex flex-wrap items-start gap-4">
              <img src={urlImagen} alt="Factura a importar" className="max-h-52 rounded-lg border border-slate-200 object-contain bg-slate-50" />
              <div className="flex flex-col gap-3">
                <label className="flex items-start gap-2 text-xs text-slate-600 max-w-xs"><input type="checkbox" className="mt-0.5" checked={optimizarFoto} onChange={e => setOptimizarFoto(e.target.checked)} /> Optimizar fotos grandes antes del OCR (máximo 2560 px). Desactive si el texto queda demasiado pequeño.</label>
                <button type="button" onClick={() => { setImagen(null); setOcr(null); setEstadoAnalisis(''); }} className="self-start flex items-center gap-2 border border-red-200 text-red-600 rounded-lg px-4 py-2 text-sm hover:bg-red-50"><Trash2 className="w-4 h-4" /> Quitar imagen</button>
              </div>
            </div>}
          </section>

          {/* ── PASO 3: OCR + IA ── */}
          <section className="rounded-xl border border-slate-200 p-4 space-y-4">
            {paso(2, 'Leer con OCR y analizar con IA', 'RapidOCR Small extrae el texto localmente y la IA lo convierte en productos de inventario.')}
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" disabled={!imagen || !iaLista || analizando} onClick={leerFactura} className="flex items-center gap-2 bg-pos-primary hover:bg-pos-primary-dark text-white font-bold rounded-lg px-5 py-2.5 text-sm shadow-md disabled:opacity-50">
                {analizando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
                {analizando ? 'Procesando…' : 'Leer factura con IA'}
              </button>
              {analizando && <span className="text-sm text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {estadoAnalisis} ({segundos} s)</span>}
              {!analizando && estadoAnalisis && <span className="text-sm text-slate-600">{estadoAnalisis}</span>}
            </div>
            {!iaLista && <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3"><TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" /> Aún no hay una API Key de IA configurada. Ábrela en «Motor de Inteligencia Artificial» arriba o en Configuración → Inteligencia Artificial.</div>}
            {ocr && (
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <button type="button" onClick={() => setMostrarOcr(v => !v)} className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-left text-xs font-semibold text-slate-600">
                  <span className="flex items-center gap-2"><FileText className="w-3.5 h-3.5" /> Texto leído por OCR ({ocr.texto_filas.length} líneas)</span>
                  <span className="text-slate-400">{mostrarOcr ? 'Ocultar' : 'Ver'}</span>
                </button>
                {mostrarOcr && <pre className="max-h-48 overflow-auto p-3 text-[11px] leading-relaxed text-slate-600 whitespace-pre-wrap font-mono">{ocr.texto_completo || '(sin texto)'}</pre>}
              </div>
            )}
          </section>

          {/* ── PASO 4: Revisión y edición ── */}
          <section className="rounded-xl border border-slate-200 p-4 space-y-4">
            {paso(3, 'Revisar, corregir e importar', 'Solo se importarán las filas que marque. El stock mínimo se fija en 1 por defecto.')}
            <div className="flex flex-wrap gap-2 items-center">
              <button type="button" onClick={agregarFila} className="flex items-center gap-1.5 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Plus className="w-4 h-4" /> Agregar fila</button>
              <button type="button" onClick={nuevaFactura} className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Nueva factura</button>
            </div>

            {borrador.filas.length > 0 && <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium bg-pos-primary/10 text-pos-primary-dark">{seleccionadas.length} de {borrador.filas.length} seleccionadas</span>
                  <span className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-600 rounded-full px-3 py-1 font-medium">{totalUnidades} unidades</span>
                  <span className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-600 rounded-full px-3 py-1 font-medium">{nuevas} productos nuevos</span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium ${listas === seleccionadas.length ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{listas}/{seleccionadas.length} listas</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setSeleccion(todasSeleccionadas ? new Set() : new Set(borrador.filas.map(f => f.clave)))} className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">{todasSeleccionadas ? 'Quitar selección' : 'Seleccionar todas'}</button>
                  <button type="button" disabled={!seleccionadas.length} onClick={eliminarSeleccionadas} className="flex items-center gap-1.5 border border-red-200 text-red-600 rounded-lg px-3 py-1.5 text-xs hover:bg-red-50 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /> Eliminar seleccionadas</button>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={seleccionadas.length > 0 && seleccionadas.every(f => f.revisado)} onChange={e => setBorrador(prev => ({ ...prev, filas: prev.filas.map(f => seleccion.has(f.clave) ? { ...f, revisado: e.target.checked } : f) }))} /> Confirmo que revisé las filas seleccionadas</label>
              <p className="text-xs text-slate-500">Al asociar un producto existente se suma la cantidad al stock y se conservan su ficha y sus precios.</p>

              <div className="space-y-3">
                {borrador.filas.map((fila, indice) => {
                  const errores = erroresDeFila(fila);
                  const asociado = fila.producto_id !== null;
                  const marcada = seleccion.has(fila.clave);
                  const etiquetaCampo = 'block text-[11px] font-semibold text-slate-500 mb-1';
                  return (
                    <article key={fila.clave} className={`rounded-xl border-2 p-4 transition ${marcada ? 'border-pos-primary/50 bg-emerald-50/30' : 'border-slate-200 bg-white'} ${errores.length && marcada ? 'ring-1 ring-amber-300' : ''}`} title={fila.origen}>
                      <div className="flex items-start gap-3">
                        <label className="flex items-center pt-7 cursor-pointer" title="Incluir esta fila al importar">
                          <input type="checkbox" className="w-5 h-5 accent-pos-primary" aria-label={`Seleccionar ${fila.nombre || 'fila'}`} checked={marcada} onChange={() => alternarSeleccion(fila.clave)} />
                        </label>

                        <div className="flex-1 min-w-0 space-y-3">
                          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1.4fr] gap-3">
                            <div>
                              <label className={etiquetaCampo}>Producto <span className="font-normal text-slate-400">· Fila {indice + 1}</span></label>
                              <input aria-label="Nombre del producto" disabled={asociado} maxLength={300} className={campo} value={fila.nombre} onChange={e => editar(fila.clave, { nombre: e.target.value.toUpperCase() })} />
                            </div>
                            <AsociarProductoFactura fila={fila} productos={productos}
                              onChange={cambio => editar(fila.clave, cambio)} />
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                            <div>
                              <label className={etiquetaCampo}>Etiqueta (máx 16)</label>
                              <input aria-label="Nombre en etiqueta" disabled={asociado} maxLength={16} className={campo} value={fila.nombre_etiqueta} onChange={e => editar(fila.clave, { nombre_etiqueta: e.target.value.toUpperCase().slice(0, 16) })} />
                              <p className="text-[10px] text-slate-400 mt-1">{fila.nombre_etiqueta.length}/16</p>
                            </div>
                            <div>
                              <label className={etiquetaCampo}>Cantidad</label>
                              <input aria-label="Cantidad" className={campo} type="number" min={1} step={1} value={fila.cantidad ?? ''} onChange={e => editar(fila.clave, { cantidad: e.target.value === '' ? null : Number(e.target.value) })} />
                            </div>
                            <div>
                              <label className={etiquetaCampo}>Precio de compra</label>
                              <input aria-label="Precio de compra" disabled={asociado} className={campo} type="number" min={0} step="0.01" value={fila.precio_compra ?? ''} onChange={e => editar(fila.clave, { precio_compra: e.target.value === '' ? null : Number(e.target.value) })} />
                            </div>
                            <div>
                              <label className={etiquetaCampo}>Precio de venta</label>
                              <input aria-label="Precio de venta" disabled={asociado} className={campo} type="number" min={0} step="0.01" value={fila.precio_venta ?? ''} onChange={e => editar(fila.clave, { precio_venta: e.target.value === '' ? null : Number(e.target.value) })} />
                            </div>
                            <div>
                              <label className={etiquetaCampo}>Categoría</label>
                              <select aria-label="Categoría" disabled={asociado} className={campo} value={fila.categoria} onChange={e => editar(fila.clave, { categoria: e.target.value })}><option value="">Revisar</option>{categorias.map(c => <option key={c}>{c}</option>)}</select>
                            </div>
                            <div>
                              <label className={etiquetaCampo}>Código de barras</label>
                              <input aria-label="Código de barras" disabled={asociado} className={campo} value={fila.codigo_barras} placeholder="Automático al crear" onChange={e => editar(fila.clave, { codigo_barras: e.target.value.trim() })} />
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                            <div className="min-w-0 space-y-1">
                              {fila.origen && <p className="text-[11px] text-amber-700 flex items-start gap-1"><Info className="w-3 h-3 shrink-0 mt-0.5" />{fila.origen}</p>}
                              <span className={`text-xs flex items-start gap-1 ${errores.length ? 'text-amber-700' : 'text-emerald-600'}`}>{errores.length ? <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <CircleCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />}{errores.length ? errores.join(' · ') : asociado ? 'Sumar stock al existente' : 'Listo para crear'}</span>
                            </div>
                            <label className="flex items-center gap-1.5 text-xs text-slate-600 shrink-0"><input type="checkbox" checked={fila.revisado} onChange={e => editar(fila.clave, { revisado: e.target.checked })} />Revisado</label>
                          </div>
                        </div>

                        <button aria-label={`Eliminar ${fila.nombre || 'fila'}`} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg" onClick={() => quitarFila(fila.clave)}><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>}
          </section>
        </fieldset>

        {ocupado && <p role="status" className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Procesando… espere hasta que termine.</p>}
        {(error || errorBorrador) && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 p-3 rounded-lg whitespace-pre-line flex items-start gap-2"><TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />{error || errorBorrador}</p>}
        {diagnostico && <p role="status" className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 p-3 rounded-lg flex items-start gap-2"><CircleCheck className="w-4 h-4 shrink-0 mt-0.5" />{diagnostico}</p>}
        {borrador.guardados.length > 0 && <p className="text-sm text-emerald-700 flex items-center gap-2"><Check className="w-4 h-4" /> {borrador.guardados.length} productos guardados. Las filas completadas ya fueron retiradas del borrador.</p>}
      </div>

      <footer className="p-4 border-t border-slate-200 flex flex-wrap gap-3 justify-end items-center bg-slate-50 rounded-b-2xl">
        {!ocupado && !errorBorrador && pendientes > 0 && <p className="text-xs text-amber-700 mr-auto">Faltan {pendientes} {pendientes === 1 ? 'fila' : 'filas'} por revisar o corregir.</p>}
        <button disabled={ocupado || !borrador.guardados.length} className="border border-slate-300 rounded-lg px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50" onClick={() => navigate('/etiquetas', { state: { productIdsToPrint: borrador.guardados } })}>Seleccionar etiquetas de productos importados</button>
        <button disabled={ocupado || !!errorBorrador || !seleccionadas.length || pendientes > 0} className="bg-pos-primary hover:bg-pos-primary-dark text-white font-bold rounded-lg px-5 py-2.5 text-sm shadow-md disabled:opacity-50 disabled:cursor-not-allowed" onClick={confirmar}>Importar seleccionadas ({seleccionadas.length})</button>
      </footer>
  </dialog>;
}
