import { useEffect } from 'react';
import { AlertTriangle, XCircle, Info } from 'lucide-react';
import type { TipoAlerta } from '../utils/alertGlobal';

interface AlertModalProps {
  mensaje: string;
  tipo: TipoAlerta;
  titulo?: string;
  onClose: () => void;
}

const CONFIG = {
  error: {
    Icon: XCircle,
    iconClass: 'text-red-500',
    bgClass: 'bg-red-50',
    borderClass: 'border-red-100',
    btnClass: 'bg-red-500 hover:bg-red-600 focus:ring-red-300',
    defaultTitulo: 'Error',
  },
  advertencia: {
    Icon: AlertTriangle,
    iconClass: 'text-amber-500',
    bgClass: 'bg-amber-50',
    borderClass: 'border-amber-100',
    btnClass: 'bg-amber-500 hover:bg-amber-600 focus:ring-amber-300',
    defaultTitulo: 'Advertencia',
  },
  info: {
    Icon: Info,
    iconClass: 'text-blue-500',
    bgClass: 'bg-blue-50',
    borderClass: 'border-blue-100',
    btnClass: 'bg-pos-primary hover:bg-pos-primary-dark focus:ring-emerald-300',
    defaultTitulo: 'Información',
  },
};

export default function AlertModal({ mensaje, tipo, titulo, onClose }: AlertModalProps) {
  const { Icon, iconClass, bgClass, borderClass, btnClass, defaultTitulo } = CONFIG[tipo];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 pos-overlay-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden pos-modal-panel"
        onClick={e => e.stopPropagation()}
      >
        <div className={`${bgClass} border-b ${borderClass} px-6 py-5 flex items-center gap-4`}>
          <div className={`${bgClass} border ${borderClass} rounded-xl p-2.5 shrink-0`}>
            <Icon className={`w-6 h-6 ${iconClass}`} />
          </div>
          <h3 className="font-bold text-slate-800 text-base leading-tight">
            {titulo ?? defaultTitulo}
          </h3>
        </div>

        <div className="px-6 py-5">
          <p className="text-sm text-slate-600 leading-relaxed">{mensaje}</p>
        </div>

        <div className="px-6 pb-6 flex justify-end">
          <button
            autoFocus
            onClick={onClose}
            className={`${btnClass} text-white font-semibold px-6 py-2 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-offset-2`}
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
