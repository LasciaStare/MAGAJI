import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { buildTicketHTML, type ConfigNegocio, type DatosFactura } from '../utils/factura';

const DATOS_EJEMPLO: DatosFactura = {
  folio: 'POS-042',
  fecha: new Date().toLocaleString('es-CO'),
  cliente: 'CONSUMIDOR FINAL',
  clienteDoc: '222222222222',
  items: [
    { nombre: 'Pan tajado pequeño', precio: 4500, cantidad: 2, subtotal: 9000 },
    { nombre: 'Café El Ñandú 250g', precio: 12000, cantidad: 1, subtotal: 12000 },
    { nombre: 'Jabón antibacterial', precio: 3500, cantidad: 3, subtotal: 10500 },
  ],
  subtotal: 31500,
  descuento: 1500,
  total: 30000,
  formaPago: 'Efectivo',
  pagoCon: 50000,
};

// Ancho real del ticket HTML: 80mm ≈ 302px a 96 DPI
const TICKET_W = 302;
const TICKET_H = 1100; // alto del iframe (más que suficiente para la mayoría de tickets)
const ZOOM_MIN = 0.4;
const ZOOM_STEP = 0.1;

interface Props {
  config: ConfigNegocio;
  initialZoom?: number;
  zoomMax?: number;
  /** Botón opcional en la barra superior (p. ej. pantalla completa). */
  accion?: ReactNode;
}

export default function PreviewTirilla({ config, initialZoom = 0.6, zoomMax = 1.2, accion }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [zoom, setZoom] = useState(initialZoom);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.srcdoc = buildTicketHTML(DATOS_EJEMPLO, config);
  }, [config]);

  const displayW = Math.round(TICKET_W * zoom);
  const displayH = Math.round(TICKET_H * zoom);

  const cambiarZoom = (delta: number) => {
    setZoom(z => Math.min(zoomMax, Math.max(ZOOM_MIN, parseFloat((z + delta).toFixed(2)))));
  };

  return (
    <div className="flex flex-col gap-2 flex-shrink-0" style={{ width: displayW }}>
      {/* Barra de zoom */}
      <div className="flex items-center justify-start gap-3">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Preview</span>
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => cambiarZoom(-ZOOM_STEP)}
              disabled={zoom <= ZOOM_MIN}
              className="p-1 rounded-md hover:bg-white disabled:opacity-30 transition"
              title="Reducir"
            >
              <ZoomOut className="w-3.5 h-3.5 text-slate-600" />
            </button>
            <span className="text-xs w-9 text-center font-mono text-slate-600 select-none">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => cambiarZoom(ZOOM_STEP)}
              disabled={zoom >= zoomMax}
              className="p-1 rounded-md hover:bg-white disabled:opacity-30 transition"
              title="Ampliar"
            >
              <ZoomIn className="w-3.5 h-3.5 text-slate-600" />
            </button>
          </div>
          {accion}
        </div>
      </div>

      {/* Papel de ticket */}
      <div
        className="relative overflow-hidden rounded-lg shadow-lg border border-slate-200 bg-white"
        style={{ width: displayW, height: displayH }}
      >
        <iframe
          ref={iframeRef}
          title="Preview tirilla"
          style={{
            width: TICKET_W,
            height: TICKET_H,
            border: 'none',
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
            display: 'block',
            pointerEvents: 'none',
          }}
        />
      </div>
      <p className="text-xs text-slate-400 text-center">
        Datos de ejemplo — refleja cambios en tiempo real
      </p>
    </div>
  );
}
