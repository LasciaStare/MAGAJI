import { useState, useEffect } from 'react';
import { descargarPDFFactura, DatosFactura, FormatoFactura } from '../utils/factura';
import { imprimirTicketTermico } from '../utils/escpos';
import SelectorFormatoFactura from '../components/SelectorFormatoFactura';
import ImportarFactura from '../components/ImportarFactura';
import { mostrarAlerta } from '../utils/alertGlobal';
import { Plus, X, Save, ArrowUpRight, ArrowDownLeft, History, Search, Package, ShoppingBag, FileText, Edit, AlertTriangle, Printer, Download, Trash2 } from 'lucide-react';
import {
  obtenerMovimientos,
  registrarMovimiento,
  obtenerEstadisticasInventario,
  obtenerProductos,
  obtenerTodasLasVentas,
  obtenerDetallesDeVenta,
  obtenerClientes,
  anularVenta,
  actualizarVenta,
  mensajeError,
  Producto,
  Cliente,
  MovimientoInventario,
  VentaRow,
  DetalleVenta
} from '../database/db';

type Pestaña = 'movimientos' | 'ventas';

type ItemEdicionVenta = {
  id: number;
  producto_id: number;
  producto_nombre: string;
  cantidad_nueva: number;
  cantidad_anterior: number;
  precio_unitario: number;
};

