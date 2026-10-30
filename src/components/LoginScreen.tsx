import { useState, useRef, useEffect } from 'react';
import { Eye, EyeOff, Lock, LogIn, AlertCircle } from 'lucide-react';
import { verificarPassword, hayPasswordPersonalizado } from '../utils/auth';

interface Props {
  onLogin: () => void;
}

export default function LoginScreen({ onLogin }: Props) {
  const [password, setPassword] = useState('');
  const [mostrarPass, setMostrarPass] = useState(false);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [agitando, setAgitando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const esDefault = !hayPasswordPersonalizado();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setCargando(true);
    setError('');
    try {
      const ok = await verificarPassword(password);
      if (ok) {
        onLogin();
      } else {
        setError('Contraseña incorrecta. Inténtalo de nuevo.');
        setPassword('');
        // Animación de agitado
        setAgitando(true);
        setTimeout(() => setAgitando(false), 500);
        inputRef.current?.focus();
      }
    } catch {
      setError('Error al verificar la contraseña.');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center z-50">
      {/* Fondo decorativo */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
      </div>

      <div
        className={`relative w-full max-w-sm mx-4 pos-modal-panel ${agitando ? 'animate-[agitar_0.4s_ease-in-out]' : ''}`}
        style={agitando ? { animation: 'agitar 0.4s ease-in-out' } : {}}
      >
        {/* Tarjeta */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">

          {/* Avatar / Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/30 mb-4">
              <Lock className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-xl font-bold text-white">
              {'MAGAJI'}
            </h1>
            <p className="text-slate-400 text-sm mt-1">Administrador</p>
          </div>

          {/* Aviso de contraseña por defecto */}
          {esDefault && (
            <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5 mb-5">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300">
                Usando contraseña por defecto: <span className="font-bold font-mono">admin</span>. Cámbiala en Configuración → Contraseña.
              </p>
            </div>
          )}

          {/* Formulario */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  type={mostrarPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Ingresa tu contraseña"
                  autoComplete="current-password"
                  className="w-full bg-white/10 border border-white/15 rounded-xl px-4 py-3 pr-12 text-white placeholder-slate-500 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 transition"
                />
                <button
                  type="button"
                  onClick={() => setMostrarPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition p-1"
                  tabIndex={-1}
                >
                  {mostrarPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={cargando || !password}
              className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition shadow-lg shadow-emerald-500/20 text-sm"
            >
              {cargando ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              {cargando ? 'Verificando...' : 'Entrar'}
            </button>
          </form>

          {/* Footer */}
          <p className="text-center text-slate-600 text-xs mt-6">
            Magaji · Inventario v0.1
          </p>
        </div>
      </div>

      {/* Keyframe de agitado inline */}
      <style>{`
        @keyframes agitar {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}
