import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell, Legend, Area, AreaChart
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import {
  TrendingUp, Package, AlertTriangle, Activity, Download,
  ArrowUpRight, Eye, EyeOff, ChevronRight, Boxes, BarChart2
} from 'lucide-react';
import { obtenerReportes, obtenerVentasVsCompras, ProductoStockReporte, ReportesData } from '../database/db';
import { mostrarAlerta } from '../utils/alertGlobal';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getLocalISODate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatMoneda(val: number): string {
  return `$${val.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function descargarNavegador(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function escapeCSV(val: string | number): string {
  const s = String(val);
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

type DatoVersus = {
  fechaLabel: string;
  ventas: number;
  compras: number;
};

async function exportarInventarioExcel(productos: ProductoStockReporte[]) {
  const categoriasMap: Record<string, ProductoStockReporte[]> = {};
  productos.forEach(p => {
    const cat = p.categoria || 'Sin Categoría';
    if (!categoriasMap[cat]) categoriasMap[cat] = [];
    categoriasMap[cat].push(p);
  });

  let csvContent = '\uFEFF';
  let totalGeneral = 0;

  Object.entries(categoriasMap).forEach(([cat, prods]) => {
    csvContent += `${escapeCSV('Categoría: ' + cat.toUpperCase())};;;\n`;
    csvContent += `Cantidad;Producto;Precio Unitario;Subtotal\n`;

    let subtotalCat = 0;
    prods.forEach(p => {
      const precio = p.precio_venta ?? 0;
      const sub = p.stock * precio;
      subtotalCat += sub;
      csvContent += `${p.stock};${escapeCSV(p.nombre)};${precio};${sub}\n`;
    });

    totalGeneral += subtotalCat;
    csvContent += `;Subtotal Categoría;;${subtotalCat}\n\n`;
  });

  csvContent += `TOTAL GENERAL DEL INVENTARIO;;;${totalGeneral}\n`;

  const filename = `inventario_${getLocalISODate()}.csv`;
  const esTauri = typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

  if (esTauri) {
    try {
      const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const encoder = new TextEncoder();
      const bytes = encoder.encode(csvContent);
      await writeFile(filename, bytes, { baseDir: BaseDirectory.Download });
      try {
        const { downloadDir, join } = await import('@tauri-apps/api/path');
        const { openPath } = await import('@tauri-apps/plugin-opener');
        const rutaCompleta = await join(await downloadDir(), filename);
        await openPath(rutaCompleta);
      } catch (errAbrir) {
        console.warn('Archivo guardado pero no se pudo abrir automáticamente:', errAbrir);
        mostrarAlerta(`Inventario guardado en Descargas: ${filename}`, 'info');
      }
    } catch (err) {
      console.error('Error al exportar en Tauri:', err);
      descargarNavegador(csvContent, filename);
    }
  } else {
    descargarNavegador(csvContent, filename);
  }
}

// ─── Tooltip Personalizado ────────────────────────────────────────────────────

const TooltipVersus = ({ active, payload, label }: TooltipContentProps) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-slate-900 text-white rounded-xl px-4 py-3 shadow-2xl border border-slate-700 text-sm">
      <p className="font-semibold text-slate-300 mb-2">{label}</p>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="flex items-center gap-2 mb-1">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: entry.color }} />
          <span className="text-slate-300">{entry.name}:</span>
          <span className="font-bold">{formatMoneda(Number(entry.value ?? 0))}</span>
        </div>
      ))}
    </div>
  );
};

const TooltipStock = ({ active, payload, label }: TooltipContentProps) => {
  if (!active || !payload || !payload.length) return null;
  const val = payload[0]?.value ?? 0;
  const minimo = payload[0]?.payload?.stock_minimo ?? 5;
  const critico = val <= minimo;
  return (
    <div className="bg-slate-900 text-white rounded-xl px-4 py-3 shadow-2xl border border-slate-700 text-sm">
      <p className="font-semibold text-slate-300 mb-2 max-w-[160px] truncate">{label}</p>
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${critico ? 'bg-red-400' : 'bg-emerald-400'}`} />
        <span className="text-slate-300">Stock:</span>
        <span className="font-bold">{val} uds.</span>
      </div>
      <p className="text-slate-500 text-xs mt-1">Mínimo: {minimo} uds.</p>
    </div>
  );
};