export default function Inventario() {
  const [pestaña, setPestaña] = useState<Pestaña>('movimientos');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [importarFactura, setImportarFactura] = useState(false);

  // Datos
  const [movimientos, setMovimientos] = useState<MovimientoInventario[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [stats, setStats] = useState({ entradasMes: 0, salidasMes: 0 });
  const [ventas, setVentas] = useState<VentaRow[]>([]);

  // Búsqueda en movimientos
  const [busquedaProducto, setBusquedaProducto] = useState('');
  const [productoSeleccionado, setProductoSeleccionado] = useState<Producto | null>(null);

  // Búsqueda en ventas
  const [busquedaVenta, setBusquedaVenta] = useState('');

  // Clientes (para editar venta)
  const [clientes, setClientes] = useState<Cliente[]>([]);

  // Modal detalle venta
  const [ventaSeleccionada, setVentaSeleccionada] = useState<VentaRow | null>(null);
  const [detallesVenta, setDetallesVenta] = useState<DetalleVenta[]>([]);
  const [pdfDatos, setPdfDatos] = useState<DatosFactura | null>(null); // datos en espera de elegir formato PDF

  // Modal editar venta
  const [mostrarModalEditar, setMostrarModalEditar] = useState(false);
  const [editDescuento, setEditDescuento] = useState(0);
  const [editCliente, setEditCliente] = useState<Cliente | null>(null);
  const [editItems, setEditItems] = useState<ItemEdicionVenta[]>([]);
  const [editBusqueda, setEditBusqueda] = useState('');

  // Formulario movimiento
  const [formData, setFormData] = useState({ tipo: 'entrada', cantidad: '', motivo: '' });

  useEffect(() => {
    cargarDatos();
  }, []);

  const cargarDatos = async () => {
    try {
      const [movs, prods, estadisticas, todasVentas, clis] = await Promise.all([
        obtenerMovimientos(),
        obtenerProductos(),
        obtenerEstadisticasInventario(),
        obtenerTodasLasVentas(),
        obtenerClientes(),
      ]);
      setMovimientos(movs);
      setProductos(prods);
      setStats(estadisticas);
      setVentas(todasVentas);
      setClientes(clis);
    } catch (error) {
      console.error("Error al cargar datos de inventario:", error);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleBusquedaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setBusquedaProducto(query);
    const exactMatch = productos.find(p => p.codigo_barras === query);
    if (exactMatch) seleccionarProducto(exactMatch);
  };

  const seleccionarProducto = (prod: Producto | null) => {
    setProductoSeleccionado(prod);
    setBusquedaProducto('');
  };

  const handleGuardarMovimiento = async () => {
    if (!productoSeleccionado) {
      mostrarAlerta("Por favor seleccione un producto.", 'advertencia');
      return;
    }
    const cantidad = Number(formData.cantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      mostrarAlerta("La cantidad debe ser un número entero mayor a 0.", 'advertencia');
      return;
    }
    try {
      await registrarMovimiento(
        productoSeleccionado.id!,
        formData.tipo,
        cantidad,
        formData.motivo.trim() || (formData.tipo === 'entrada' ? 'Ingreso de mercancía' : 'Ajuste / Merma')
      );
      setFormData({ tipo: 'entrada', cantidad: '', motivo: '' });
      setProductoSeleccionado(null);
      setIsModalOpen(false);
      await cargarDatos();
    } catch (error) {
      console.error("Error al guardar movimiento:", error);
      mostrarAlerta(mensajeError(error, "Ocurrió un error al registrar el movimiento."), 'error');
    }
  };

  const verDetalleVenta = async (venta: VentaRow) => {
    setVentaSeleccionada(venta);
    const detalles = await obtenerDetallesDeVenta(venta.id);
    setDetallesVenta(detalles);
  };

  const abrirEditarVenta = () => {
    if (!ventaSeleccionada) return;
    setEditDescuento(ventaSeleccionada.descuento ?? 0);
    setEditCliente(clientes.find(c => c.id === ventaSeleccionada.cliente_id) ?? null);
    setEditItems(detallesVenta.map(d => ({ ...d, cantidad_nueva: d.cantidad, cantidad_anterior: d.cantidad })));
    setMostrarModalEditar(true);
  };

  const handleGuardarEdicion = async () => {
    if (!ventaSeleccionada) return;
    try {
      await actualizarVenta(
        ventaSeleccionada.id,
        editCliente?.id ?? null,
        editDescuento,
        editItems.map(i => ({
          id: i.id,
          producto_id: i.producto_id,
          cantidad_nueva: i.cantidad_nueva,
          cantidad_anterior: i.cantidad_anterior,
          precio_unitario: i.precio_unitario,
        }))
      );
      await cargarDatos();
      const detalles = await obtenerDetallesDeVenta(ventaSeleccionada.id);
      setDetallesVenta(detalles);
      // Refrescar ventaSeleccionada con el total recalculado
      const ventasActualizadas = await obtenerTodasLasVentas();
      setVentas(ventasActualizadas);
      const actualizada = ventasActualizadas.find((v: VentaRow) => v.id === ventaSeleccionada.id);
      if (actualizada) setVentaSeleccionada(actualizada);
      setMostrarModalEditar(false);
    } catch (error) {
      console.error("Error al actualizar venta:", error);
      mostrarAlerta(mensajeError(error, "No se pudo actualizar la venta."), 'error');
    }
  };

  const handleAnularVenta = async () => {
    if (!ventaSeleccionada) return;
    if (!confirm(`¿Confirma anular la venta INV-${ventaSeleccionada.id.toString().padStart(6, '0')}? Se restaurará el stock.`)) return;
    try {
      await anularVenta(ventaSeleccionada.id);
      setVentaSeleccionada(null);
      setDetallesVenta([]);
      await cargarDatos();
    } catch (error) {
      console.error("Error al anular venta:", error);
      mostrarAlerta(mensajeError(error, "No se pudo anular la venta."), 'error');
    }
  };

  const getDatosFactura = (): DatosFactura | null => {
    if (!ventaSeleccionada) return null;
    const clienteRef = clientes.find(c => c.id === ventaSeleccionada.cliente_id);
    const subtotal = ventaSeleccionada.total + (ventaSeleccionada.descuento ?? 0);
    return {
      folio: `INV-${ventaSeleccionada.id.toString().padStart(6, '0')}`,
      fecha: formatearFecha(ventaSeleccionada.fecha),
      cliente: clienteRef?.nombre || ventaSeleccionada.cliente_nombre || 'Consumidor Final',
      clienteDoc: clienteRef?.documento,
      items: detallesVenta.map((d: DetalleVenta) => ({
        nombre: d.producto_nombre, precio: d.precio_unitario,
        cantidad: d.cantidad, subtotal: d.subtotal,
      })),
      subtotal,
      descuento: ventaSeleccionada.descuento ?? 0,
      total: ventaSeleccionada.total,
    };
  };

  // Imprimir → tirilla térmica 80mm por ESC/POS nativo (3nStar RPT005)
  const imprimirFactura = () => {
    const datos = getDatosFactura();
    if (datos) imprimirTicketTermico(datos);
  };

  // Guardar PDF → abre selector de formato (tirilla 80mm o factura electrónica)
  const abrirSelectorPDF = () => {
    const datos = getDatosFactura();
    if (datos) setPdfDatos(datos);
  };

  const formatearFecha = (fechaSql: string) => {
    if (!fechaSql) return '---';
    return new Date(fechaSql.replace(' ', 'T')).toLocaleString('es-CO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  };

  const productosSugeridos = busquedaProducto.trim()
    ? productos.filter(p =>
        p.nombre.toLowerCase().includes(busquedaProducto.toLowerCase()) ||
        p.codigo_barras.includes(busquedaProducto)
      )
    : [];

  const ventasFiltradas = busquedaVenta.trim()
    ? ventas.filter(v =>
        `INV-${v.id.toString().padStart(6, '0')}`.includes(busquedaVenta) ||
        (v.cliente_nombre ?? '').toLowerCase().includes(busquedaVenta.toLowerCase())
      )
    : ventas;

  return (
    <div className="p-8 flex-1 flex flex-col overflow-hidden relative pos-fade-in">

      {/* Cabecera */}
      <div className="flex justify-between items-center mb-6 shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Control de Inventario</h2>
          <p className="text-sm text-slate-500">Movimientos de stock e historial de ventas</p>
        </div>
        <div className="flex gap-3">
        <button onClick={() => setImportarFactura(true)} className="border border-slate-300 bg-white px-4 py-2 rounded-xl text-sm font-semibold">Importar factura con IA</button>
        <button
          onClick={() => { setProductoSeleccionado(null); setBusquedaProducto(''); setIsModalOpen(true); }}
          className="flex items-center gap-2 bg-pos-primary text-white font-bold px-5 py-2.5 rounded-xl hover:bg-pos-primary-dark transition shadow-md"
        >
          <Plus className="w-5 h-5" /> Registrar Movimiento
        </button>
        </div>
      </div>
      {importarFactura && <ImportarFactura onClose={() => setImportarFactura(false)} onImportado={cargarDatos} />}

      {/* Pestañas */}
      <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-xl w-fit shrink-0">
        <button
          onClick={() => setPestaña('movimientos')}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition ${pestaña === 'movimientos' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <History className="w-4 h-4" /> Movimientos
        </button>
        <button
          onClick={() => setPestaña('ventas')}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition ${pestaña === 'ventas' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <ShoppingBag className="w-4 h-4" /> Ventas
          <span className="bg-slate-200 text-slate-600 text-xs px-1.5 py-0.5 rounded-md font-bold">{ventas.length}</span>
        </button>
      </div>

      {/* ── PESTAÑA MOVIMIENTOS ── */}
      {pestaña === 'movimientos' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 shrink-0">
            <div className="bg-white border border-slate-200 p-4 rounded-xl flex items-center gap-4 shadow-sm">
              <div className="p-3 bg-green-50 text-green-600 rounded-lg"><ArrowUpRight className="w-6 h-6"/></div>
              <div>
                <p className="text-sm text-slate-500 font-medium">Entradas (Mes Actual)</p>
                <p className="text-xl font-bold text-slate-800">+{stats.entradasMes} unidades</p>
              </div>
            </div>
            <div className="bg-white border border-slate-200 p-4 rounded-xl flex items-center gap-4 shadow-sm">
              <div className="p-3 bg-red-50 text-red-600 rounded-lg"><ArrowDownLeft className="w-6 h-6"/></div>
              <div>
                <p className="text-sm text-slate-500 font-medium">Salidas (Mes Actual)</p>
                <p className="text-xl font-bold text-slate-800">-{stats.salidasMes} unidades</p>
              </div>
            </div>
          </div>

          <div className="mb-4 shrink-0 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              value={busquedaProducto}
              onChange={handleBusquedaChange}
              placeholder="Buscar por producto o código..."
              className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-pos-primary focus:border-pos-primary transition-all text-sm"
            />
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center gap-2 shrink-0 bg-slate-50/50">
              <History className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Historial de Auditoría</h3>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-600 sticky top-0 border-b border-slate-200 z-10">
                  <tr>
                    <th className="p-4 font-semibold">Fecha y Hora</th>
                    <th className="p-4 font-semibold">Producto</th>
                    <th className="p-4 font-semibold">Tipo</th>
                    <th className="p-4 font-semibold text-center">Cantidad</th>
                    <th className="p-4 font-semibold">Motivo / Concepto</th>
                    <th className="p-4 font-semibold">Usuario</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700 divide-y divide-slate-100">
                  {movimientos.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-slate-500">No hay movimientos registrados.</td></tr>
                  ) : (
                    movimientos.map(mov => (
                      <tr key={mov.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 text-slate-500 font-mono">{formatearFecha(mov.fecha)}</td>
                        <td className="p-4 font-medium">{mov.producto_nombre}</td>
                        <td className="p-4">
                          {mov.tipo === 'entrada' ? (
                            <span className="bg-green-100 text-green-700 px-2.5 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1">
                              <ArrowUpRight className="w-3 h-3"/> Entrada
                            </span>
                          ) : (
                            <span className="bg-red-100 text-red-700 px-2.5 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1">
                              <ArrowDownLeft className="w-3 h-3"/> Salida
                            </span>
                          )}
                        </td>
                        <td className={`p-4 text-center font-bold ${mov.tipo === 'entrada' ? 'text-green-600' : 'text-red-600'}`}>
                          {mov.tipo === 'entrada' ? '+' : '-'}{mov.cantidad}
                        </td>
                        <td className="p-4 text-slate-600">{mov.motivo}</td>
                        <td className="p-4 text-slate-500">{mov.usuario}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── PESTAÑA VENTAS ── */}
      {pestaña === 'ventas' && (
        <>
          <div className="mb-4 shrink-0 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              value={busquedaVenta}
              onChange={e => setBusquedaVenta(e.target.value)}
              placeholder="Buscar por folio (INV-000001) o nombre de cliente..."
              className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-pos-primary focus:border-pos-primary transition-all text-sm"
            />
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center gap-2 shrink-0 bg-slate-50/50">
              <ShoppingBag className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Historial de Ventas</h3>
              <span className="ml-auto text-xs text-slate-400">{ventasFiltradas.length} resultado{ventasFiltradas.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-600 sticky top-0 border-b border-slate-200 z-10">
                  <tr>
                    <th className="p-4 font-semibold">Folio</th>
                    <th className="p-4 font-semibold">Fecha y Hora</th>
                    <th className="p-4 font-semibold">Cliente</th>
                    <th className="p-4 font-semibold text-right">Descuento</th>
                    <th className="p-4 font-semibold text-right">Total</th>
                    <th className="p-4 font-semibold text-center">Detalle</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700 divide-y divide-slate-100">
                  {ventasFiltradas.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-slate-500">No hay ventas registradas.</td></tr>
                  ) : (
                    ventasFiltradas.map(venta => (
                      <tr key={venta.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 font-mono font-bold text-slate-700">
                          INV-{venta.id.toString().padStart(6, '0')}
                        </td>
                        <td className="p-4 text-slate-500 font-mono">{formatearFecha(venta.fecha)}</td>
                        <td className="p-4 text-slate-600">{venta.cliente_nombre || 'Consumidor Final'}</td>
                        <td className="p-4 text-right text-pos-primary font-medium">
                          {venta.descuento > 0 ? `-$${venta.descuento.toFixed(2)}` : '—'}
                        </td>
                        <td className="p-4 text-right font-bold text-slate-800">${venta.total.toFixed(2)}</td>
                        <td className="p-4 text-center">
                          <button
                            onClick={() => verDetalleVenta(venta)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition"
                          >
                            <FileText className="w-3.5 h-3.5"/> Ver
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── MODAL: REGISTRAR MOVIMIENTO ── */}
      {isModalOpen && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 pos-overlay-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl flex flex-col max-h-full pos-modal-panel">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h3 className="text-xl font-bold text-slate-800">Registrar Movimiento de Stock</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-visible space-y-5">
              <div className="relative">
                <label className="block text-xs font-medium text-slate-500 mb-1">Buscar Producto o Escanear</label>
                {productoSeleccionado ? (
                  <div className="flex items-center justify-between bg-pos-primary/5 border border-pos-primary/30 rounded-lg p-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-white rounded shadow-sm text-pos-primary"><Package className="w-5 h-5" /></div>
                      <div>
                        <p className="font-bold text-slate-800 text-sm leading-tight">{productoSeleccionado.nombre}</p>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">Cód: {productoSeleccionado.codigo_barras} • Stock: <span className="font-bold text-slate-700">{productoSeleccionado.stock}</span></p>
                      </div>
                    </div>
                    <button onClick={() => seleccionarProducto(null)} className="text-slate-400 hover:text-red-500 p-1 transition">
                      <X className="w-5 h-5"/>
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      value={busquedaProducto}
                      onChange={handleBusquedaChange}
                      placeholder="Escanee el código o teclee el nombre..."
                      className="w-full border border-slate-300 rounded-lg p-3 pl-10 text-sm outline-none focus:border-pos-primary focus:ring-1 focus:ring-pos-primary"
                      autoFocus
                    />
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                    {busquedaProducto && (
                      <ul className="absolute z-50 w-full mt-1 bg-white border border-slate-200 shadow-xl rounded-lg max-h-48 overflow-auto">
                        {productosSugeridos.length > 0 ? (
                          productosSugeridos.map(p => (
                            <li key={p.id} onClick={() => seleccionarProducto(p)} className="px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0 transition">
                              <div className="font-medium text-sm text-slate-700">{p.nombre}</div>
                              <div className="text-xs text-slate-400 font-mono mt-0.5">Cód: {p.codigo_barras} | Stock actual: {p.stock}</div>
                            </li>
                          ))
                        ) : (
                          <li className="px-4 py-4 text-sm text-slate-500 text-center">No se encontraron coincidencias</li>
                        )}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Tipo de Movimiento</label>
                  <select name="tipo" value={formData.tipo} onChange={handleInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary bg-white">
                    <option value="entrada">+) Entrada (Aumentar stock)</option>
                    <option value="salida">-) Salida (Disminuir stock)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Cantidad de unidades</label>
                  <input type="number" name="cantidad" value={formData.cantidad} onChange={handleInputChange} min="1" step="1" placeholder="Ej. 10" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary focus:ring-1 focus:ring-pos-primary" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Motivo / Concepto del movimiento</label>
                <input type="text" name="motivo" value={formData.motivo} onChange={handleInputChange} placeholder="Ej. Compra a distribuidor, Producto roto, etc." className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary focus:ring-1 focus:ring-pos-primary" />
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl shrink-0">
              <button onClick={() => setIsModalOpen(false)} className="px-6 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-100 transition">Cancelar</button>
              <button onClick={handleGuardarMovimiento} disabled={!productoSeleccionado} className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-pos-primary text-white font-bold hover:bg-pos-primary-dark transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
                <Save className="w-4 h-4"/> Guardar Movimiento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: DETALLE DE VENTA ── */}
      {ventaSeleccionada && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 pos-overlay-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl flex flex-col max-h-full pos-modal-panel">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <div className="bg-slate-100 p-2 rounded text-slate-600"><FileText className="w-5 h-5"/></div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">INV-{ventaSeleccionada.id.toString().padStart(6, '0')}</h3>
                  <p className="text-xs text-slate-500">{formatearFecha(ventaSeleccionada.fecha)}</p>
                </div>
              </div>
              <button onClick={() => setVentaSeleccionada(null)} className="text-slate-400 hover:bg-slate-100 p-2 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-auto bg-slate-50/50">
              <p className="text-sm text-slate-500 mb-4">
                Cliente: <span className="font-semibold text-slate-700">{ventaSeleccionada.cliente_nombre || 'Consumidor Final'}</span>
              </p>
              <table className="w-full text-left text-sm">
                <thead className="text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="pb-2 font-medium">Cant.</th>
                    <th className="pb-2 font-medium">Producto</th>
                    <th className="pb-2 font-medium text-right">P. Unit</th>
                    <th className="pb-2 font-medium text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700 divide-y divide-slate-100">
                  {detallesVenta.map((prod: DetalleVenta, idx: number) => (
                    <tr key={idx}>
                      <td className="py-3 text-slate-500 font-medium">{prod.cantidad}x</td>
                      <td className="py-3">{prod.producto_nombre}</td>
                      <td className="py-3 text-right text-slate-500">${prod.precio_unitario.toFixed(2)}</td>
                      <td className="py-3 text-right font-medium">${prod.subtotal.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 pt-4 border-t border-slate-200 space-y-1 text-right">
                <div className="text-sm text-slate-500">
                  Descuento: <span className="font-medium text-slate-700">-${ventaSeleccionada.descuento.toFixed(2)}</span>
                </div>
                <div className="flex justify-end items-center gap-4 mt-2">
                  <span className="font-bold text-slate-600 uppercase">Total Cobrado</span>
                  <span className="text-2xl font-bold text-pos-primary-dark">${ventaSeleccionada.total.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 bg-white rounded-b-2xl shrink-0 flex flex-wrap gap-2">
              <button onClick={() => setVentaSeleccionada(null)} className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 text-sm">Cerrar</button>
              <button onClick={imprimirFactura} className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-300 text-slate-600 font-semibold hover:bg-slate-50 transition text-sm">
                <Printer className="w-4 h-4"/> Imprimir
              </button>
              <button onClick={abrirSelectorPDF} className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-pos-primary text-pos-primary font-semibold hover:bg-green-50 transition text-sm">
                <Download className="w-4 h-4"/> PDF
              </button>
              <button onClick={abrirEditarVenta} className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-blue-300 text-blue-600 font-semibold hover:bg-blue-50 transition text-sm">
                <Edit className="w-4 h-4"/> Editar
              </button>
              <button onClick={handleAnularVenta} className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600 transition text-sm">
                <AlertTriangle className="w-4 h-4"/> Anular
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: EDITAR VENTA ── */}
      {mostrarModalEditar && ventaSeleccionada && (
        <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4 pos-overlay-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh] pos-modal-panel">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h3 className="text-lg font-bold text-slate-800">
                Editar INV-{ventaSeleccionada.id.toString().padStart(6, '0')}
              </h3>
              <button onClick={() => setMostrarModalEditar(false)}>
                <X className="w-5 h-5 text-slate-400 hover:text-slate-700" />
              </button>
            </div>

            <div className="p-5 space-y-5 overflow-auto flex-1">
              {/* Buscador de productos para agregar */}
              <div className="relative">
                <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">Agregar Producto</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar producto por nombre o código para agregar..."
                    value={editBusqueda}
                    onChange={e => setEditBusqueda(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-pos-primary bg-slate-50"
                  />
                </div>
                {editBusqueda.trim() !== '' && (
                  <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-48 overflow-auto divide-y divide-slate-100">
                    {productos
                      .filter(p => p.nombre.toLowerCase().includes(editBusqueda.toLowerCase()) || p.codigo_barras.includes(editBusqueda))
                      .slice(0, 5)
                      .map(prod => (
                        <button
                          key={prod.id}
                          type="button"
                          onClick={() => {
                            setEditItems(prev => {
                              const existente = prev.find(it => it.producto_id === prod.id);
                              if (existente) {
                                return prev.map(it => it.producto_id === prod.id ? { ...it, cantidad_nueva: it.cantidad_nueva + 1 } : it);
                              } else {
                                return [...prev, {
                                  id: -Date.now(),
                                  producto_id: prod.id!,
                                  producto_nombre: prod.nombre,
                                  cantidad_nueva: 1,
                                  cantidad_anterior: 0,
                                  precio_unitario: prod.precio_venta,
                                }];
                              }
                            });
                            setEditBusqueda('');
                          }}
                          className="w-full text-left p-3 hover:bg-slate-50 text-sm flex justify-between items-center"
                        >
                          <div>
                            <span className="font-medium text-slate-700">{prod.nombre}</span>
                            <span className="text-xs text-slate-400 ml-2 font-mono">{prod.codigo_barras}</span>
                          </div>
                          <span className="font-bold text-slate-800">${prod.precio_venta.toFixed(2)}</span>
                        </button>
                      ))
                    }
                    {productos.filter(p => p.nombre.toLowerCase().includes(editBusqueda.toLowerCase()) || p.codigo_barras.includes(editBusqueda)).length === 0 && (
                      <div className="p-3 text-center text-slate-400 text-xs">No se encontraron productos.</div>
                    )}
                  </div>
                )}
              </div>

              {/* Productos */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">Productos</label>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="p-3 text-left font-medium">Producto</th>
                        <th className="p-3 text-center font-medium">Cantidad</th>
                        <th className="p-3 text-right font-medium">Subtotal</th>
                        <th className="p-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {editItems.filter(i => i.cantidad_nueva > 0).map((item, idx) => (
                        <tr key={idx}>
                          <td className="p-3 font-medium text-slate-700">
                            <div>{item.producto_nombre}</div>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center justify-center gap-2 bg-slate-100 rounded-lg px-2 py-1 w-max mx-auto">
                              <button onClick={() => setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, cantidad_nueva: Math.max(0, it.cantidad_nueva - 1) } : it))} className="text-slate-400 hover:text-slate-700 font-bold w-4">−</button>
                              <span className="w-8 text-center font-bold">{item.cantidad_nueva}</span>
                              <button onClick={() => setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, cantidad_nueva: it.cantidad_nueva + 1 } : it))} className="text-slate-400 hover:text-slate-700 font-bold w-4">+</button>
                            </div>
                          </td>
                          <td className="p-3 text-right font-medium text-slate-800">${(item.cantidad_nueva * item.precio_unitario).toFixed(2)}</td>
                          <td className="p-3 text-center">
                            <button onClick={() => setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, cantidad_nueva: 0 } : it))} className="text-red-400 hover:text-red-600 transition">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {editItems.every(i => i.cantidad_nueva === 0) && (
                        <tr><td colSpan={4} className="p-4 text-center text-slate-400 text-sm">No quedan productos.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cliente */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">Cliente</label>
                <select
                  value={editCliente?.id ?? ''}
                  onChange={e => setEditCliente(clientes.find(c => c.id === Number(e.target.value)) ?? null)}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary"
                >
                  <option value="">Consumidor Final</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>

              {/* Descuento */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">Descuento ($)</label>
                <input
                  type="number" min={0} value={editDescuento}
                  onChange={e => setEditDescuento(Number(e.target.value))}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary"
                />
              </div>

              {/* Nuevo total */}
              <div className="bg-slate-50 rounded-xl p-4 flex justify-between items-center">
                <span className="text-slate-500 font-medium">Nuevo total estimado:</span>
                <span className="text-xl font-bold text-pos-primary-dark">
                  ${Math.max(0, editItems.reduce((s, i) => s + i.cantidad_nueva * i.precio_unitario, 0) - editDescuento).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="p-5 border-t border-slate-100 flex gap-3 shrink-0">
              <button onClick={() => setMostrarModalEditar(false)} className="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-50">Cancelar</button>
              <button onClick={handleGuardarEdicion} className="flex-[2] py-2.5 rounded-xl bg-pos-primary text-white font-bold hover:bg-pos-primary-dark transition shadow-md">Guardar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {/* ── SELECTOR DE FORMATO PARA PDF ── */}
      {pdfDatos && (
        <SelectorFormatoFactura
          onClose={() => setPdfDatos(null)}
          onSelect={(formato: FormatoFactura) => {
            descargarPDFFactura(pdfDatos, formato);
            setPdfDatos(null);
          }}
        />
      )}
    </div>
  );
}
