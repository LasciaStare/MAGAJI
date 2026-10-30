import { useState, useEffect, useCallback, useRef } from 'react';
import { descargarPDFFactura, DatosFactura, FormatoFactura } from '../utils/factura';
import { imprimirTicketTermico } from '../utils/escpos';
import SelectorFormatoFactura from '../components/SelectorFormatoFactura';
import { mostrarAlerta } from '../utils/alertGlobal';
import { cargarEsquema, TipoEsquema } from './Clientes';
import {
    ShoppingCart, Search, QrCode, Trash2, User, Tag, CreditCard,
    Clock, Package, CheckCircle, Printer, Download, X, FileText, PlusCircle, Edit, AlertTriangle, UserPlus
} from 'lucide-react';
import {
    buscarProductoPorCodigo, obtenerProductos, obtenerClientes,
    registrarVenta, obtenerUltimasVentas, obtenerDetallesDeVenta,
    anularVenta, actualizarVenta, crearCliente, mensajeError,
    Producto, Cliente
} from '../database/db';

interface ArticuloCarrito {
    producto: Producto;
    cantidad: number;
    subtotal: number;
}

interface VentasProps {
  carrito: ArticuloCarrito[];
  setCarrito: React.Dispatch<React.SetStateAction<ArticuloCarrito[]>>;
  descuento: number;
  setDescuento: React.Dispatch<React.SetStateAction<number>>;
  clienteSeleccionado: Cliente | null;
  setClienteSeleccionado: React.Dispatch<React.SetStateAction<Cliente | null>>;
}

