import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Package, Users, Settings, Tags, BarChart, Barcode } from 'lucide-react';

const navItems = [
  { icon: LayoutDashboard, label: 'Ventas', path: '/' },
  { icon: Package, label: 'Inventario', path: '/inventario' },
  { icon: Tags, label: 'Productos', path: '/productos' },
  { icon: Barcode, label: 'Etiquetas', path: '/etiquetas' },
  { icon: Users, label: 'Clientes', path: '/clientes' },
  { icon: BarChart, label: 'Reportes', path: '/reportes' },
];

export const Sidebar = () => {
  const location = useLocation();

  return (
    <aside className="w-64 bg-pos-dark text-slate-200 p-4 flex flex-col h-full shrink-0">
      <div className="text-2xl font-bold text-white mb-10 flex items-center gap-2">
        <Package className="w-8 h-8 text-pos-primary" />
        MAGAJI
      </div>

      <nav className="space-y-2 flex-grow">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path || (item.path === '/' && location.pathname === '/ventas');
          return (
            <Link
              key={item.label}
              to={item.path}
              className={`flex items-center gap-3 p-3 rounded-lg transition-all hover:translate-x-1 ${isActive ? 'bg-pos-primary/20 text-pos-primary border border-pos-primary/30' : 'hover:bg-slate-700/50'}`}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              <span className="flex-grow">{item.label}</span>
            </Link>
          )
        })}
        
        <div className="pt-4 mt-4 border-t border-slate-700/50">
            <Link to="/configuracion" className="flex items-center gap-3 w-full text-slate-400 hover:text-slate-200 p-3 rounded-lg hover:bg-slate-700/50 transition-all hover:translate-x-1">
                <Settings className="w-5 h-5"/>
                <span className="flex-grow text-left">Configuración</span>
            </Link>
        </div>
      </nav>
    </aside>
  );
};