const TooltipPie = ({ active, payload }: TooltipContentProps) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-slate-900 text-white rounded-xl px-4 py-3 shadow-2xl border border-slate-700 text-sm">
      <p className="font-semibold mb-1">{payload[0].name}</p>
      <p className="text-slate-300">{payload[0].value} productos</p>
    </div>
  );
};

// ─── Paleta cromática (ColorBrewer Set2 + extensiones compatibles) ────────────
// Base (Set2): 8 tonos cualitativos equilibrados
// Extensión (Set3 + Paired): 10 tonos adicionales del mismo rango de saturación
// Total: 18 colores → pocas repeticiones incluso con muchas categorías
const PALETA = [
  // Set2 (solicitados)
  '#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3',
  '#a6d854', '#ffd92f', '#e5c494', '#b3b3b3',
  // Set3 (complementarios)
  '#8dd3c7', '#ffffb3', '#bebada', '#fb8072',
  '#80b1d3', '#fdb462', '#b3de69', '#fccde5',
  // Paired (más profundos para contraste)
  '#a6cee3', '#b2df8a',
];

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function Reportes() {
  const [tabActiva, setTabActiva] = useState<'general' | 'stockCritico'>('general');
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState<string>('');

  const [mostrarVersus, setMostrarVersus] = useState(false);
  const [fechaDesde, setFechaDesde] = useState(() => getLocalISODate(-30));
  const [fechaHasta, setFechaHasta] = useState(() => getLocalISODate());
  const [datosVersus, setDatosVersus] = useState<DatoVersus[]>([]);
  const [cargandoVersus, setCargandoVersus] = useState(false);

  const [data, setData] = useState<ReportesData>({
    kpis: { totalVentas: 0, valorInventario: 0, stockCritico: 0 },
    categorias: [],
    productosStock: [],
    ventasLinea: []
  });

  useEffect(() => {
    const cargarDatos = async () => {
      try {
        const reportes = await obtenerReportes();
        setData(reportes);
        if (reportes.categorias.length > 0) {
          setCategoriaSeleccionada(reportes.categorias[0].name);
        }
      } catch (error) {
        console.error('Error al cargar reportes:', error);
      }
    };
    cargarDatos();
  }, []);

  useEffect(() => {
    if (!mostrarVersus) return;
    const cargarVersus = async () => {
      setCargandoVersus(true);
      try {
        const res = await obtenerVentasVsCompras(fechaDesde, fechaHasta);
        const todasFechas = Array.from(new Set([
          ...res.ventas.map(v => v.fecha),
          ...res.compras.map(c => c.fecha)
        ])).sort();

        const chartData = todasFechas.map(fecha => {
          const v = res.ventas.find(x => x.fecha === fecha)?.total ?? 0;
          const c = res.compras.find(x => x.fecha === fecha)?.total ?? 0;
          const parts = fecha.split('-');
          const mesDia = parts.length === 3 ? `${parts[2]}/${parts[1]}` : fecha;
          return { fechaLabel: mesDia, ventas: v, compras: c };
        });
        setDatosVersus(chartData);
      } catch (err) {
        console.error('Error al cargar versus:', err);
      } finally {
        setCargandoVersus(false);
      }
    };
    cargarVersus();
  }, [mostrarVersus, fechaDesde, fechaHasta]);

  const handleExportarInventario = () => {
    if (data.productosStock.length === 0) {
      mostrarAlerta('No hay productos en el inventario para exportar.', 'advertencia');
      return;
    }
    exportarInventarioExcel(data.productosStock);
  };

  const stockDeCategoria = data.productosStock.filter(p => p.categoria === categoriaSeleccionada);
  const productosCriticos = data.productosStock.filter((p: ProductoStockReporte) => p.stock <= (p.stock_minimo ?? 5));

  // Calcular totales de versus para los badges de resumen
  const totalVentasVersus = datosVersus.reduce((s, d) => s + d.ventas, 0);
  const totalComprasVersus = datosVersus.reduce((s, d) => s + d.compras, 0);

  return (
    <div className="flex-1 flex flex-col overflow-auto bg-slate-100 pos-fade-in">

      {/* ── Header con gradiente ─────────────────────────────── */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 px-8 pt-7 pb-0 shrink-0">
        <div className="flex justify-between items-start mb-6">
          <div>
              <h2 className="text-2xl font-bold text-white">Panel de Reportes</h2>
            <p className="text-slate-400 text-sm mt-0.5">Métricas en tiempo real · {new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <button
            onClick={handleExportarInventario}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white font-bold px-4 py-2.5 rounded-xl transition shadow-lg shadow-emerald-900/30 text-sm"
          >
            <Download className="w-4 h-4" />
            Exportar Inventario (Excel)
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-0">
          {/* Ventas Netas */}
          <div className="bg-white/10 backdrop-blur border border-white/10 rounded-t-2xl px-5 pt-5 pb-4 flex items-center gap-4">
            <div className="p-3 bg-emerald-500/20 rounded-xl shrink-0">
              <TrendingUp className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Ventas Netas</p>
              <p className="text-2xl font-bold text-white mt-0.5">{formatMoneda(data.kpis.totalVentas)}</p>
            </div>
            <ArrowUpRight className="w-5 h-5 text-emerald-400 opacity-70 shrink-0" />
          </div>

          {/* Valor Inventario */}
          <div className="bg-white/10 backdrop-blur border border-white/10 rounded-t-2xl px-5 pt-5 pb-4 flex items-center gap-4">
            <div className="p-3 bg-blue-500/20 rounded-xl shrink-0">
              <Boxes className="w-6 h-6 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Valor Inventario</p>
              <p className="text-2xl font-bold text-white mt-0.5">{formatMoneda(data.kpis.valorInventario)}</p>
            </div>
            <ArrowUpRight className="w-5 h-5 text-blue-400 opacity-70 shrink-0" />
          </div>

          {/* Stock Crítico - clickeable */}
          <div
            onClick={() => setTabActiva('stockCritico')}
            className="bg-white/10 backdrop-blur border border-white/10 rounded-t-2xl px-5 pt-5 pb-4 flex items-center gap-4 cursor-pointer hover:bg-white/15 transition-all group"
          >
            <div className="p-3 bg-red-500/20 rounded-xl shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Stock Crítico</p>
              <p className="text-2xl font-bold text-white mt-0.5">{data.kpis.stockCritico} <span className="text-base font-medium text-slate-400">productos</span></p>
            </div>
            <ChevronRight className="w-5 h-5 text-red-400 opacity-70 shrink-0 group-hover:translate-x-1 transition-transform" />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-5">
          <button
            onClick={() => setTabActiva('general')}
            className={`pb-3 px-5 font-semibold text-sm border-b-2 transition-all ${
              tabActiva === 'general'
                ? 'border-emerald-400 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Estadísticas Generales
          </button>
          <button
            onClick={() => setTabActiva('stockCritico')}
            className={`pb-3 px-5 font-semibold text-sm border-b-2 transition-all flex items-center gap-2 ${
              tabActiva === 'stockCritico'
                ? 'border-emerald-400 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Stock Crítico
            {data.kpis.stockCritico > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5 leading-none">
                {data.kpis.stockCritico}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Contenido ────────────────────────────────────────── */}
      <div className="p-6 flex flex-col flex-1 gap-6">

        {tabActiva === 'general' ? (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* ── Gráfica 1: Versus Ventas vs Compras ── */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                {/* Card header */}
                <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
                      <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest ml-1">Versus</h3>
                    </div>
                    <p className="text-base font-bold text-slate-800">Ventas vs Compras</p>
                  </div>
                  {mostrarVersus && (
                    <button
                      onClick={() => setMostrarVersus(false)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition"
                    >
                      <EyeOff className="w-3.5 h-3.5" /> Ocultar
                    </button>
                  )}
                </div>

                {!mostrarVersus ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-10 bg-gradient-to-b from-slate-50 to-white min-h-[260px]">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                      <Activity className="w-7 h-7 text-slate-400" />
                    </div>
                    <p className="text-sm font-bold text-slate-700 mb-1">Comparativa desactivada</p>
                    <p className="text-xs text-slate-400 text-center mb-5 max-w-[260px]">
                      Analiza las ventas frente al costo de adquisición de inventario en un rango de fechas personalizado.
                    </p>
                    <button
                      onClick={() => setMostrarVersus(true)}
                      className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition shadow-sm"
                    >
                      <Eye className="w-3.5 h-3.5" /> Ver Versus
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col flex-1 p-6">
                    {/* Filtros de fecha */}
                    <div className="flex flex-wrap items-center gap-3 mb-5 bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-500">Desde:</span>
                        <input
                          type="date"
                          value={fechaDesde}
                          onChange={e => setFechaDesde(e.target.value)}
                          className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 bg-white text-slate-700 font-medium transition"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-500">Hasta:</span>
                        <input
                          type="date"
                          value={fechaHasta}
                          onChange={e => setFechaHasta(e.target.value)}
                          className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 bg-white text-slate-700 font-medium transition"
                        />
                      </div>
                      {/* Badges de resumen */}
                      {datosVersus.length > 0 && !cargandoVersus && (
                        <div className="ml-auto flex gap-2">
                          <span className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-lg">
                            ↑ {formatMoneda(totalVentasVersus)}
                          </span>
                          <span className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold px-2.5 py-1 rounded-lg">
                            ↓ {formatMoneda(totalComprasVersus)}
                          </span>
                        </div>
                      )}
                    </div>

                    {cargandoVersus ? (
                      <div className="flex-1 flex flex-col items-center justify-center gap-3 py-10">
                        <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-sm text-slate-400">Cargando comparativa...</p>
                      </div>
                    ) : datosVersus.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center gap-2 py-10">
                        <Activity className="w-8 h-8 text-slate-300" />
                        <p className="text-sm text-slate-400">Sin datos en el rango seleccionado.</p>
                      </div>
                    ) : (
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={datosVersus} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                            <defs>
                              <linearGradient id="gradVentas" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id="gradCompras" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.15} />
                                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis
                              dataKey="fechaLabel"
                              axisLine={false}
                              tickLine={false}
                              tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                            />
                            <YAxis
                              axisLine={false}
                              tickLine={false}
                              tick={{ fill: '#94a3b8', fontSize: 10 }}
                              tickFormatter={v => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                              width={40}
                            />
                            <RechartsTooltip content={TooltipVersus} />
                            <Legend
                              iconType="circle"
                              iconSize={8}
                              wrapperStyle={{ fontSize: '12px', fontWeight: 600, paddingTop: '8px' }}
                            />
                            <Area type="monotone" dataKey="ventas" name="Ventas" stroke="#10b981" strokeWidth={2.5} fill="url(#gradVentas)" dot={false} activeDot={{ r: 5, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }} />
                            <Area type="monotone" dataKey="compras" name="Compras" stroke="#f43f5e" strokeWidth={2.5} fill="url(#gradCompras)" dot={false} activeDot={{ r: 5, fill: '#f43f5e', strokeWidth: 2, stroke: '#fff' }} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Gráfica 2: Productos por Categoría (barras horizontales) ── */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                <div className="px-6 pt-5 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-2 mb-0.5">
                    <BarChart2 className="w-3.5 h-3.5 text-slate-400" />
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Distribución</h3>
                  </div>
                  <p className="text-base font-bold text-slate-800">Productos por Categoría</p>
                  <p className="text-xs text-slate-400 mt-0.5">Haz clic en una barra para ver el stock de esa categoría</p>
                </div>

                <div className="flex-1 p-6">
                  {data.categorias.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-400 min-h-[220px]">
                      <Package className="w-10 h-10 opacity-30" />
                      <p className="text-sm">Agrega productos para ver estadísticas</p>
                    </div>
                  ) : (
                    <div style={{ height: Math.max(180, data.categorias.length * 48) }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={data.categorias}
                          layout="vertical"
                          margin={{ left: 8, right: 32, top: 4, bottom: 4 }}
                          barCategoryGap="28%"
                        >
                          <CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="#f1f5f9" />
                          <XAxis
                            type="number"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: '#94a3b8', fontSize: 10 }}
                            allowDecimals={false}
                          />
                          <YAxis
                            dataKey="name"
                            type="category"
                            width={110}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: '#475569', fontSize: 11, fontWeight: 600 }}
                          />
                          <RechartsTooltip content={TooltipPie} cursor={{ fill: '#f8fafc' }} />
                          <Bar
                            dataKey="value"
                            name="Productos"
                            radius={[0, 6, 6, 0]}
                            maxBarSize={28}
                            className="cursor-pointer"
                            onClick={(entry) => {
                              const nombre = entry?.name ?? '';
                              if (nombre) setCategoriaSeleccionada((prev: string) => prev === nombre ? '' : nombre);
                            }}
                          >
                            {data.categorias.map((entry, index) => (
                              <Cell
                                key={`cell-cat-${index}`}
                                fill={PALETA[index % PALETA.length]}
                                opacity={!categoriaSeleccionada || categoriaSeleccionada === entry.name ? 1 : 0.3}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  {categoriaSeleccionada && (
                    <p className="text-xs text-slate-400 mt-3">
                      Mostrando stock de: <span className="font-bold text-slate-600">{categoriaSeleccionada}</span>
                      <button
                        onClick={() => setCategoriaSeleccionada('')}
                        className="ml-2 text-slate-400 hover:text-slate-600 underline"
                      >
                        ver todo
                      </button>
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Gráfica 3: Niveles de Stock ── */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex justify-between items-center">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <BarChart2 className="w-3.5 h-3.5 text-slate-400" />
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Inventario</h3>
                  </div>
                  <p className="text-base font-bold text-slate-800">
                    Niveles de Stock
                    {categoriaSeleccionada
                      ? <> — <span className="text-slate-600">{categoriaSeleccionada}</span></>
                      : <span className="text-slate-400 font-normal text-sm ml-1">(sin categoría seleccionada)</span>
                    }
                  </p>
                </div>
                {/* Leyenda manual */}
                <div className="flex items-center gap-4 text-xs font-semibold text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <span className="w-14 h-3 rounded inline-block" style={{ background: 'linear-gradient(to right, #66c2a5, #fc8d62, #8da0cb, #e78ac3)' }} />
                    Stock por producto
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-rose-400 inline-block" />Crítico
                  </span>
                </div>
              </div>

              <div className="p-6">
                {stockDeCategoria.length === 0 ? (
                  <div className="h-36 flex flex-col items-center justify-center gap-2 text-slate-400">
                    <Activity className="w-8 h-8 opacity-30" />
                    <p className="text-sm">Selecciona una categoría en la gráfica de arriba</p>
                  </div>
                ) : (
                  <div style={{ height: Math.max(180, stockDeCategoria.length * 44) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={stockDeCategoria}
                        layout="vertical"
                        margin={{ left: 10, right: 40, top: 0, bottom: 0 }}
                        barCategoryGap="30%"
                      >
                        <CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="#f1f5f9" />
                        <XAxis
                          type="number"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: '#94a3b8', fontSize: 10 }}
                          allowDecimals={false}
                        />
                        <YAxis
                          dataKey="nombre"
                          type="category"
                          width={160}
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: '#475569', fontSize: 11, fontWeight: 600 }}
                        />
                        <RechartsTooltip content={TooltipStock} cursor={{ fill: '#f8fafc' }} />
                        <Bar dataKey="stock" name="Stock" radius={[0, 5, 5, 0]} maxBarSize={22} label={{ position: 'right', fontSize: 10, fill: '#94a3b8', fontWeight: 700 }}>
                          {stockDeCategoria.map((entry, index) => (
                            <Cell
                              key={`cell-stock-${index}`}
                              fill={entry.stock <= (entry.stock_minimo ?? 5) ? '#f87171' : PALETA[index % PALETA.length]}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          /* ── Pestaña: Stock Crítico ── */
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex-1 flex flex-col">
            {/* Header de la tabla */}
            <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex justify-between items-center shrink-0 bg-gradient-to-r from-red-50 to-white">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  <h3 className="text-sm font-bold text-red-500 uppercase tracking-widest">Alerta</h3>
                </div>
                <p className="text-base font-bold text-slate-800">Productos con Stock Crítico</p>
                <p className="text-xs text-slate-500 mt-0.5">Productos cuyas existencias están en o por debajo del mínimo establecido.</p>
              </div>
              {productosCriticos.length > 0 && (
                <span className="bg-red-100 border border-red-200 text-red-700 text-sm font-bold rounded-full px-4 py-1.5">
                  {productosCriticos.length} {productosCriticos.length === 1 ? 'producto' : 'productos'}
                </span>
              )}
            </div>

            <div className="overflow-auto flex-1">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-500 sticky top-0 border-b border-slate-100 z-10">
                  <tr>
                    <th className="px-6 py-3.5 font-semibold text-xs uppercase tracking-wider">Producto</th>
                    <th className="px-6 py-3.5 font-semibold text-xs uppercase tracking-wider">Categoría</th>
                    <th className="px-6 py-3.5 font-semibold text-xs uppercase tracking-wider text-center">Stock Actual</th>
                    <th className="px-6 py-3.5 font-semibold text-xs uppercase tracking-wider text-center">Mínimo</th>
                    <th className="px-6 py-3.5 font-semibold text-xs uppercase tracking-wider text-center">Estado</th>
                    <th className="px-6 py-3.5 font-semibold text-xs uppercase tracking-wider text-center">Déficit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {productosCriticos.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center gap-3 text-slate-400">
                          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center">
                            <Package className="w-7 h-7 text-emerald-400" />
                          </div>
                          <p className="font-semibold text-slate-600">¡Todo en orden!</p>
                          <p className="text-sm">No hay productos con stock crítico en este momento.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    productosCriticos.map((p: ProductoStockReporte, idx: number) => {
                      const minimo = p.stock_minimo ?? 5;
                      const deficit = Math.max(0, minimo - p.stock);
                      const porcentaje = minimo > 0 ? Math.min(100, (p.stock / minimo) * 100) : 0;
                      return (
                        <tr key={idx} className="hover:bg-slate-50/80 transition-colors group">
                          <td className="px-6 py-4">
                            <div className="font-semibold text-slate-800 group-hover:text-indigo-700 transition-colors">{p.nombre}</div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                              {p.categoria || 'Sin categoría'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="inline-flex flex-col items-center gap-1">
                              <span className={`text-lg font-bold ${p.stock === 0 ? 'text-red-600' : 'text-amber-600'}`}>
                                {p.stock}
                              </span>
                              {/* Mini barra de progreso */}
                              <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${p.stock === 0 ? 'bg-red-500' : 'bg-amber-400'}`}
                                  style={{ width: `${porcentaje}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center text-slate-500 font-medium">{minimo}</td>
                          <td className="px-6 py-4 text-center">
                            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border ${
                              p.stock === 0
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}>
                              {p.stock === 0 ? '🔴 Agotado' : '🟡 Stock Bajo'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className="text-xs font-bold text-red-600 bg-red-50 border border-red-100 px-2 py-1 rounded-lg">
                              −{deficit} uds.
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}