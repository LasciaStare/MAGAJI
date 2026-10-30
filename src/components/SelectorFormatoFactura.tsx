import { X, Receipt, FileText } from 'lucide-react';
import { FormatoFactura } from '../utils/factura';

interface SelectorFormatoFacturaProps {
  /** Acción a ejecutar al elegir formato (imprimir o descargar). */
  onSelect: (formato: FormatoFactura) => void;
  onClose: () => void;
  titulo?: string;
  /** Verbo de la acción: 'descargar' (PDF) o 'imprimir'. Solo afecta los textos. */
  accion?: 'descargar' | 'imprimir';
}

/**
 * Modal reutilizable para elegir el formato de la factura:
 *  • Tirilla POS 80mm (impresora térmica)
 *  • Factura electrónica (carta, con QR + CUFE + IVA)
 */
export default function SelectorFormatoFactura({
  onSelect,
  onClose,
  titulo,
  accion = 'descargar',
}: SelectorFormatoFacturaProps) {
  const verbo = accion === 'imprimir' ? 'Imprimir' : 'Guardar como PDF';

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4 pos-overlay-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col pos-modal-panel">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
          <h3 className="font-bold text-slate-800">{titulo ?? `${verbo}: elige el formato`}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-1.5 rounded-full transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 gap-3">
          {/* Tirilla térmica */}
          <button
            onClick={() => onSelect('ticket')}
            className="flex items-start gap-4 p-4 rounded-xl border-2 border-slate-200 hover:border-pos-primary hover:bg-green-50 transition text-left group"
          >
            <div className="bg-slate-100 group-hover:bg-white p-3 rounded-lg text-pos-primary shrink-0">
              <Receipt className="w-7 h-7" />
            </div>
            <div>
              <p className="font-bold text-slate-800">Tirilla POS (80mm)</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Formato para impresora térmica 3nStar RPT005 (ESC/POS, 80mm).
              </p>
            </div>
          </button>

          {/* Factura electrónica */}
          <button
            onClick={() => onSelect('electronica')}
            className="flex items-start gap-4 p-4 rounded-xl border-2 border-slate-200 hover:border-pos-primary hover:bg-green-50 transition text-left group"
          >
            <div className="bg-slate-100 group-hover:bg-white p-3 rounded-lg text-pos-primary shrink-0">
              <FileText className="w-7 h-7" />
            </div>
            <div>
              <p className="font-bold text-slate-800">Factura Electrónica (Carta)</p>
              <p className="text-xs text-slate-500 mt-0.5">
                IVA discriminado, código QR y CUFE. Representación gráfica.
              </p>
            </div>
          </button>
        </div>

        <div className="px-5 pb-5">
          <button onClick={onClose} className="w-full py-2.5 rounded-xl border border-slate-300 text-slate-600 font-medium hover:bg-slate-50 transition">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
