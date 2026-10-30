import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Printer, Search, Tags, X } from 'lucide-react';
import { obtenerProductos, type Producto } from '../database/db';
import { imprimirEtiquetasTSPL, nombreParaEtiqueta, type ItemEtiqueta } from '../utils/tspl';
import { cambioRevisionEtiquetas, etiquetasParaImprimir, seleccionarRango } from '../utils/seleccionEtiquetas';
import { mostrarAlerta } from '../utils/alertGlobal';

const moneda = (valor: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 }).format(valor);

export default function Etiquetas() {
  const location = useLocation();
  const navigate = useNavigate();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [seleccionados, setSeleccionados] = useState<number[]>([]);
  const [modo, setModo] = useState<'stock' | 'personalizada'>('stock');
  const [cantidades, setCantidades] = useState<Record<number, number>>({});
  const ancla = useRef<number | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [categoria, setCategoria] = useState('');
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [revision, setRevision] = useState<ItemEtiqueta[] | null>(null);
  const [error, setError] = useState('');
  const operacion = useRef(false);
  const precargado = useRef(false);
  const seleccionarTodos = useRef<HTMLInputElement>(null);
  const dialogoRevision = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let activo = true;
    obtenerProductos().then(datos => {
      if (!activo) return;
      setProductos(datos);
      if (!precargado.current) {
        precargado.current = true;
        const ids: unknown = location.state?.productIdsToPrint;
        const producto: unknown = location.state?.productToPrint;
        const elegidos = Array.isArray(ids) ? ids.filter((id: unknown): id is number => typeof id === 'number') :
          producto && typeof producto === 'object' && 'id' in producto && typeof producto.id === 'number' ? [producto.id] : [];
        setSeleccionados(etiquetasParaImprimir(datos, elegidos).map(item => item.producto.id!));
        if (elegidos.length) navigate('/etiquetas', { replace: true });
      }
    }).catch(() => { if (activo) setError('No se pudieron cargar los productos. Vuelva a abrir Etiquetas.'); })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, []);

  const categorias = [...new Set(productos.map(p => p.categoria).filter(Boolean))].sort();
  const consulta = busqueda.toLocaleLowerCase().trim();
  const filtrados = productos.filter(p => (!categoria || p.categoria === categoria) &&
    (!consulta || `${p.nombre} ${p.nombre_etiqueta ?? ''} ${p.codigo_barras}`.toLocaleLowerCase().includes(consulta)));
  const imprimibles = filtrados.filter(p => modo === 'personalizada' || (Number.isSafeInteger(p.stock) && p.stock > 0));
  const idsSeleccionados = new Set(seleccionados);
  const todosVisibles = imprimibles.length > 0 && imprimibles.every(p => idsSeleccionados.has(p.id!));
  const algunoVisible = imprimibles.some(p => idsSeleccionados.has(p.id!));
  const cantidadesElegidas = modo === 'personalizada' ? cantidades : undefined;
  const cola = etiquetasParaImprimir(productos, seleccionados, cantidadesElegidas);
  const cantidadInvalida = cola.some(item => !Number.isSafeInteger(item.cantidad) || item.cantidad <= 0);
  const total = cola.reduce((suma, item) => suma + (Number.isSafeInteger(item.cantidad) && item.cantidad > 0 ? item.cantidad : 0), 0);

  useEffect(() => { ancla.current = null; }, [busqueda, categoria, modo]);

  useEffect(() => {
    if (seleccionarTodos.current) seleccionarTodos.current.indeterminate = algunoVisible && !todosVisibles;
  }, [algunoVisible, todosVisibles]);

  useEffect(() => {
    if (revision && dialogoRevision.current && !dialogoRevision.current.open) dialogoRevision.current.showModal();
  }, [revision]);

  const marcarVisibles = (marcar: boolean) => {
    ancla.current = null;
    const ids = new Set(imprimibles.map(p => p.id!));
    setSeleccionados(prev => marcar ? [...new Set([...prev, ...ids])] : prev.filter(id => !ids.has(id)));
  };
  const marcarProducto = (id: number, shift: boolean, marcar: boolean) => {
    const inicio = ancla.current;
    setSeleccionados(prev => seleccionarRango(prev, imprimibles.map(p => p.id!), inicio, id, shift, marcar));
    ancla.current = id;
  };
  const cargarRevision = async () => {
    if (operacion.current || !cola.length || cantidadInvalida) return;
    operacion.current = true; setOcupado(true); setError('');
    try {
      const actuales = await obtenerProductos();
      const items = etiquetasParaImprimir(actuales, seleccionados, cantidadesElegidas);
      setProductos(actuales);
      setSeleccionados(items.map(item => item.producto.id!));
      if (!items.length) { setError('No quedan productos seleccionados disponibles para imprimir.'); return; }
      setRevision(items);
    } catch { setError('No se pudo consultar el inventario actual. Intente nuevamente.'); }
    finally { operacion.current = false; setOcupado(false); }
  };
  const imprimir = async () => {
    if (operacion.current || !revision?.length) return;
    operacion.current = true; setOcupado(true); setError('');
    try {
      const actuales = await obtenerProductos();
      const items = etiquetasParaImprimir(actuales, revision.map(item => item.producto.id!), cantidadesElegidas);
      setProductos(actuales);
      setSeleccionados(items.map(item => item.producto.id!));
      if (cambioRevisionEtiquetas(revision, items)) {
        setRevision(items.length ? items : null);
        setError('Cambió el stock o la ficha de un producto. Actualizamos la revisión; verifique los datos antes de imprimir.');
        return;
      }
      await imprimirEtiquetasTSPL(items);
      setRevision(null); setSeleccionados([]);
      mostrarAlerta('Etiquetas enviadas a la impresora.', 'info');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron imprimir las etiquetas.'); }
    finally { operacion.current = false; setOcupado(false); }
  };
  const totalRevision = revision?.reduce((suma, item) => suma + item.cantidad, 0) ?? 0;

  return <div className="p-6 flex-1 flex flex-col gap-4 overflow-hidden pos-fade-in">
    <header className="shrink-0 flex items-center justify-between gap-4">
      <div><h2 className="text-xl font-bold text-slate-800 flex gap-2 items-center"><Tags className="w-6 h-6 text-pos-primary" />Impresión de etiquetas</h2>
        <p className="text-sm text-slate-500">Cantidad según stock o personalizada. Use Shift + clic para seleccionar un rango visible.</p></div>
      <button disabled={ocupado || cargando || !cola.length || cantidadInvalida || total > 50000} onClick={cargarRevision} className="bg-pos-primary text-white rounded-xl px-5 py-3 font-semibold flex gap-2 items-center disabled:opacity-50 hover:bg-pos-primary-dark">
        <Printer className="w-5 h-5" />Revisar e imprimir</button>
    </header>
    {error && !revision && <p role="alert" className="text-red-700 bg-red-50 rounded p-3">{error}</p>}
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 shrink-0 flex flex-wrap items-center gap-3">
      <label className="text-sm flex items-center gap-2">Cantidad:
        <select disabled={ocupado} value={modo} onChange={e => setModo(e.target.value as 'stock' | 'personalizada')} className="border border-slate-300 rounded-lg p-2">
          <option value="stock">Según stock</option><option value="personalizada">Personalizada por producto</option>
        </select>
      </label>
      <div className="relative flex-1 min-w-52"><Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
        <input aria-label="Buscar productos" disabled={ocupado} className="w-full border border-slate-300 rounded-lg py-2 pl-9 pr-3 text-sm" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Nombre, etiqueta o código de barras..." /></div>
      <select aria-label="Filtrar por categoría" disabled={ocupado} className="border border-slate-300 rounded-lg p-2 text-sm" value={categoria} onChange={e => setCategoria(e.target.value)}>
        <option value="">Todas las categorías</option>{categorias.map(c => <option key={c}>{c}</option>)}</select>
      <button disabled={ocupado || cargando || !imprimibles.length} className="border rounded-lg px-3 py-2 text-sm disabled:opacity-50" onClick={() => marcarVisibles(true)}>Seleccionar todos ({imprimibles.length})</button>
      <button disabled={ocupado || !seleccionados.length} className="border rounded-lg px-3 py-2 text-sm disabled:opacity-50" onClick={() => { setSeleccionados([]); ancla.current = null; }}>Deseleccionar todos</button>
    </div>
    <div className="flex-1 min-h-0 overflow-auto rounded-xl bg-white border border-slate-200 shadow-sm">
      <table className="w-full text-sm text-left">
        <thead className="sticky top-0 bg-slate-50 text-slate-600 z-10"><tr>
          <th className="p-3"><input ref={seleccionarTodos} type="checkbox" aria-label="Seleccionar todos los productos visibles disponibles" disabled={ocupado || !imprimibles.length} checked={todosVisibles} onChange={e => marcarVisibles(e.target.checked)} /></th>
          <th className="p-3">Nombre del producto</th><th className="p-3">Nombre en etiqueta</th><th className="p-3">Categoría</th><th className="p-3">Código</th>
          <th className="p-3 text-right">Compra</th><th className="p-3 text-right">Venta</th><th className="p-3 text-center">Stock</th><th className="p-3 text-center">Etiquetas</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">{filtrados.map(p => {
          const marcado = idsSeleccionados.has(p.id!);
          const noDisponible = modo === 'stock' && (!Number.isSafeInteger(p.stock) || p.stock <= 0);
          return <tr key={p.id} className={marcado ? 'bg-emerald-50' : 'hover:bg-slate-50'}
            onMouseDown={e => { if (e.shiftKey && !(e.target as HTMLElement).closest('input')) e.preventDefault(); }}
            onClick={e => { if (!ocupado && !noDisponible && !(e.target as HTMLElement).closest('input')) marcarProducto(p.id!, e.shiftKey, !marcado); }}>
            <td className="p-3"><input type="checkbox" aria-label={`Seleccionar ${p.nombre} (${p.codigo_barras})`} disabled={ocupado || noDisponible} checked={marcado} onChange={() => {}} onClick={e => marcarProducto(p.id!, e.shiftKey, e.currentTarget.checked)} /></td>
            <td className="p-3 font-medium text-slate-800 min-w-44">{p.nombre}</td>
            <td className="p-3 font-mono whitespace-nowrap" title={p.nombre_etiqueta || p.nombre}>{nombreParaEtiqueta(p)}</td>
            <td className="p-3 text-slate-500">{p.categoria}</td><td className="p-3 font-mono whitespace-nowrap">{p.codigo_barras}</td>
            <td className="p-3 text-right whitespace-nowrap">{moneda(p.precio_compra)}</td><td className="p-3 text-right whitespace-nowrap text-pos-primary-dark font-semibold">{moneda(p.precio_venta)}</td>
            <td className="p-3 text-center">{p.stock}</td><td className="p-3 text-center font-semibold">{modo === 'personalizada' ?
              <input type="number" min="1" max="50000" step="1" aria-label={`Cantidad de etiquetas para ${p.nombre}`} disabled={ocupado || !marcado} value={Number.isNaN(cantidades[p.id!]) ? '' : (cantidades[p.id!] ?? 1)}
                onChange={e => setCantidades(prev => ({ ...prev, [p.id!]: e.target.valueAsNumber }))} className="w-20 border border-slate-300 rounded p-1 text-center disabled:opacity-40" /> :
              (marcado && !noDisponible ? p.stock : 0)}</td>
          </tr>;
        })}{!filtrados.length && <tr><td colSpan={9} className="text-center p-10 text-slate-500">{cargando ? 'Cargando productos...' : 'No hay productos que coincidan.'}</td></tr>}</tbody>
      </table>
    </div>
    <footer className="shrink-0 flex justify-between gap-4 text-sm text-slate-600">
      <span>{filtrados.length} productos visibles · Seleccionados: <strong>{cola.length}</strong></span>
      <span>Total de etiquetas: <strong>{total.toLocaleString('es-CO')}</strong> · {Math.ceil(total / 3)} filas de 3</span>
    </footer>
    {total > 50000 && <p role="alert" className="text-amber-700 text-sm">Seleccione menos productos: el máximo por trabajo es de 50.000 etiquetas.</p>}
    {cantidadInvalida && <p role="alert" className="text-red-700 text-sm">Ingrese una cantidad entera mayor a cero para cada producto seleccionado.</p>}
    {revision && <dialog ref={dialogoRevision} aria-labelledby="titulo-revision" onCancel={e => { e.preventDefault(); if (!operacion.current) setRevision(null); }} className="bg-white rounded-2xl shadow-xl w-[calc(100%-2rem)] max-w-6xl max-h-[90vh] flex flex-col p-0 m-auto backdrop:bg-slate-900/50">
        <header className="p-5 border-b flex justify-between items-center"><div><h3 id="titulo-revision" className="font-bold text-xl">Verificar antes de imprimir</h3><p className="text-sm text-slate-500">Nombre en etiqueta tal como se imprimirá, máximo 16 caracteres.</p></div>
          <button aria-label="Cerrar revisión" disabled={ocupado} onClick={() => setRevision(null)} className="p-2 rounded hover:bg-slate-100"><X /></button></header>
        <div className="overflow-auto flex-1 min-h-0"><table className="w-full text-sm text-left">
          <thead className="sticky top-0 bg-slate-50"><tr>{['Nombre del producto', 'Nombre en etiqueta', 'Código', 'Compra', 'Venta en etiqueta', 'Stock', 'Etiquetas'].map(t => <th key={t} className="p-3">{t}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{revision.map(({ producto: p, cantidad }) => <tr key={p.id}>
            <td className="p-3">{p.nombre}</td><td className="p-3 font-mono whitespace-nowrap">{nombreParaEtiqueta(p)}</td><td className="p-3 font-mono">{p.codigo_barras}</td>
            <td className="p-3 whitespace-nowrap">{moneda(p.precio_compra)}</td><td className="p-3 whitespace-nowrap font-semibold">{moneda(Math.round(p.precio_venta))}</td><td className="p-3 text-center">{p.stock}</td><td className="p-3 text-center font-bold">{cantidad}</td>
          </tr>)}</tbody></table></div>
        {error && <p role="alert" className="p-3 m-3 text-red-700 bg-red-50 rounded">{error}</p>}
        <footer className="p-5 border-t flex flex-wrap gap-4 items-center justify-between">
          <p className="text-sm">Productos: <strong>{revision.length}</strong> · Total: <strong>{totalRevision.toLocaleString('es-CO')} etiquetas</strong></p>
          <div className="flex gap-3"><button autoFocus disabled={ocupado} className="border rounded-lg px-4 py-2" onClick={() => setRevision(null)}>Volver a seleccionar</button>
            <button disabled={ocupado || !revision.length || totalRevision > 50000} onClick={imprimir} className="bg-pos-primary text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-50">{ocupado ? 'Enviando...' : 'Confirmar e imprimir'}</button></div>
        </footer>
    </dialog>}
  </div>;
}
