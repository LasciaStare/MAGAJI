import type { Producto } from '../database/db';
import type { ItemEtiqueta } from './tspl';

export function etiquetasParaImprimir(productos: Producto[], ids: number[], cantidades?: Record<number, number>): ItemEtiqueta[] {
  const seleccion = new Set(ids);
  return productos.filter(p => p.id !== undefined && seleccion.has(p.id) &&
    (cantidades !== undefined || (Number.isSafeInteger(p.stock) && p.stock > 0)))
    .map(producto => ({ producto, cantidad: cantidades === undefined ? producto.stock : (cantidades[producto.id!] ?? 1) }));
}

export function seleccionarRango(seleccionados: number[], visibles: number[], ancla: number | null, id: number, shift: boolean, marcar: boolean): number[] {
  const inicio = ancla === null ? -1 : visibles.indexOf(ancla);
  const fin = visibles.indexOf(id);
  const rango = shift && inicio >= 0 && fin >= 0 ? visibles.slice(Math.min(inicio, fin), Math.max(inicio, fin) + 1) : [id];
  const seleccion = new Set(seleccionados);
  for (const productoId of rango) { if (marcar) seleccion.add(productoId); else seleccion.delete(productoId); }
  return [...seleccion];
}

/** Si cambió cualquier dato mostrado en la revisión, hay que revisarlo otra vez. */
export function cambioRevisionEtiquetas(anterior: ItemEtiqueta[], actual: ItemEtiqueta[]): boolean {
  if (anterior.length !== actual.length) return true;
  return anterior.some(item => {
    const nuevo = actual.find(i => i.producto.id === item.producto.id);
    return !nuevo || nuevo.cantidad !== item.cantidad ||
      (['nombre', 'nombre_etiqueta', 'codigo_barras', 'precio_compra', 'precio_venta', 'categoria', 'stock'] as const)
        .some(campo => nuevo.producto[campo] !== item.producto[campo]);
  });
}
