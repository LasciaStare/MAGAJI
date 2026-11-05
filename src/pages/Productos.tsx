import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit, Trash2, PackageSearch, X, Barcode, Save, Folder, Layers, Search, Printer, TriangleAlert } from 'lucide-react';
import { crearProducto, obtenerProductos, actualizarProducto, eliminarProducto, mensajeError, Producto } from '../database/db';
import { mostrarAlerta } from '../utils/alertGlobal';
import { normalizarNombre } from '../utils/importacionFactura';

export default function Productos() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [listaProductos, setListaProductos] = useState<Producto[]>([]);
  const [categoriaFiltro, setCategoriaFiltro] = useState('Todas');
  const [busqueda, setBusqueda] = useState('');
  const [idProductoEditando, setIdProductoEditando] = useState<number | null>(null);
  const [busquedaCategoria, setBusquedaCategoria] = useState('');
  const navigate = useNavigate();
  
  // Estado para el formulario del modal
  const [formData, setFormData] = useState<Producto>({
    codigo_barras: '',
    nombre: '',
    nombre_etiqueta: '',
    categoria: '',
    precio_compra: 0,
    precio_venta: 0,
    stock: 0,
    stock_minimo: 5,
  });

  useEffect(() => {
    cargarDatos();
  }, []);

  const cargarDatos = async () => {
    try {
      const datos = await obtenerProductos();
      setListaProductos(datos);
    } catch (error) {
      console.error("Error al cargar productos:", error);
    }
  };

  // Extraer las categorías únicas de los productos guardados para armar el panel izquierdo y la lista de sugerencias
  const categoriasExistentes = Array.from(
    new Set(listaProductos.map(p => p.categoria).filter(Boolean))
  );

  // Filtrar las categorías del panel izquierdo según la búsqueda por nombre
  const categoriasFiltradas = categoriasExistentes.filter(cat =>
    !busquedaCategoria || cat.toLowerCase().includes(busquedaCategoria.toLowerCase())
  );

  // Aviso en vivo: mismo nombre normalizado o mismo código de barras que otro producto.
  const duplicados = useMemo(() => {
    const nombre = normalizarNombre(formData.nombre);
    const codigo = formData.codigo_barras.trim();
    if (!nombre && !codigo) return [];
    return listaProductos.filter(p => p.id !== idProductoEditando && (
      (codigo !== '' && p.codigo_barras === codigo) ||
      (nombre !== '' && normalizarNombre(p.nombre) === nombre)
    ));
  }, [formData.nombre, formData.codigo_barras, listaProductos, idProductoEditando]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target as HTMLInputElement;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox'
        ? ((e.target as HTMLInputElement).checked ? 1 : 0)
        : ['precio_compra', 'precio_venta', 'stock', 'stock_minimo'].includes(name) ? Number(value) : value
    }));
  };

  const handleAbrirCrear = () => {
    setIdProductoEditando(null);
    setFormData({ codigo_barras: '', nombre: '', nombre_etiqueta: '', categoria: '', precio_compra: 0, precio_venta: 0, stock: 0, stock_minimo: 5 });
    setIsModalOpen(true);
  };

  const handleAbrirEditar = (producto: Producto) => {
    setIdProductoEditando(producto.id || null);
    setFormData({ ...producto, nombre_etiqueta: producto.nombre_etiqueta ?? '' });
    setIsModalOpen(true);
  };

  const handleEliminar = async (id: number, nombre: string) => {
    if (confirm(`¿Está seguro de que desea eliminar el producto "${nombre}"?`)) {
      try {
        await eliminarProducto(id);
        await cargarDatos();
      } catch (error) {
        console.error("Error al eliminar:", error);
        mostrarAlerta(mensajeError(error, "No se pudo eliminar el producto."), 'error');
      }
    }
  };

  const handleGuardar = async () => {
    // ── Validaciones de entrada ──
    const codigo = formData.codigo_barras.trim();
    const nombre = formData.nombre.trim();
    if (!nombre) { mostrarAlerta("El nombre del producto es obligatorio.", 'advertencia'); return; }

    if (!Number.isFinite(formData.precio_venta) || formData.precio_venta <= 0) {
      mostrarAlerta("El precio de venta debe ser un número mayor a 0.", 'advertencia');
      return;
    }
    if (!Number.isFinite(formData.precio_compra) || formData.precio_compra < 0) {
      mostrarAlerta("El precio de compra no puede ser negativo.", 'advertencia');
      return;
    }
    if (!Number.isInteger(formData.stock) || formData.stock < 0) {
      mostrarAlerta("El stock debe ser un número entero igual o mayor a 0.", 'advertencia');
      return;
    }
    if (!Number.isInteger(formData.stock_minimo) || formData.stock_minimo < 0) {
      mostrarAlerta("El stock mínimo debe ser un número entero igual o mayor a 0.", 'advertencia');
      return;
    }
    // Aviso (no bloqueante) si ya existe otro producto con el mismo nombre o código.
    if (duplicados.length) {
      const detalle = duplicados.map(p => `• ${p.nombre} (${p.codigo_barras})`).join('\n');
      const accion = idProductoEditando === null ? 'crear otro producto' : 'guardar los cambios';
      if (!confirm(`Ya existe un producto igual:\n${detalle}\n\n¿Deseas ${accion} de todas formas?`)) return;
    }
    // Aviso (no bloqueante) si se vendería por debajo del costo
    if (formData.precio_compra > 0 && formData.precio_venta < formData.precio_compra) {
      if (!confirm("El precio de venta es menor al de compra (venderías con pérdida).\n¿Deseas guardarlo de todas formas?")) {
        return;
      }
    }

    try {
      const productoAProcesar = { 
        ...formData, 
        codigo_barras: codigo,  // Si está vacío, se genera automáticamente en la BD
        nombre, 
        categoria: formData.categoria.trim() || 'Sin Categoría' 
      };

      if (idProductoEditando !== null) {
        // Modo Edición
        await actualizarProducto(idProductoEditando, productoAProcesar);
        mostrarAlerta("Producto actualizado correctamente.", 'info');
      } else {
        // Modo Creación
        await crearProducto(productoAProcesar);
        mostrarAlerta("Producto creado correctamente. Si no ingresaste código, se generó automáticamente uno EAN-8.", 'info');
      }

      setIsModalOpen(false);
      await cargarDatos();

    } catch (error) {
      console.error("Error al guardar:", error);
      mostrarAlerta(mensajeError(error, "No se pudo guardar el producto. Verifique que el código de barras sea válido y no esté duplicado."), 'error');
    }
  };

  // Filtrar la lista de productos según la categoría seleccionada a la izquierda
  const productosFiltrados = listaProductos
    .filter(p => categoriaFiltro === 'Todas' || p.categoria === categoriaFiltro)
    .filter(p => !busqueda || p.nombre.toLowerCase().includes(busqueda.toLowerCase()) || p.codigo_barras.includes(busqueda));

  return (
    <div className="p-8 flex-1 flex gap-6 overflow-hidden relative pos-fade-in">

      {/* PANEL IZQUIERDO: Categorías */}
      <aside className="w-56 flex flex-col shrink-0 bg-white border border-slate-200 rounded-xl p-4 shadow-sm overflow-y-auto">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Layers className="w-4 h-4"/> Categorías
        </h3>
        <div className="relative mb-3 shrink-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="search"
            value={busquedaCategoria}
            onChange={e => setBusquedaCategoria(e.target.value)}
            placeholder="Buscar categoría..."
            className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg bg-slate-50 outline-none focus:ring-2 focus:ring-pos-primary focus:border-pos-primary focus:bg-white transition-all text-sm"
          />
        </div>
        <div className="space-y-1">
          <button 
            onClick={() => setCategoriaFiltro('Todas')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition ${categoriaFiltro === 'Todas' ? 'bg-pos-primary text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <Folder className="w-4 h-4" />
            <span className="truncate">Todas</span>
            <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-md ${categoriaFiltro === 'Todas' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{listaProductos.length}</span>
          </button>

          {categoriasFiltradas.map((cat) => {
            const totalEnCat = listaProductos.filter(p => p.categoria === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setCategoriaFiltro(cat)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition ${categoriaFiltro === cat ? 'bg-pos-primary text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                <Folder className="w-4 h-4 shrink-0" />
                <span className="truncate capitalize">{cat}</span>
                <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-md shrink-0 ${categoriaFiltro === cat ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{totalEnCat}</span>
              </button>
            );
          })}
          {categoriasFiltradas.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-3">Sin categorías que coincidan</p>
          )}
        </div>
      </aside>

      {/* PANEL DERECHO: Contenido Principal */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Barra de acciones superior */}
        <div className="flex justify-between items-center mb-6 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Catálogo de Productos</h2>
            <p className="text-sm text-slate-500">
              Viendo: <span className="font-semibold text-pos-primary capitalize">{categoriaFiltro}</span>
            </p>
          </div>
          <button 
            onClick={handleAbrirCrear}
            className="flex items-center gap-2 bg-pos-primary text-white font-bold px-5 py-2.5 rounded-xl hover:bg-pos-primary-dark transition shadow-md"
          >
            <Plus className="w-5 h-5" /> Agregar Producto
          </button>
        </div>

        {/* Barra de búsqueda */}
        <div className="mb-4 shrink-0 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="search"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar producto por nombre o código..."
            className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl bg-white outline-none focus:ring-2 focus:ring-pos-primary focus:border-pos-primary transition-all text-sm"
          />
        </div>

        {/* Contenedor de la tabla */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 flex flex-col overflow-hidden">
          <div className="overflow-auto flex-1 p-0">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-600 sticky top-0 border-b border-slate-200 z-10">
                <tr>
                  <th className="p-4 font-semibold">Código de Barras</th>
                  <th className="p-4 font-semibold">Nombre del Producto</th>
                  <th className="p-4 font-semibold">Categoría</th>
                  <th className="p-4 font-semibold text-right">Precio Compra</th>
                  <th className="p-4 font-semibold text-right">Precio Venta</th>
                  <th className="p-4 font-semibold text-center">Stock</th>
                  <th className="p-4 font-semibold text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="text-slate-700 divide-y divide-slate-100">
                {productosFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      No hay productos registrados en esta sección.
                    </td>
                  </tr>
                ) : (
                  productosFiltrados.map((producto) => (
                    <tr key={producto.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-4 font-mono text-slate-500">{producto.codigo_barras}</td>
                      <td className="p-4 font-medium">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-slate-400 shrink-0"><PackageSearch className="w-4 h-4"/></div>
                          <div>
                            {producto.nombre}
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-medium uppercase tracking-wider">
                          {producto.categoria}
                        </span>
                      </td>
                      <td className="p-4 text-right text-slate-500">${producto.precio_compra.toFixed(2)}</td>
                      <td className="p-4 text-right font-medium text-pos-primary-dark">${producto.precio_venta.toFixed(2)}</td>
                      <td className="p-4 text-center">
                        <span className={`font-bold px-2.5 py-1 rounded-lg text-sm ${producto.stock <= producto.stock_minimo ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                          {producto.stock}
                        </span>
                      </td>
                      <td className="p-4 text-center space-x-3">
                        <button 
                          onClick={() => navigate('/etiquetas', { state: { productToPrint: producto } })}
                          title="Imprimir etiquetas" 
                          className="text-slate-400 hover:text-pos-primary transition p-1"
                        >
                          <Printer className="w-4 h-4 inline" />
                        </button>
                        <button 
                          onClick={() => handleAbrirEditar(producto)}
                          title="Editar producto" 
                          className="text-slate-400 hover:text-blue-600 transition p-1"
                        >
                          <Edit className="w-4 h-4 inline" />
                        </button>
                        <button 
                          onClick={() => handleEliminar(producto.id!, producto.nombre)}
                          title="Eliminar producto" 
                          className="text-slate-400 hover:text-red-600 transition p-1"
                        >
                          <Trash2 className="w-4 h-4 inline" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          <div className="p-4 border-t border-slate-200 bg-white flex justify-between items-center text-sm text-slate-500 shrink-0">
            <span>Mostrando {productosFiltrados.length} productos</span>
          </div>
        </div>
      </div>

      {/* MODAL DE REGISTRO / EDICIÓN */}
      {isModalOpen && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 pos-overlay-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl flex flex-col max-h-[92vh] pos-modal-panel">
            
            <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h3 className="text-xl font-bold text-slate-800">
                {idProductoEditando !== null ? 'Editar Producto' : 'Registrar Nuevo Producto'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:bg-slate-100 p-2 rounded-full transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-auto space-y-4">
              <div>
                <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2"><Barcode className="w-4 h-4"/> Identificación</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Código de Barras 
                      <span className="text-slate-400 text-[10px] ml-1">(Opcional - se genera automáticamente EAN-8 si está vacío)</span>
                    </label>
                    <input 
                      name="codigo_barras" 
                      value={formData.codigo_barras} 
                      onChange={handleInputChange} 
                      type="text" 
                      placeholder="Escanee el código de fábrica (o deje vacío para generar EAN-8 interno)" 
                      className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary font-mono" 
                      autoFocus 
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Nombre del Producto <span className="text-slate-400 text-[10px]">(se usa en facturas, inventario y reportes)</span></label>
                    <input name="nombre" value={formData.nombre} onChange={handleInputChange} type="text" placeholder="Ej. Coca Cola 600ml" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Nombre en Etiqueta
                      <span className="text-slate-400 text-[10px] ml-1">(Opcional, máx. 16)</span>
                    </label>
                    <input name="nombre_etiqueta" value={formData.nombre_etiqueta} onChange={handleInputChange} type="text" maxLength={16} placeholder="Corto para la etiqueta (si vacío, se usa el nombre recortado)" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary" />
                    <p className="mt-1 text-[11px] text-slate-400">{formData.nombre_etiqueta.length}/16 caracteres</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Categoría</label>
                    {/* 👇 INPUT HÍBRIDO CON SUGERENCIAS Y CREACIÓN NUEVA 👇 */}
                    <input 
                      name="categoria" 
                      value={formData.categoria} 
                      onChange={handleInputChange} 
                      type="text" 
                      list="categorias-sugeridas" 
                      placeholder="Seleccione o escriba una nueva..." 
                      className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary"
                    />
                    <datalist id="categorias-sugeridas">
                      {categoriasExistentes.map(cat => (
                        <option key={cat} value={cat} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>

              {duplicados.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                  <p className="flex items-center gap-2 text-xs font-bold"><TriangleAlert className="w-4 h-4 shrink-0" /> Ya existe un producto igual</p>
                  <ul className="mt-1 space-y-0.5 text-[11px]">
                    {duplicados.map(p => (
                      <li key={p.id}>• {p.nombre} · código {p.codigo_barras} · stock {p.stock}</li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[10px] text-amber-700">Si es el mismo producto, ciérrelo y edítelo para sumar stock en lugar de crear un duplicado.</p>
                </div>
              )}

              <div className="border-t border-slate-100"></div>

              <div>
                <h4 className="text-sm font-bold text-slate-700 mb-3">Precios y Stock</h4>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Precio de Compra</label>
                    <input name="precio_compra" value={formData.precio_compra || ''} onChange={handleInputChange} type="number" min="0" step="0.01" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Precio de Venta</label>
                    <input name="precio_venta" value={formData.precio_venta || ''} onChange={handleInputChange} type="number" min="0" step="0.01" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Stock Inicial / Actual</label>
                    <input name="stock" value={formData.stock || ''} onChange={handleInputChange} type="number" min="0" step="1" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Stock Mínimo</label>
                    <input name="stock_minimo" value={formData.stock_minimo || ''} onChange={handleInputChange} type="number" min="0" step="1" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-pos-primary" />
                  </div>
                </div>
              </div>

            </div>

            <div className="px-5 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl shrink-0">
              <button onClick={() => setIsModalOpen(false)} className="px-6 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-100 transition">Cancelar</button>
              <button onClick={handleGuardar} className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-pos-primary text-white font-bold hover:bg-pos-primary-dark transition shadow-md">
                <Save className="w-4 h-4"/> {idProductoEditando !== null ? 'Guardar Cambios' : 'Guardar Producto'}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}