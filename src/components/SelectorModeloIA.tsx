import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { listarModelosIA, type ModeloIA } from '../services/facturaIA';

export default function SelectorModeloIA({ proveedor, apiKey, value, onChange }: {
  proveedor: string; apiKey: string; value: string; onChange: (modelo: string) => void;
}) {
  const id = useId();
  const [modelos, setModelos] = useState<ModeloIA[]>([]);
  const [cargando, setCargando] = useState(false);
  const [consultado, setConsultado] = useState(false);
  const [error, setError] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [soloGratis, setSoloGratis] = useState(proveedor === 'openrouter');
  const solicitud = useRef(0);
  useEffect(() => {
    solicitud.current++;
    setModelos([]); setConsultado(false); setError(''); setCargando(false); setBusqueda('');
    setSoloGratis(proveedor === 'openrouter');
    return () => { solicitud.current++; };
  }, [proveedor, apiKey]);

  const actualizar = async () => {
    const turno = ++solicitud.current;
    setCargando(true); setError('');
    try {
      const lista = await listarModelosIA(proveedor, apiKey);
      if (solicitud.current !== turno) return;
      setModelos(lista); setConsultado(true);
    } catch (e) {
      if (solicitud.current === turno) setError(e instanceof Error ? e.message : 'No se pudo cargar el catálogo.');
    } finally {
      if (solicitud.current === turno) setCargando(false);
    }
  };
  const visibles = modelos.filter(m => (!soloGratis || m.gratuito === true) &&
    `${m.nombre} ${m.id}`.toLowerCase().includes(busqueda.trim().toLowerCase()));
  const seleccionado = modelos.find(m => m.id === value);
  const campo = 'w-full min-w-0 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-pos-primary';

  return <div className="space-y-2 min-w-0">
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <label htmlFor={id} className="text-sm font-semibold text-slate-700">Modelo de IA</label>
      <button type="button" onClick={actualizar} disabled={cargando || (proveedor !== 'openrouter' && !apiKey.trim())}
        className="flex items-center gap-1.5 text-sm font-medium text-pos-primary disabled:opacity-50">
        {cargando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        {cargando ? 'Consultando...' : 'Actualizar modelos'}
      </button>
    </div>
    {proveedor === 'openrouter' && <label className="flex items-center gap-2 text-sm text-slate-600">
      <input type="checkbox" checked={soloGratis} onChange={e => setSoloGratis(e.target.checked)} /> Solo gratuitos
    </label>}
    <input aria-label="Buscar modelo" type="search" className={campo} value={busqueda}
      onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por nombre o ID" />
    <select id={id} className={campo} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Seleccione un modelo del catálogo</option>
      {value && !visibles.some(m => m.id === value) && <option value={value}>{value} (seleccionado)</option>}
      {visibles.map(m => <option key={m.id} value={m.id}>
        {m.nombre} · {m.id}{m.gratuito === true ? ' · Gratis' : ''}
      </option>)}
    </select>
    <input aria-label="ID del modelo" className={`${campo} font-mono`} value={value}
      onChange={e => onChange(e.target.value.trim())} placeholder="O escriba el ID exacto del modelo" />
    <div className="text-xs text-slate-500" aria-live="polite">
      {!consultado && !cargando && <p>Pulse «Actualizar modelos» para consultar el catálogo actual del proveedor.</p>}
      {consultado && <p>{visibles.length} de {modelos.length} modelos. «Probar conexión» comprueba el acceso y la cuota de su clave.</p>}
      {consultado && value && !seleccionado && <p className="text-amber-700">El modelo guardado no aparece en el catálogo actual. Seleccione otro y pruebe la conexión.</p>}
      {soloGratis && seleccionado?.gratuito === false && <p className="text-amber-700">El modelo seleccionado es de pago. El filtro no cambia su selección.</p>}
      {consultado && !visibles.length && <p>No hay modelos con estos filtros. Pruebe otra búsqueda o actualice el catálogo.</p>}
    </div>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </div>;
}