export default function Ventas({ carrito, setCarrito, descuento, setDescuento, clienteSeleccionado, setClienteSeleccionado }: VentasProps) {
  // Tipos locales para cumplir strict mode
  interface Venta {
    id: number;
    fecha: string;
    total: number;
    descuento: number;
    cliente_id: number | null;
    cliente_nombre?: string | null;
  }
  interface VentaDetalle {
    id: number;
    venta_id: number;
    producto_id: number;
    cantidad: number;
    precio_unitario: number;
    subtotal: number;
    producto_nombre?: string;
  }
  interface VentaCompletada {
    cliente: Cliente | null;
    items: ArticuloCarrito[];
    subtotal: number;
    descuento: number;
    total: number;
    fecha: string;
    comentario?: string;
  }
  interface EditItem extends VentaDetalle {
    cantidad_nueva: number;
    cantidad_anterior: number;
    producto_nombre?: string;
  }

  // --- ESTADOS DE DATOS GLOBALES ---
  const [productosLista, setProductosLista] = useState<Producto[]>([]);
  const [clientesLista, setClientesLista] = useState<Cliente[]>([]);
  const [ultimasVentas, setUltimasVentas] = useState<Venta[]>([]);

  // --- ESTADOS DEL CARRITO Y BÚSQUEDA ---
  const [busqueda, setBusqueda] = useState('');
  const [cantidadIngreso, setCantidadIngreso] = useState(1);
  const [indiceSugerido, setIndiceSugerido] = useState(-1);
  const [ultimoProductoEscaneado, setUltimoProductoEscaneado] = useState<Producto | null>(null);

  // --- ESTADOS DE LOS MODALES ---
  const [comentario, setComentario] = useState('');
  const [mostrarModalCobro, setMostrarModalCobro] = useState(false);
  const [mostrarModalDescuento, setMostrarModalDescuento] = useState(false);
  const [mostrarModalCliente, setMostrarModalCliente] = useState(false);
  const [busquedaCliente, setBusquedaCliente] = useState('');
  const [mostrarFormNuevoCliente, setMostrarFormNuevoCliente] = useState(false);
  const [nuevoClienteForm, setNuevoClienteForm] = useState({ nombre: '', documento: '' });
  const [ventaSeleccionada, setVentaSeleccionada] = useState<Venta | null>(null); // Para el detalle de ventas antiguas
  const [detallesVentaAntigua, setDetallesVentaAntigua] = useState<VentaDetalle[]>([]);
  const [ventaCompletada, setVentaCompletada] = useState<VentaCompletada | null>(null); // Datos de la venta completada para imprimir
  const [mostrarModalEditarVenta, setMostrarModalEditarVenta] = useState(false);
  const [pdfDatos, setPdfDatos] = useState<DatosFactura | null>(null); // datos en espera de elegir formato PDF
  const [editDescuento, setEditDescuento] = useState<number>(0);
  const [editCliente, setEditCliente] = useState<Cliente | null>(null);
  const [editItems, setEditItems] = useState<EditItem[]>([]); // copia editable de detallesVentaAntigua
  const [editBusqueda, setEditBusqueda] = useState('');

  // refs para el escáner y prevención de duplicados
  const scanBufferRef = useRef('');
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cantidadIngresoRef = useRef(1);
  const busquedaInputRef = useRef<HTMLInputElement>(null);
  const carritoRef = useRef(carrito); // espejo síncrono del carrito para validar stock desde el escáner
  const lastScannedCodeRef = useRef<string | null>(null);
  const lastScanTimeRef = useRef<number>(0);

  useEffect(() => {
      cargarDatosIniciales();
  }, []);

  const cargarDatosIniciales = async () => {
      try {
          const prods = await obtenerProductos();
          const clis = await obtenerClientes();
          const ventas = await obtenerUltimasVentas();
          setProductosLista(prods);
          setClientesLista(clis);
          setUltimasVentas(ventas as Venta[]);
      } catch (error) {
          console.error("Error al cargar datos base:", error);
      }
  };

  // --- LÓGICA DE BÚSQUEDA Y CARRITO ---

  useEffect(() => { cantidadIngresoRef.current = cantidadIngreso; }, [cantidadIngreso]);
  useEffect(() => { carritoRef.current = carrito; }, [carrito]);

  // Agrega un producto al carrito (sea desde el escáner o el botón +)
  // useCallback + setCarrito funcional evita stale closures desde el listener global
  const procesarIngresoAlCarrito = useCallback((producto: Producto, cantidad: number = 1) => {
      // Guard de stock: no permitir que lo acumulado en el carrito supere el disponible
      const yaEnCarrito = carritoRef.current
          .filter(i => i.producto.id === producto.id)
          .reduce((s, i) => s + i.cantidad, 0);
      if (yaEnCarrito + cantidad > producto.stock) {
          mostrarAlerta(
              producto.stock <= 0
                  ? `"${producto.nombre}" no tiene stock disponible.`
                  : `Stock insuficiente de "${producto.nombre}": disponibles ${producto.stock}` +
                    (yaEnCarrito > 0 ? `, ya tienes ${yaEnCarrito} en el carrito.` : '.'),
              'advertencia'
          );
          setBusqueda('');
          return;
      }

      setUltimoProductoEscaneado(producto);
      setCarrito(prev => {
          const existeItem = prev.find(item => item.producto.id === producto.id);
          if (existeItem) {
              const nuevaCantidad = existeItem.cantidad + cantidad;
              return prev.map(item =>
                  item.producto.id === producto.id
                  ? { ...item, cantidad: nuevaCantidad, subtotal: nuevaCantidad * item.producto.precio_venta }
                  : item
              );
          }
          return [...prev, { producto, cantidad, subtotal: cantidad * producto.precio_venta }];
      });
      setBusqueda('');
      setCantidadIngreso(1);
      cantidadIngresoRef.current = 1;
      busquedaInputRef.current?.focus();
  }, []);

  // Listener global: captura el lector cuando el foco NO está en ningún input
  useEffect(() => {
      const onKeyDown = async (e: KeyboardEvent) => {
          const tag = (e.target as HTMLElement).tagName.toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

          if (e.key === 'Enter') {
              const codigo = scanBufferRef.current.trim();
              scanBufferRef.current = '';
              if (scanTimerRef.current) { clearTimeout(scanTimerRef.current); scanTimerRef.current = null; }

              // Validar longitud mínima y prevenir duplicados en corto tiempo
              if (codigo.length >= 4) {
                  const ahora = Date.now();
                  if (lastScannedCodeRef.current === codigo && (ahora - lastScanTimeRef.current) < 1000) {
                      // Ignorar rebotes/duplicados rápidos
                      return;
                  }
                  lastScannedCodeRef.current = codigo;
                  lastScanTimeRef.current = ahora;

                  const producto = await buscarProductoPorCodigo(codigo);
                  if (producto) procesarIngresoAlCarrito(producto, cantidadIngresoRef.current);
              }
              return;
          }

          if (e.key.length === 1) {
              scanBufferRef.current += e.key;
              if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
              // Limpia el buffer si no llega Enter en 300 ms (evita caracteres huérfanos)
              scanTimerRef.current = setTimeout(() => { scanBufferRef.current = ''; }, 300);
          }
      };

      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
  }, [procesarIngresoAlCarrito]);

  // Maneja cuando escribes en la barra de búsqueda
  const handleBusquedaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const valor = e.target.value;
      // Comando inline: CANTIDAD* → ej. "12*" extrae cantidad y limpia el campo
      if (valor.includes('*')) {
          const partes = valor.split('*');
          const posibleCantidad = parseInt(partes[0], 10);
          if (!isNaN(posibleCantidad) && posibleCantidad > 0) {
              setCantidadIngreso(posibleCantidad);
              cantidadIngresoRef.current = posibleCantidad;
              setBusqueda(partes.slice(1).join('*'));
              setIndiceSugerido(-1);
              return;
          }
      }
      setBusqueda(valor);
      setIndiceSugerido(-1);
  };

  // Maneja teclado: Enter (escáner), flechas (navegación lista)
  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
          e.preventDefault();
          setIndiceSugerido(i => Math.min(i + 1, productosSugeridos.length - 1));
          return;
      }
      if (e.key === 'ArrowUp') {
          e.preventDefault();
          setIndiceSugerido(i => Math.max(i - 1, 0));
          return;
      }
      if (e.key === 'Escape') {
          setBusqueda('');
          setIndiceSugerido(-1);
          return;
      }
      if (e.key === 'Enter' && busqueda.trim() !== '') {
          let cantidadParaAgregar = cantidadIngreso;
          let terminoBusqueda = busqueda.trim();

          // Comando inline desde teclado: CANTIDAD*término (ej. "12*Coca")
          if (terminoBusqueda.includes('*')) {
              const partes = terminoBusqueda.split('*');
              const posibleCantidad = parseInt(partes[0], 10);
              if (!isNaN(posibleCantidad) && posibleCantidad > 0) {
                  cantidadParaAgregar = posibleCantidad;
                  terminoBusqueda = partes.slice(1).join('*').trim();
              }
          }

          // Si solo se escribió la cantidad sin producto aún (ej. "12*")
          if (!terminoBusqueda) {
              setCantidadIngreso(cantidadParaAgregar);
              cantidadIngresoRef.current = cantidadParaAgregar;
              setBusqueda('');
              return;
          }

          // Si hay un item resaltado en la lista, seleccionarlo con la cantidad
          if (indiceSugerido >= 0 && productosSugeridos[indiceSugerido]) {
              procesarIngresoAlCarrito(productosSugeridos[indiceSugerido], cantidadParaAgregar);
              setIndiceSugerido(-1);
              return;
          }
          // Si no, buscar por código de barras exacto (lector)
          const productoEncontrado = await buscarProductoPorCodigo(terminoBusqueda);
          if (productoEncontrado) {
              procesarIngresoAlCarrito(productoEncontrado, cantidadParaAgregar);
          } else {
              mostrarAlerta(`No se encontró producto con el código: ${terminoBusqueda}`, 'info');
              setBusqueda('');
          }
      }
  };

  // Seleccionar producto desde la lista desplegable (Solo lo muestra, no lo agrega aún)
  const seleccionarProductoParaVer = (prod: Producto) => {
      setUltimoProductoEscaneado(prod);
      setBusqueda('');
  };

  const handleModificarCantidad = (index: number, cambio: number) => {
      const nuevoCarrito = [...carrito];
      const item = nuevoCarrito[index];
      const nuevaCantidad = item.cantidad + cambio;

      if (nuevaCantidad <= 0) return;

      // No permitir superar el stock disponible al aumentar (suma de líneas del mismo producto)
      if (cambio > 0) {
          const otrasLineas = carrito
              .filter((it, i) => it.producto.id === item.producto.id && i !== index)
              .reduce((s, it) => s + it.cantidad, 0);
          if (otrasLineas + nuevaCantidad > item.producto.stock) {
              mostrarAlerta(`Stock insuficiente de "${item.producto.nombre}": solo hay ${item.producto.stock} disponibles.`, 'advertencia');
              return;
          }
      }

      item.cantidad = nuevaCantidad;
      item.subtotal = item.cantidad * item.producto.precio_venta;
      setCarrito(nuevoCarrito);
  };

  const handleEliminarItem = (index: number) => {
      setCarrito(carrito.filter((_, i) => i !== index));
  };

  // --- MATEMÁTICAS ---
  const totalArticulos = carrito.reduce((sum, item) => sum + item.cantidad, 0);
  const subtotal = carrito.reduce((sum, item) => sum + item.subtotal, 0);
  const totalPagar = Math.max(0, subtotal - descuento); // Evita cobros negativos

  // --- LÓGICA DE FINALIZAR VENTA ---
  const handleCobrarVenta = async () => {
      if (carrito.length === 0) return;
      // Descuento saneado: nunca negativo ni mayor al subtotal
      const descuentoAplicado = Math.min(Math.max(0, descuento), subtotal);
      const totalFinal = subtotal - descuentoAplicado;
      try {
          await registrarVenta(totalFinal, descuentoAplicado, clienteSeleccionado?.id || null, carrito);
          setVentaCompletada({
              cliente: clienteSeleccionado,
              items: carrito,
              subtotal,
              descuento: descuentoAplicado,
              total: totalFinal,
              fecha: new Date().toLocaleString('es-CO'),
              comentario,
          });
          setMostrarModalCobro(true);
          // Refrescar el historial de la barra lateral y el stock en memoria
          const [ventasActualizadas, prods] = await Promise.all([
              obtenerUltimasVentas(),
              obtenerProductos(),
          ]);
          setUltimasVentas(ventasActualizadas);
          setProductosLista(prods);
      } catch (error) {
          console.error("Error al registrar la venta:", error);
          mostrarAlerta(mensajeError(error, "Hubo un error al intentar cobrar la venta."), 'error');
      }
  };

  // Valida y cierra el modal de descuento (entrada esperada como porcentaje 0-100)
  const aplicarDescuento = () => {
      const parsed = parseFloat(String(descuento));
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
          mostrarAlerta('Descuento inválido: ingrese un número entre 0 y 100 (porcentaje).', 'error');
          setDescuento(0);
          setMostrarModalDescuento(false);
          return;
      }
      // Interpretar el valor como porcentaje del subtotal
      const descuentoAplicado = Math.min(subtotal, subtotal * (parsed / 100));
      setDescuento(descuentoAplicado);
      setMostrarModalDescuento(false);
  };

  const limpiarCaja = () => {
      setCarrito([]);
      setDescuento(0);
      setClienteSeleccionado(null);
      setUltimoProductoEscaneado(null);
      setComentario('');
      setMostrarModalCobro(false);
      setVentaCompletada(null);
  };

  // --- LÓGICA DE FACTURA, IMPRESIÓN Y PDF ---
  const getDatosVentaCompletada = (): DatosFactura | null => {
      if (!ventaCompletada) return null;
      let docLabel = 'C.C/NIT';
      if (ventaCompletada.cliente) {
        let tipo = ventaCompletada.cliente.tipo || 'normal';
        if (tipo === 'normal') tipo = 'cliente';
        const esquema = cargarEsquema(tipo as TipoEsquema);
        if (esquema) {
          const campoDoc = esquema.find(c => c.nombre === 'documento');
          if (campoDoc) {
            docLabel = campoDoc.label;
          }
        }
      }
      return {
          fecha: ventaCompletada.fecha,
          cliente: ventaCompletada.cliente?.nombre || 'Consumidor Final',
          clienteDoc: ventaCompletada.cliente?.documento,
          clienteDocLabel: docLabel,
          items: ventaCompletada.items.map((i: ArticuloCarrito) => ({
              nombre: i.producto.nombre,
              precio: i.producto.precio_venta,
              cantidad: i.cantidad,
              subtotal: i.subtotal,
          })),
          subtotal: ventaCompletada.subtotal,
          descuento: ventaCompletada.descuento,
          total: ventaCompletada.total,
          comentario: ventaCompletada.comentario || undefined,
      };
  };

  const getDatosVentaHistorica = (): DatosFactura | null => {
      if (!ventaSeleccionada) return null;
      const clienteRef = clientesLista.find(c => c.id === ventaSeleccionada.cliente_id);
      const clienteNombre = clienteRef?.nombre || ventaSeleccionada.cliente_nombre || 'Consumidor Final';
      const subtotal = ventaSeleccionada.total + (ventaSeleccionada.descuento ?? 0);
      let docLabel = 'C.C/NIT';
      if (clienteRef) {
        let tipo = clienteRef.tipo || 'normal';
        if (tipo === 'normal') tipo = 'cliente';
        const esquema = cargarEsquema(tipo as TipoEsquema);
        if (esquema) {
          const campoDoc = esquema.find(c => c.nombre === 'documento');
          if (campoDoc) {
            docLabel = campoDoc.label;
          }
        }
      }
      return {
          folio: `INV-${ventaSeleccionada.id.toString().padStart(6, '0')}`,
          fecha: new Date(ventaSeleccionada.fecha.replace(' ', 'T')).toLocaleString('es-CO'),
          cliente: clienteNombre,
          clienteDoc: clienteRef?.documento,
          clienteDocLabel: docLabel,
          items: detallesVentaAntigua.map((d: VentaDetalle) => ({
              nombre: d.producto_nombre ?? 'Producto sin nombre',
              precio: d.precio_unitario,
              cantidad: d.cantidad,
              subtotal: d.subtotal,
          })),

          subtotal,
          descuento: ventaSeleccionada.descuento ?? 0,
          total: ventaSeleccionada.total,
      };
  };

  // Imprimir → tirilla térmica 80mm por ESC/POS nativo (3nStar RPT005)
  const imprimirFactura = () => {
      const datos = getDatosVentaCompletada();
      if (datos) imprimirTicketTermico(datos);
  };

  const reimprimirFacturaHistorica = () => {
      const datos = getDatosVentaHistorica();
      if (datos) imprimirTicketTermico(datos);
  };

  // Guardar PDF → abre selector de formato (tirilla 80mm o factura electrónica)
  const abrirSelectorPDF = (datos: DatosFactura | null) => {
      if (datos) setPdfDatos(datos);
  };

  // --- LÓGICA DEL HISTORIAL ---
  const verDetalleVenta = async (venta: Venta) => {
      setVentaSeleccionada(venta);
      const detalles = await obtenerDetallesDeVenta(venta.id);
      setDetallesVentaAntigua(detalles as VentaDetalle[]);
  };

  const CONSUMIDOR_FINAL: Cliente = {
      nombre: 'Consumidor Final',
      documento: '222222222222',
      telefono: '', correo: '', direccion: '', notas: ''
  };

  const abrirModalCliente = () => {
      setBusquedaCliente('');
      setMostrarFormNuevoCliente(false);
      setNuevoClienteForm({ nombre: '', documento: '' });
      setMostrarModalCliente(true);
  };

  const seleccionarCliente = (cli: Cliente | null) => {
      setClienteSeleccionado(cli);
      setMostrarModalCliente(false);
  };

  const handleCrearClienteRapido = async () => {
      if (!nuevoClienteForm.nombre.trim()) { mostrarAlerta('El nombre es obligatorio.', 'advertencia'); return; }
      try {
          await crearCliente({
              nombre: nuevoClienteForm.nombre,
              documento: nuevoClienteForm.documento,
              telefono: '', correo: '', direccion: '', notas: ''
          });
          const clis = await obtenerClientes();
          setClientesLista(clis);
          const nuevo = clis.find(c => c.documento === nuevoClienteForm.documento && c.nombre === nuevoClienteForm.nombre) ?? clis[0];
          seleccionarCliente(nuevo);
      } catch (error) {
          mostrarAlerta(mensajeError(error, 'No se pudo crear el cliente. Verifique que el documento no esté duplicado.'), 'error');
      }
  };

  const handleAnularVenta = async () => {
      if (!ventaSeleccionada) return;
      if (!confirm(`¿Confirma anular la venta INV-${ventaSeleccionada.id.toString().padStart(6, '0')}? Se restaurará el stock de los productos.`)) return;
      try {
          await anularVenta(ventaSeleccionada.id);
          setVentaSeleccionada(null);
          setDetallesVentaAntigua([]);
          const [ventasActualizadas, prods] = await Promise.all([obtenerUltimasVentas(), obtenerProductos()]);
          setUltimasVentas(ventasActualizadas);
          setProductosLista(prods);
      } catch (error) {
          console.error("Error al anular venta:", error);
          mostrarAlerta(mensajeError(error, "No se pudo anular la venta."), 'error');
      }
  };

  const abrirEditarVenta = () => {
      if (!ventaSeleccionada) return;
      setEditDescuento(ventaSeleccionada.descuento ?? 0);
      const clienteActual = clientesLista.find(c => c.id === ventaSeleccionada.cliente_id) ?? null;
      setEditCliente(clienteActual);
      // Copia editable con cantidad_anterior para calcular diffs al guardar
      setEditItems(detallesVentaAntigua.map(d => ({ ...d, cantidad_nueva: d.cantidad, cantidad_anterior: d.cantidad })));
      setMostrarModalEditarVenta(true);
  };

  const handleGuardarEdicionVenta = async () => {
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
          const [ventasActualizadas, prods] = await Promise.all([obtenerUltimasVentas(), obtenerProductos()]);
          setUltimasVentas(ventasActualizadas);
          setProductosLista(prods);
          const actualizada = ventasActualizadas.find((v: Venta) => v.id === ventaSeleccionada!.id);
          if (actualizada) {
              setVentaSeleccionada(actualizada);
              const detalles = await obtenerDetallesDeVenta(actualizada.id);
              setDetallesVentaAntigua(detalles);
          }
          setMostrarModalEditarVenta(false);
      } catch (error) {
          console.error("Error al actualizar venta:", error);
          mostrarAlerta(mensajeError(error, "No se pudo actualizar la venta."), 'error');
      }
  };

  const productosSugeridos = busqueda.trim() !== '' 
      ? productosLista.filter(p => 
          p.nombre.toLowerCase().includes(busqueda.toLowerCase()) || 
          p.codigo_barras.includes(busqueda)
        )
      : [];

  return (
    <div className="flex-1 flex overflow-hidden relative pos-fade-in">
        {/* PANEL CENTRAL: CARRITO */}
        <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden">

            {/* Buscador Inteligente — una sola fila */}
            <div className="border-2 border-slate-200 bg-white rounded-xl px-3 py-2.5 flex items-center gap-2 shadow-sm shrink-0 relative">
                <div className="bg-slate-800 p-2 rounded-lg shrink-0" title="Lector de código de barras activo">
                    <QrCode className="w-5 h-5 text-white" />
                </div>

                {/* Cantidad */}
                <input
                    type="number"
                    min={1}
                    value={cantidadIngreso}
                    onChange={e => {
                        const v = Math.max(1, parseInt(e.target.value) || 1);
                        setCantidadIngreso(v);
                        cantidadIngresoRef.current = v;
                    }}
                    onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === 'Tab') {
                            e.preventDefault();
                            busquedaInputRef.current?.focus();
                        }
                    }}
                    title="Cantidad (o escribe 12* en el buscador)"
                    className="w-14 text-center border border-slate-300 rounded-lg py-2 text-sm font-bold outline-none focus:border-pos-primary focus:ring-1 focus:ring-pos-primary bg-slate-50 shrink-0"
                />
                <span className="text-[10px] text-slate-400 shrink-0">cant.</span>

                {/* Búsqueda */}
                <div className="relative flex-1">
                    <input
                        ref={busquedaInputRef}
                        type="text"
                        value={busqueda}
                        onChange={handleBusquedaChange}
                        onKeyDown={handleKeyDown}
                        placeholder="Busque o escanee un producto y presione Enter..."
                        className="w-full border border-slate-300 rounded-lg pl-9 pr-4 py-2 bg-slate-50 outline-none focus:border-pos-primary focus:ring-1 focus:ring-pos-primary text-sm"
                        autoFocus
                    />
                    <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />

                    {/* Lista de sugerencias */}
                    {busqueda && (
                      <ul className="absolute z-50 w-full mt-1 bg-white border border-slate-200 shadow-xl rounded-lg max-h-56 overflow-auto">
                        {productosSugeridos.length > 0 ? (
                          productosSugeridos.map((p, idx) => (
                            <li
                              key={p.id}
                              onClick={() => { seleccionarProductoParaVer(p); setIndiceSugerido(-1); }}
                              onMouseEnter={() => setIndiceSugerido(idx)}
                              className={`px-4 py-3 cursor-pointer border-b border-slate-100 last:border-0 flex justify-between items-center transition ${indiceSugerido === idx ? 'bg-pos-primary/10 border-l-2 border-l-pos-primary' : 'hover:bg-slate-50'}`}
                            >
                              <div>
                                <div className="font-bold text-slate-700">{p.nombre}</div>
                                <div className="text-xs text-slate-400 font-mono mt-0.5">{p.codigo_barras}</div>
                              </div>
                              <div className="text-right">
                                <div className="font-bold text-pos-primary-dark">${p.precio_venta.toFixed(2)}</div>
                                <div className="text-xs text-slate-400">Stock: {p.stock}</div>
                              </div>
                            </li>
                          ))
                        ) : (
                          <li className="px-4 py-4 text-sm text-slate-500 text-center">No se encontraron productos</li>
                        )}
                      </ul>
                    )}
                </div>
            </div>

            {/* Tabla del carrito */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 flex flex-col min-h-0">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-semibold flex items-center gap-2"><ShoppingCart className="w-5 h-5" /> Carrito de ventas</h2>
                        <span className="text-pos-primary-dark font-medium text-sm bg-green-100 px-3 py-1 rounded-full">{totalArticulos} productos</span>
                    </div>
                    {carrito.length > 0 && (
                        <button onClick={() => setCarrito([])} className="flex items-center gap-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition text-sm font-medium">
                            <Trash2 className="w-4 h-4"/> Vaciar carrito
                        </button>
                    )}
                </div>
                
                <div className="flex-1 overflow-auto p-4">
                  <table className="w-full text-left text-sm">
                    <thead className="text-slate-500 border-b border-slate-200 sticky top-0 bg-white">
                      <tr>
                        <th className="pb-3 font-medium">#</th>
                        <th className="pb-3 font-medium">Producto</th>
                        <th className="pb-3 font-medium">Precio</th>
                        <th className="pb-3 font-medium text-center">Cantidad</th>
                        <th className="pb-3 font-medium text-right">Subtotal</th>
                        <th className="pb-3 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-700">
                      {carrito.length === 0 ? (
                          <tr><td colSpan={6} className="text-center py-8 text-slate-400">El carrito está vacío. Escanee o busque un producto.</td></tr>
                      ) : (
                          carrito.map((item, index) => (
                            <tr key={index} className="border-b border-slate-100 pos-row-in">
                                <td className="py-4 text-slate-400">{index + 1}</td>
                                <td>
                                  <div className="font-medium">{item.producto.nombre}</div>
                                  <div className="font-mono text-xs text-slate-400">{item.producto.codigo_barras}</div>
                                </td>
                                <td>${item.producto.precio_venta.toFixed(2)}</td>
                                <td>
                                <div className="flex items-center justify-center gap-3 bg-slate-100 rounded-lg px-2 py-1 w-max mx-auto">
                                    <button onClick={() => handleModificarCantidad(index, -1)} className="text-slate-400 hover:text-slate-700 font-bold w-4">−</button>
                                    <span className="w-6 text-center font-bold">{item.cantidad}</span>
                                    <button onClick={() => handleModificarCantidad(index, 1)} className="text-slate-400 hover:text-slate-700 font-bold w-4">+</button>
                                </div>
                                </td>
                                <td className="text-right font-bold text-slate-800">${item.subtotal.toFixed(2)}</td>
                                <td className="text-right">
                                    <button onClick={() => handleEliminarItem(index)} className="text-red-400 hover:text-red-600 p-1"><Trash2 className="w-4 h-4 inline" /></button>
                                </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
            </div>

            {/* Totales y Acciones */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 shrink-0">
                <div className="flex justify-between items-center mb-3">
                  <div>
                    <p className="text-xs text-slate-400 font-bold tracking-widest uppercase mb-0.5">Total a pagar</p>
                    <p className="text-4xl font-bold text-pos-primary-dark leading-none">${totalPagar.toFixed(2)}</p>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    {clienteSeleccionado && (
                        <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1 rounded-lg">
                            <User className="w-3.5 h-3.5 shrink-0"/>
                            <span className="truncate max-w-[110px] font-medium">{clienteSeleccionado.nombre}</span>
                            <button onClick={() => setClienteSeleccionado(null)} className="hover:text-red-500 ml-1"><X className="w-3 h-3"/></button>
                        </div>
                    )}
                    <div className="text-right space-y-0.5">
                        <div className="flex gap-4 justify-between"><span className="text-slate-400">Subtotal:</span><span className="font-medium">${subtotal.toFixed(2)}</span></div>
                        <div className="flex gap-4 justify-between"><span className="text-slate-400">Descuento:</span><span className="font-medium text-pos-primary">-${descuento.toFixed(2)}</span></div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 items-center">
                  <input
                      type="text"
                      value={comentario}
                      onChange={e => setComentario(e.target.value)}
                      placeholder="Nota para la tirilla (opcional)..."
                      className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-600 bg-slate-50 outline-none focus:border-pos-primary focus:ring-1 focus:ring-pos-primary"
                  />
                  <button onClick={abrirModalCliente} title="Asignar cliente" className="flex items-center justify-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition text-sm shrink-0"><User className="w-4 h-4"/><span>Cliente</span></button>
                  <button onClick={() => setMostrarModalDescuento(true)} title="Aplicar descuento" className="flex items-center justify-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition text-sm shrink-0"><Tag className="w-4 h-4"/><span>Desc.</span></button>
                  <button
                    disabled={carrito.length === 0}
                    onClick={handleCobrarVenta}
                    className="flex items-center justify-center gap-2 px-6 py-2 bg-pos-primary text-white font-bold rounded-lg hover:bg-pos-primary-dark transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed text-base shrink-0"
                  >
                    <CreditCard className="w-5 h-5"/> Cobrar
                  </button>
                </div>
            </div>
        </div>

        {/* PANEL LATERAL DERECHO */}
        <aside className="w-72 bg-white border-l border-slate-200 flex flex-col p-4 gap-4 overflow-hidden">
            
            {/* Información del Producto con Botón Agregar */}
            <div className="flex flex-col gap-3 shrink-0">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><Search className="w-4 h-4"/> Información del Producto</h3>
                
                {ultimoProductoEscaneado ? (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 relative overflow-hidden group">
                        <div className="flex items-start gap-3 mb-4">
                            <div className="bg-white p-2 rounded border border-slate-200 shadow-sm"><Package className="w-8 h-8 text-pos-primary"/></div>
                            <div>
                                <p className="font-bold text-slate-800 leading-tight pr-8">{ultimoProductoEscaneado.nombre}</p>
                                <p className="text-xs text-slate-500 font-mono mt-1">{ultimoProductoEscaneado.codigo_barras}</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-y-3 text-sm">
                            <div className="text-slate-500">Categoría:</div>
                            <div className="font-medium text-right text-slate-700 bg-slate-200/50 px-2 rounded w-max ml-auto uppercase text-xs">{ultimoProductoEscaneado.categoria || 'N/A'}</div>
                            <div className="text-slate-500">Stock actual:</div>
                            <div className="font-bold text-right text-slate-700">{ultimoProductoEscaneado.stock} un.</div>
                            <div className="text-slate-500">Precio unit.:</div>
                            <div className="font-bold text-right text-pos-primary-dark text-base">${ultimoProductoEscaneado.precio_venta.toFixed(2)}</div>
                        </div>
                        
                        {/* Botón flotante para agregarlo al carrito */}
                        <button
                            onClick={() => procesarIngresoAlCarrito(ultimoProductoEscaneado, cantidadIngreso)}
                            title={`Agregar ${cantidadIngreso} al carrito`}
                            className="absolute top-4 right-4 bg-pos-primary hover:bg-pos-primary-dark text-white p-1.5 rounded-full shadow-md transition transform hover:scale-110"
                        >
                            <PlusCircle className="w-6 h-6" />
                        </button>
                    </div>
                ) : (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
                        <Package className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                        <p className="text-sm text-slate-500">Busque o escanee un producto para ver sus detalles aquí.</p>
                    </div>
                )}
            </div>

            {/* Últimas Ventas Reales */}
            <div className="flex flex-col gap-3 flex-1 overflow-hidden">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><Clock className="w-4 h-4"/> Últimas Ventas</h3>
                <div className="flex-1 overflow-auto space-y-2 pr-2">
                    
                    {ultimasVentas.length === 0 ? (
                        <p className="text-sm text-slate-400 text-center mt-4">Aún no hay ventas registradas.</p>
                    ) : (
                        ultimasVentas.slice(0, 5).map((venta) => (
                            <div 
                                key={venta.id}
                                onClick={() => verDetalleVenta(venta)}
                                title="Ver detalle de la venta"
                                className="bg-white border border-slate-100 p-3 rounded-lg hover:border-pos-primary/40 transition cursor-pointer shadow-sm group"
                            >
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-sm font-bold text-slate-700 group-hover:text-pos-primary transition">INV-{venta.id.toString().padStart(6, '0')}</span>
                                    <span className="text-sm font-bold text-pos-primary-dark">${venta.total.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center text-xs text-slate-500">
                                    <span className="truncate max-w-[120px]">{venta.cliente_nombre || 'Cliente General'}</span>
                                    <span className="bg-slate-100 px-2 py-0.5 rounded text-[10px]">Ver detalle</span>
                                </div>
                            </div>
                        ))
                    )}

                </div>
            </div>
        </aside>

        {/* ======================================= */}
        {/* MODAL 1: COBRO EXITOSO                  */}
        {/* ======================================= */}
        {mostrarModalCobro && (
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 pos-overlay-in">
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md flex flex-col text-center p-8 transform transition-all pos-modal-panel">
                    <div className="mx-auto bg-green-100 w-20 h-20 rounded-full flex items-center justify-center mb-6 pos-check-pop">
                        <CheckCircle className="w-10 h-10 text-green-500" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">¡Venta Completada!</h2>
                    <p className="text-slate-500 mb-8">El cobro se ha registrado exitosamente en el sistema.</p>
                    <div className="space-y-3">
                        <button
                            onClick={imprimirFactura}
                            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-pos-primary text-white font-bold hover:bg-pos-primary-dark transition shadow-md"
                        >
                            <Printer className="w-5 h-5"/> Imprimir Factura
                        </button>
                        <button
                            onClick={() => abrirSelectorPDF(getDatosVentaCompletada())}
                            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl border-2 border-pos-primary text-pos-primary font-bold hover:bg-green-50 transition"
                        >
                            <Download className="w-5 h-5"/> Guardar como PDF
                        </button>
                        <button
                            onClick={limpiarCaja}
                            className="w-full mt-2 text-slate-400 font-medium hover:text-slate-600 transition p-2 border border-transparent hover:bg-slate-50 rounded-xl"
                        >
                            Cerrar y Nueva Venta
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* ======================================= */}
        {/* MODAL 2: APLICAR DESCUENTO              */}
        {/* ======================================= */}
        {mostrarModalDescuento && (
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 pos-overlay-in">
                <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 pos-modal-panel">
                    <h3 className="text-lg font-bold text-slate-800 mb-1">Aplicar Descuento ($)</h3>
                    <p className="text-xs text-slate-400 mb-4">Subtotal actual: ${subtotal.toFixed(2)}</p>
                    <input
                        type="number"
                        autoFocus
                        min={0}
                        max={subtotal}
                        value={descuento || ''}
                        onChange={(e) => setDescuento(Math.max(0, Number(e.target.value) || 0))}
                        onKeyDown={(e) => { if (e.key === 'Enter') aplicarDescuento(); }}
                        placeholder="Monto a descontar..."
                        className="w-full border border-slate-300 rounded-lg p-3 outline-none focus:border-pos-primary text-lg font-bold text-center mb-4"
                    />
                    <div className="flex gap-3">
                        <button onClick={() => setMostrarModalDescuento(false)} className="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-50">Cancelar</button>
                        <button onClick={aplicarDescuento} className="flex-1 py-2.5 rounded-xl bg-pos-primary text-white font-bold hover:bg-pos-primary-dark">Aplicar</button>
                    </div>
                </div>
            </div>
        )}

        {/* ======================================= */}
        {/* MODAL 3: ASIGNAR CLIENTE                */}
        {/* ======================================= */}
        {mostrarModalCliente && (
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 pos-overlay-in">
                <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col pos-modal-panel">
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center shrink-0">
                        <h3 className="font-bold text-slate-800">Asignar Cliente</h3>
                        <button onClick={() => setMostrarModalCliente(false)}><X className="w-5 h-5 text-slate-400 hover:text-slate-700" /></button>
                    </div>

                    <div className="p-4 space-y-3">
                        {/* Consumidor Final */}
                        <button
                            onClick={() => seleccionarCliente(CONSUMIDOR_FINAL)}
                            className="w-full flex items-center gap-3 p-3 rounded-xl border-2 border-slate-200 hover:border-pos-primary hover:bg-green-50 transition text-left"
                        >
                            <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                                <User className="w-5 h-5 text-slate-400" />
                            </div>
                            <div>
                                <p className="font-bold text-sm text-slate-700">Consumidor Final</p>
                                <p className="text-xs text-slate-400 font-mono">NIT: 222222222222</p>
                            </div>
                        </button>

                        {/* Buscador */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                autoFocus
                                type="text"
                                value={busquedaCliente}
                                onChange={e => setBusquedaCliente(e.target.value)}
                                placeholder="Buscar por nombre o documento..."
                                className="w-full pl-9 pr-4 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-pos-primary focus:ring-1 focus:ring-pos-primary"
                            />
                        </div>

                        {/* Lista de clientes (primeros 5) */}
                        <ul className="space-y-1 max-h-48 overflow-auto">
                            {(() => {
                                const filtrados = clientesLista.filter(c =>
                                    c.nombre.toLowerCase().includes(busquedaCliente.toLowerCase()) ||
                                    (c.documento ?? '').includes(busquedaCliente)
                                ).slice(0, 5);

                                if (clientesLista.length === 0) return (
                                    <li className="text-center text-slate-400 text-sm py-4">No hay clientes registrados.</li>
                                );
                                if (filtrados.length === 0) return (
                                    <li className="text-center text-slate-400 text-sm py-4">Sin resultados para "{busquedaCliente}".</li>
                                );
                                return filtrados.map(cli => (
                                    <li
                                        key={cli.id}
                                        onClick={() => seleccionarCliente(cli)}
                                        className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-200 transition"
                                    >
                                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-blue-600 font-bold text-sm">
                                            {cli.nombre.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="font-semibold text-sm text-slate-700">{cli.nombre}</p>
                                            <p className="text-xs text-slate-400 font-mono">{cli.documento || 'Sin documento'}</p>
                                        </div>
                                    </li>
                                ));
                            })()}
                        </ul>

                        {/* Crear nuevo cliente */}
                        {!mostrarFormNuevoCliente ? (
                            <button
                                onClick={() => setMostrarFormNuevoCliente(true)}
                                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-slate-300 text-slate-500 hover:border-pos-primary hover:text-pos-primary transition text-sm font-medium"
                            >
                                <UserPlus className="w-4 h-4"/> Crear nuevo cliente
                            </button>
                        ) : (
                            <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50">
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nuevo cliente</p>
                                <input
                                    autoFocus
                                    type="text"
                                    placeholder="Nombre o razón social *"
                                    value={nuevoClienteForm.nombre}
                                    onChange={e => setNuevoClienteForm(p => ({ ...p, nombre: e.target.value }))}
                                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary"
                                />
                                <input
                                    type="text"
                                    placeholder="CC / NIT (opcional)"
                                    value={nuevoClienteForm.documento}
                                    onChange={e => setNuevoClienteForm(p => ({ ...p, documento: e.target.value }))}
                                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary font-mono"
                                />
                                <div className="flex gap-2">
                                    <button onClick={() => setMostrarFormNuevoCliente(false)} className="flex-1 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-100">Cancelar</button>
                                    <button onClick={handleCrearClienteRapido} className="flex-1 py-2 rounded-lg bg-pos-primary text-white font-bold text-sm hover:bg-pos-primary-dark">Guardar y asignar</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* ======================================= */}
        {/* MODAL 4: DETALLE DE VENTA HISTÓRICA     */}
        {/* ======================================= */}
        {ventaSeleccionada && (
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 pos-overlay-in">
                <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl flex flex-col max-h-full pos-modal-panel">
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="bg-slate-100 p-2 rounded text-slate-600"><FileText className="w-5 h-5"/></div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">Venta: INV-{ventaSeleccionada.id.toString().padStart(6, '0')}</h3>
                                <p className="text-xs text-slate-500">{new Date(ventaSeleccionada.fecha.replace(' ', 'T')).toLocaleString()}</p>
                            </div>
                        </div>
                        <button onClick={() => setVentaSeleccionada(null)} className="text-slate-400 hover:bg-slate-100 p-2 rounded-full"><X className="w-5 h-5" /></button>
                    </div>
                    <div className="p-6 overflow-auto bg-slate-50/50">
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
                                {detallesVentaAntigua.map((prod: VentaDetalle, idx: number) => (
                                    <tr key={idx}>
                                        <td className="py-3 font-medium text-slate-500">{prod.cantidad}x</td>
                                        <td className="py-3">{prod.producto_nombre}</td>
                                        <td className="py-3 text-right text-slate-500">${prod.precio_unitario.toFixed(2)}</td>
                                        <td className="py-3 text-right font-medium">${prod.subtotal.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="mt-4 pt-4 border-t border-slate-200 space-y-1 text-right">
                            <div className="text-sm text-slate-500">Descuento aplicado: <span className="font-medium text-slate-700">-${ventaSeleccionada.descuento.toFixed(2)}</span></div>
                            <div className="flex justify-end items-center gap-4 mt-2">
                                <span className="font-bold text-slate-600 uppercase">Total Cobrado</span>
                                <span className="text-2xl font-bold text-pos-primary-dark">${ventaSeleccionada.total.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                    <div className="p-6 border-t border-slate-100 bg-white flex gap-3 rounded-b-2xl shrink-0 flex-wrap">
                        <button onClick={() => setVentaSeleccionada(null)} className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-50">Cerrar</button>
                        <button
                            onClick={reimprimirFacturaHistorica}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 text-slate-600 font-bold hover:bg-slate-50 transition"
                        >
                            <Printer className="w-4 h-4"/> Imprimir
                        </button>
                        <button
                            onClick={() => abrirSelectorPDF(getDatosVentaHistorica())}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-pos-primary text-pos-primary font-bold hover:bg-green-50 transition"
                        >
                            <Download className="w-4 h-4"/> PDF
                        </button>
                        <button
                            onClick={abrirEditarVenta}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-blue-300 text-blue-600 font-bold hover:bg-blue-50 transition"
                        >
                            <Edit className="w-4 h-4"/> Editar
                        </button>
                        <button
                            onClick={handleAnularVenta}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 transition shadow-md"
                        >
                            <AlertTriangle className="w-4 h-4"/> Anular Venta
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* ======================================= */}
        {/* MODAL 5: EDITAR VENTA                   */}
        {/* ======================================= */}
        {mostrarModalEditarVenta && ventaSeleccionada && (
            <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4 pos-overlay-in">
                <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh] pos-modal-panel">
                    <div className="p-5 border-b border-slate-100 flex justify-between items-center shrink-0">
                        <h3 className="text-lg font-bold text-slate-800">
                            Editar INV-{ventaSeleccionada.id.toString().padStart(6, '0')}
                        </h3>
                        <button onClick={() => setMostrarModalEditarVenta(false)}>
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
                                    {productosLista
                                        .filter(p => p.nombre.toLowerCase().includes(editBusqueda.toLowerCase()) || p.codigo_barras.includes(editBusqueda))
                                        .slice(0, 5)
                                        .map(prod => (
                                            <button
                                                key={prod.id}
                                                type="button"
                                                onClick={() => {
                                                    setEditItems(prev => {
                                                        const productoId = prod.id;
                                                        if (productoId === undefined) return prev;

                                                        const existente = prev.find(it => it.producto_id === productoId);
                                                        if (existente) {
                                                            return prev.map(it => it.producto_id === productoId ? { ...it, cantidad_nueva: it.cantidad_nueva + 1 } : it);
                                                        } else {
                                                            return [...prev, {
                                                                id: -Date.now(),
                                                                venta_id: 0,
                                                                producto_id: productoId,
                                                                producto_nombre: prod.nombre,
                                                                cantidad: 0,
                                                                cantidad_nueva: 1,
                                                                cantidad_anterior: 0,
                                                                precio_unitario: prod.precio_venta,
                                                                subtotal: prod.precio_venta,
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
                                    {productosLista.filter(p => p.nombre.toLowerCase().includes(editBusqueda.toLowerCase()) || p.codigo_barras.includes(editBusqueda)).length === 0 && (
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
                                                        <button
                                                            onClick={() => setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, cantidad_nueva: Math.max(0, it.cantidad_nueva - 1) } : it))}
                                                            className="text-slate-400 hover:text-slate-700 font-bold w-4"
                                                        >−</button>
                                                        <span className="w-8 text-center font-bold">{item.cantidad_nueva}</span>
                                                        <button
                                                            onClick={() => setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, cantidad_nueva: it.cantidad_nueva + 1 } : it))}
                                                            className="text-slate-400 hover:text-slate-700 font-bold w-4"
                                                        >+</button>
                                                    </div>
                                                </td>
                                                <td className="p-3 text-right font-medium text-slate-800">
                                                    ${(item.cantidad_nueva * item.precio_unitario).toFixed(2)}
                                                </td>
                                                <td className="p-3 text-center">
                                                    <button
                                                        onClick={() => setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, cantidad_nueva: 0 } : it))}
                                                        className="text-red-400 hover:text-red-600 transition"
                                                        title="Quitar item"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                        {editItems.every(i => i.cantidad_nueva === 0) && (
                                            <tr><td colSpan={4} className="p-4 text-center text-slate-400 text-sm">No quedan productos. La venta será anulada al guardar.</td></tr>
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
                                onChange={e => {
                                    const cli = clientesLista.find(c => c.id === Number(e.target.value)) ?? null;
                                    setEditCliente(cli);
                                }}
                                className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary"
                            >
                                <option value="">Consumidor Final</option>
                                {clientesLista.map(c => (
                                    <option key={c.id} value={c.id}>{c.nombre}</option>
                                ))}
                            </select>
                        </div>

                        {/* Descuento */}
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">Descuento ($)</label>
                            <input
                                type="number"
                                min={0}
                                value={editDescuento}
                                onChange={e => setEditDescuento(Number(e.target.value))}
                                className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary"
                            />
                        </div>

                        {/* Resumen nuevo total */}
                        <div className="bg-slate-50 rounded-xl p-4 flex justify-between items-center">
                            <span className="text-slate-500 font-medium">Nuevo total estimado:</span>
                            <span className="text-xl font-bold text-pos-primary-dark">
                                ${Math.max(0, editItems.reduce((s, i) => s + i.cantidad_nueva * i.precio_unitario, 0) - editDescuento).toFixed(2)}
                            </span>
                        </div>
                    </div>

                    <div className="p-5 border-t border-slate-100 flex gap-3 shrink-0">
                        <button
                            onClick={() => setMostrarModalEditarVenta(false)}
                            className="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-50"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleGuardarEdicionVenta}
                            className="flex-[2] py-2.5 rounded-xl bg-pos-primary text-white font-bold hover:bg-pos-primary-dark transition shadow-md"
                        >
                            Guardar Cambios
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* ======================================= */}
        {/* SELECTOR DE FORMATO PARA PDF            */}
        {/* ======================================= */}
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