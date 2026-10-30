import { useId, useMemo, useState } from 'react';
import { Search, Check, TriangleAlert } from 'lucide-react';
import type { Producto } from '../database/db';
import { asociarFilaFactura, buscarProductosFactura, sugerirProductosExistentes, type FilaFactura } from '../utils/importacionFactura';

export default function AsociarProductoFactura({ fila, productos, onChange }: {
  fila: FilaFactura; productos: Producto[]; onChange: (cambio: Partial<FilaFactura>) => void;
}) {
  const id = useId();
  const [busqueda, setBusqueda] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [limite, setLimite] = useState(5);
  const asociado = productos.find(p => p.id === fila.producto_id);
  const sugerencias = useMemo(() => sugerirProductosExistentes(fila.nombre, fila.codigo_barras, productos), [fila.nombre, fila.codigo_barras, productos]);
  const resultados = useMemo(() => buscarProductosFactura(busqueda, productos), [busqueda, productos]);
  const pendientes = sugerencias.some(c => !fila.coincidencias_descartadas?.includes(c.producto.id!));
  const lista = busqueda.trim() ? resultados : sugerencias.map(c => c.producto);
  const elegir = (producto: Producto) => {
    onChange(asociarFilaFactura(fila, producto));
    setBusqueda(''); setBuscando(false); setLimite(5);
  };

  return <div className="space-y-2 min-w-0">
    {asociado && <div className="border border-emerald-200 rounded-lg p-3 bg-emerald-50 text-sm space-y-1">
      <p className="font-semibold text-emerald-800 flex items-center gap-1"><Check className="w-4 h-4" /> Sumar a producto registrado</p>
      <p className="font-medium text-slate-800 break-words">{asociado.nombre}</p>
      <p className="text-xs text-slate-600">Código {asociado.codigo_barras} · Stock actual: {asociado.stock} · Llegan: {fila.cantidad ?? '—'} · Quedaría: {Number.isSafeInteger(fila.cantidad) && (fila.cantidad ?? 0) > 0 ? asociado.stock + fila.cantidad! : '—'}</p>
      <p className="text-xs text-slate-500">Conserva su código y precios registrados.</p>
      <div className="flex gap-3 flex-wrap pt-1">
        <button type="button" className="text-xs font-semibold text-pos-primary" onClick={() => setBuscando(v => !v)}>{buscando ? 'Cerrar búsqueda' : 'Cambiar producto'}</button>
        <button type="button" className="text-xs text-slate-600 underline" onClick={() => {
          onChange({ producto_id: null, codigo_barras: '', coincidencias_descartadas: undefined });
          setBusqueda(''); setBuscando(true);
        }}>Es otro producto</button>
      </div>
    </div>}
    {!asociado && <div className={`rounded-lg p-3 border text-xs ${sugerencias.length && pendientes ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
      {sugerencias.length ? <p className="font-semibold flex items-center gap-1"><TriangleAlert className="w-4 h-4 shrink-0" />{pendientes ? 'Este producto podría estar registrado. Revise las coincidencias.' : 'Revisado: se creará como producto nuevo.'}</p>
        : <p>No encontramos coincidencias por nombre o código. Puede buscar en el inventario antes de crear el producto.</p>}
    </div>}
    {(!asociado || buscando) && <>
      <label htmlFor={id} className="block text-xs font-semibold text-slate-600">Buscar en el inventario</label>
      <div className="relative"><Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
        <input id={id} type="search" value={busqueda} onChange={e => { setBusqueda(e.target.value); setLimite(5); }}
          placeholder="Nombre, palabra, etiqueta o código de barras"
          className="w-full min-w-0 border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm bg-white outline-none focus:border-pos-primary" />
      </div>
      {!!lista.length && <div className="border border-slate-200 rounded-lg overflow-hidden">
        <p className="px-3 py-2 bg-slate-50 text-xs font-semibold text-slate-600">{busqueda.trim() ? 'Resultados' : 'Posibles coincidencias'} · {lista.length}</p>
        <ul className="divide-y divide-slate-100 max-h-72 overflow-auto">
          {lista.slice(0, limite).map(p => <li key={p.id} className="p-3 space-y-1">
            <p className="text-sm font-medium text-slate-800 break-words">{p.nombre}</p>
            <p className="text-xs text-slate-500">Código {p.codigo_barras} · {p.categoria} · Stock: {p.stock}</p>
            {!busqueda.trim() && <p className="text-xs text-amber-700">{sugerencias.find(c => c.producto.id === p.id)?.motivo}</p>}
            <button type="button" aria-label={`Asociar ${p.nombre}, código ${p.codigo_barras}`} onClick={() => elegir(p)} className="text-xs font-semibold text-pos-primary hover:underline">Es este producto · sumar {fila.cantidad ?? '—'} unidades</button>
          </li>)}
        </ul>
        {lista.length > limite && <button type="button" onClick={() => setLimite(n => n + 10)} className="w-full py-2 text-xs text-pos-primary font-semibold bg-slate-50">Mostrar más ({lista.length - limite} pendientes)</button>}
      </div>}
      {busqueda.trim() && !lista.length && <p role="status" className="text-xs text-slate-500">No hay resultados para esta búsqueda. Revise las coincidencias sugeridas al borrar el texto.</p>}
      {!asociado && sugerencias.length > 0 && pendientes && <button type="button" className="text-xs text-slate-600 underline" onClick={() => onChange({ coincidencias_descartadas: sugerencias.map(c => c.producto.id!) })}>
        Revisé las coincidencias: es un producto diferente, crear nuevo
      </button>}
    </>}
  </div>;
}
