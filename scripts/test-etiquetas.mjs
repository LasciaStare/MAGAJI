import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const cargar = async (ruta, reemplazos = []) => {
  let codigo = ts.transpileModule(await readFile(new URL(ruta, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [patron, valor] of reemplazos) codigo = codigo.replace(patron, valor);
  return import(`data:text/javascript;base64,${Buffer.from(codigo).toString('base64')}`);
};
const { etiquetasParaImprimir, cambioRevisionEtiquetas, seleccionarRango } = await cargar('../src/utils/seleccionEtiquetas.ts');
const { nombreParaEtiqueta, generarTSPL, imprimirEtiquetasTSPL } = await cargar('../src/utils/tspl.ts', [
  [/import .* from ['"]\.\/factura['"];?/, 'const obtenerConfigNegocio = () => ({ impresoraEtiquetas: "TEST" });'],
  [/import .* from ['"]\.\.\/database\/db['"];?/, 'class ErrorNegocio extends Error { constructor(code, message) { super(message); this.code = code; } }'],
]);
const crear = (id, stock) => ({ id, codigo_barras: String(20000011 + id), nombre: `Producto ${id}`, nombre_etiqueta: `ETIQUETA ${id}`,
  categoria: 'HOGAR', precio_compra: 3500, precio_venta: 5000, stock, stock_minimo: 1 });
const productos = [crear(1,20),crear(2,15),crear(3,8),crear(4,0)];
const items = etiquetasParaImprimir(productos, [1,2,3,3,4,999]);
assert.equal(items.length, 3);
assert.equal(items.reduce((suma, item) => suma + item.cantidad, 0), 43);
const etiquetas = generarTSPL(items.flatMap(item => Array(item.cantidad).fill(item.producto)));
assert.equal(etiquetas.length, 15); // 43 etiquetas repartidas en filas de 3.
assert.equal((etiquetas.join('').match(/BARCODE /g) ?? []).length, 43);
assert.equal((etiquetas.join('').match(/"ETIQUETA 1"/g) ?? []).length, 20);
assert.equal(nombreParaEtiqueta({ ...productos[0], nombre_etiqueta: 'áéíóúñ nombre demasiado largo' }), 'AEIOUN NOMBRE DE');
assert.equal(nombreParaEtiqueta({ ...productos[0], nombre_etiqueta: 'áéíóúñ nombre demasiado largo' }).length, 16);
assert.equal(nombreParaEtiqueta({ ...productos[0], nombre_etiqueta: '' }), 'PRODUCTO 1');
assert.equal(cambioRevisionEtiquetas(items, [...items].reverse()), false);
for (const campo of ['nombre','nombre_etiqueta','codigo_barras','categoria','precio_compra','precio_venta']) {
  const modificados = productos.map(p => p.id === 1 ? { ...p, [campo]: typeof p[campo] === 'number' ? p[campo] + 1 : `${p[campo]} cambio` } : p);
  assert.equal(cambioRevisionEtiquetas(items, etiquetasParaImprimir(modificados, [1,2,3])), true, campo);
}
assert.equal(cambioRevisionEtiquetas(items, etiquetasParaImprimir(productos.map(p => p.id === 1 ? { ...p, stock: 21 } : p), [1,2,3])), true);
assert.equal(cambioRevisionEtiquetas(items, etiquetasParaImprimir(productos.filter(p => p.id !== 1), [1,2,3])), true);
const muchos = Array.from({ length: 75 }, (_, i) => crear(i + 1, 1));
assert.equal(etiquetasParaImprimir(muchos, muchos.map(p => p.id)).length, 75);
assert.equal(etiquetasParaImprimir([crear(1,-1),crear(2,1.5)], [1,2]).length, 0);
await assert.rejects(() => imprimirEtiquetasTSPL([{ producto: productos[0], cantidad: 1.5 }]), /entero/);
await assert.rejects(() => imprimirEtiquetasTSPL([{ producto: productos[0], cantidad: 50001 }]), /50.000/);
console.log('OK: 43 etiquetas según stock; selección sin duplicados ni límite de 50 productos; revisión detecta cambios; nombre exacto máximo 16; formato TSPL existente.');

const personalizadas = etiquetasParaImprimir(productos, [1,2,4], { 1: 2, 2: 30, 4: 5 });
assert.deepEqual(personalizadas.map(i => i.cantidad), [2,30,5]); // Independientes del stock, incluso stock cero.
assert.equal(etiquetasParaImprimir(productos, [1], {})[0].cantidad, 1);
assert.equal(etiquetasParaImprimir(productos, [1], { 1: NaN })[0].cantidad.toString(), 'NaN');
assert.equal(cambioRevisionEtiquetas(personalizadas, etiquetasParaImprimir(productos.map(p => p.id === 1 ? { ...p, stock: 99 } : p), [1,2,4], { 1: 2, 2: 30, 4: 5 })), true);
assert.deepEqual(etiquetasParaImprimir(productos.map(p => ({ ...p, stock: 99 })), [1,2,4], { 1: 2, 2: 30, 4: 5 }).map(i => i.cantidad), [2,30,5]);
assert.deepEqual(seleccionarRango([99,1], [1,2,3,4], 1,4,true,true), [99,1,2,3,4]);
assert.deepEqual(seleccionarRango([4], [1,2,3,4], 4,1,true,true), [4,1,2,3]);
assert.deepEqual(seleccionarRango([99,1,2,3,4], [1,2,3,4], 2,4,true,false), [99,1]);
assert.deepEqual(seleccionarRango([1], [1,3,4], 1,4,true,true), [1,3,4]); // No marca productos ocultos.
assert.deepEqual(seleccionarRango([99], [1,2,3], 99,3,true,true), [99,3]); // Ancla fuera del filtro.
assert.deepEqual(seleccionarRango([], [1,2,3], null,3,true,true), [3]);
assert.deepEqual(seleccionarRango([1], [1,2,3], 1,3,false,true), [1,3]);
console.log('OK: cantidades personalizadas independientes del stock; Shift selecciona/deselecciona rangos visibles en ambos sentidos.');
