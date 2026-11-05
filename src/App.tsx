import { useEffect, useState, useCallback } from 'react';
import { initDB } from './database/db';
import { verificarRespaldoAutomatico } from './services/backup';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import Ventas from './pages/Ventas';
import Productos from './pages/Productos';
import Configuracion from './pages/Configuracion';
import Clientes from './pages/Clientes';
import Inventario from './pages/Inventario';
import Etiquetas from './pages/Etiquetas';
import Reportes from './pages/Reportes';
import AlertModal from './components/AlertModal';
import LoginScreen from './components/LoginScreen';
import { registrarHandlerAlerta, type TipoAlerta } from './utils/alertGlobal';
import type { Cliente, Producto } from './database/db';
import './App.css';

interface ArticuloCarrito {
  producto: Producto;
  cantidad: number;
  subtotal: number;
}

const Header = () => {
  const location = useLocation();
  const esVentas = location.pathname === '/' || location.pathname === '/ventas';
  if (!esVentas) return null;

  const titleMap: Record<string, string> = {
    '/': 'Nueva Venta',
    '/ventas': 'Nueva Venta',
  };
  const currentTitle = titleMap[location.pathname] || 'Nueva Venta';
  return (
    <header className="p-6 flex items-center border-b bg-white border-slate-200 shrink-0">
      <h1 key={currentTitle} className="text-2xl font-bold text-slate-800 pos-fade-in">{currentTitle}</h1>
    </header>
  );
};

interface EstadoAlerta {
  mensaje: string;
  tipo: TipoAlerta;
  titulo?: string;
}

function App() {
  const [autenticado, setAutenticado] = useState(false);

  useEffect(() => {
    initDB()
      .then(async () => {
        verificarRespaldoAutomatico();
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    // La rueda del mouse no debe modificar los campos numéricos (precios, stock, cantidades).
    // Al girar sobre uno, se quita el foco antes de que el navegador aplique el cambio.
    const alGirarRueda = (e: WheelEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type === 'number') e.target.blur();
    };
    document.addEventListener('wheel', alGirarRueda, { capture: true, passive: true });
    return () => document.removeEventListener('wheel', alGirarRueda, { capture: true });
  }, []);

  const [alerta, setAlerta] = useState<EstadoAlerta | null>(null);

  const cerrarAlerta = useCallback(() => setAlerta(null), []);

  useEffect(() => {
    registrarHandlerAlerta((mensaje, tipo = 'error', titulo) => {
      setAlerta({ mensaje, tipo, titulo });
    });
  }, []);

  // Estado persistente de la venta activa (sobrevive cambios de pestaña)
  const [carrito, setCarrito] = useState<ArticuloCarrito[]>([]);
  const [descuento, setDescuento] = useState(0);
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null);

  if (!autenticado) {
    return (
      <>
        <LoginScreen onLogin={() => setAutenticado(true)} />
        {alerta && (
          <AlertModal
            mensaje={alerta.mensaje}
            tipo={alerta.tipo}
            titulo={alerta.titulo}
            onClose={cerrarAlerta}
          />
        )}
      </>
    );
  }

  return (
    <BrowserRouter>
      <div className="flex h-screen bg-pos-bg text-slate-900 font-sans overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          <Header />
          <div className="flex-1 flex flex-col overflow-hidden">
          <Routes>
            <Route path="/" element={
              <Ventas
                carrito={carrito} setCarrito={setCarrito}
                descuento={descuento} setDescuento={setDescuento}
                clienteSeleccionado={clienteSeleccionado} setClienteSeleccionado={setClienteSeleccionado}
              />
            } />
            <Route path="/ventas" element={
              <Ventas
                carrito={carrito} setCarrito={setCarrito}
                descuento={descuento} setDescuento={setDescuento}
                clienteSeleccionado={clienteSeleccionado} setClienteSeleccionado={setClienteSeleccionado}
              />
            } />
            <Route path="/productos" element={<Productos />} />
            <Route path="/etiquetas" element={<Etiquetas />} />
            <Route path="/inventario" element={<Inventario />} />
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/configuracion" element={<Configuracion />} />
            <Route path="/reportes" element={<Reportes />} />
          </Routes>
          </div>
        </main>
      </div>
      {alerta && (
        <AlertModal
          mensaje={alerta.mensaje}
          tipo={alerta.tipo}
          titulo={alerta.titulo}
          onClose={cerrarAlerta}
        />
      )}
    </BrowserRouter>
  );
}

export default App;
