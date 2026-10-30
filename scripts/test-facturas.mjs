import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

// Cargar solo la lógica pura; no necesita Tauri, una clave de API ni una base de datos real.
const fuenteFactura = await readFile(new URL('../src/utils/factura.ts', import.meta.url), 'utf8');
const codigoFactura = ts.transpileModule(fuenteFactura, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace(/import .* from ['"]\.\/alertGlobal['"];?/, 'const mostrarAlerta = async () => {};');
const moduloFactura = `data:text/javascript;base64,${Buffer.from(codigoFactura).toString('base64')}`;
const { NUEVE_CATEGORIAS_DEFECTO } = await import(moduloFactura);
const fuente = await readFile(new URL('../src/utils/importacionFactura.ts', import.meta.url), 'utf8');
const codigo = ts.transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace(/from ['"]\.\/factura['"]/, `from '${moduloFactura}'`);
const modulo = `data:text/javascript;base64,${Buffer.from(codigo).toString('base64')}`;
const { filasDesdeIA, erroresFila, proponerCoincidencia, esFilaFactura, dimensionesFactura,
  sugerirProductosExistentes, buscarProductosFactura, asociarFilaFactura } = await import(modulo);
assert.deepEqual(dimensionesFactura(6200,3100), { ancho:2560,alto:1280 });
assert.deepEqual(dimensionesFactura(3100,6200), { ancho:1280,alto:2560 });
assert.deepEqual(dimensionesFactura(1690,1472), { ancho:1690,alto:1472 });
assert.throws(() => dimensionesFactura(0,100));
const producto = { id: 1, nombre: 'Coca Cola 1.5L', nombre_etiqueta: 'COCA COLA 1.5L', codigo_barras: '0770123456789', categoria: 'Bebidas', precio_compra: 3500, precio_venta: 5000, stock: 20, stock_minimo: 1 };
assert.equal(proponerCoincidencia('Coca Cola 1.5L', '', [producto])?.id, 1);
assert.equal(proponerCoincidencia('Coca Cola 1.5L', '999', [producto]), undefined);
assert.equal(proponerCoincidencia('Coca Cola 1.5L', '', [producto, { ...producto, id: 2 }]), undefined);
assert.equal(proponerCoincidencia('Coca Cola 3L', '', [producto]), undefined);
const [existente, nuevo] = filasDesdeIA({ productos: [
  { nombre: 'COCA COLA 1.5L', codigo_barras: '0770123456789', cantidad: 20, precio_compra: 1 },
  { nombre: 'Producto nuevo', nombre_etiqueta: 'Un nombre demasiado largo', categoria: 'Categoría inventada', cantidad: 2.5, precio_compra: null, precio_venta: null },
] }, [producto]);
assert.equal(existente.producto_id, 1);
assert.equal(existente.codigo_barras, '0770123456789');
assert.equal(existente.precio_compra, 3500); // Asociar solo agrega stock, conserva la ficha.
assert.equal(existente.revisado, false);
assert.equal(nuevo.codigo_barras, ''); // La IA no genera códigos internos.
assert.equal(nuevo.categoria, NUEVE_CATEGORIAS_DEFECTO[0]);
assert.equal(nuevo.cantidad, 1);
assert.equal(nuevo.precio_venta, null);
assert.ok(nuevo.nombre_etiqueta.length <= 16);
assert.deepEqual(erroresFila(nuevo, [producto]), ['Confirmar revisión','Revisar precio de compra','Precio de venta mayor a 0']);
assert.deepEqual(erroresFila({ ...existente, revisado: true }, [producto]), []);
assert.throws(() => filasDesdeIA({ productos: [{}] }, [producto]));
assert.throws(() => filasDesdeIA({ productos: 'texto' }, [producto]));
assert.equal(filasDesdeIA({ productos: [] }, [producto]).length, 0);
const aprobado = { ...nuevo, revisado: true, categoria: 'Bebidas', cantidad: 8, precio_compra: 2000, precio_venta: 3000 };
assert.deepEqual(erroresFila(aprobado, [producto]), []);
assert.ok(erroresFila({ ...aprobado, codigo_barras: producto.codigo_barras }, [producto]).some(e => e.includes('ya existente')));
console.log('OK: extracción, revisión obligatoria, categorías, precios, cantidades, códigos y coincidencias.');
assert.equal(nuevo.nombre, 'PRODUCTO NUEVO');
assert.equal(esFilaFactura(nuevo), true);
assert.equal(esFilaFactura({ nombre: 'incompleto' }), false);
assert.equal(filasDesdeIA({ productos: [{ nombre: 'Jarrá nueva', categoria: 'BEBIDAS', cantidad: 1 }] }, [producto])[0].categoria, 'Bebidas');
assert.throws(() => filasDesdeIA({ productos: Array(501).fill({ nombre: 'X' }) }, [producto]));

// Sugerir ayuda a recordar el catálogo; nunca fusionar presentaciones por parecido.
const catalogo = [producto, { ...producto, id:2, nombre:'Coca Cola 3L', codigo_barras:'888', nombre_etiqueta:'GASEOSA GRANDE' }];
assert.equal(sugerirProductosExistentes('Coca Colla 1.5L','',catalogo)[0].producto.id,1);
assert.equal(filasDesdeIA({productos:[{nombre:'Coca Colla 1.5L'}]},catalogo)[0].producto_id,null);
assert.equal(sugerirProductosExistentes('OTRO NOMBRE','888',catalogo)[0].producto.id,2);
assert.match(sugerirProductosExistentes('Coca Cola 1.5L','999',catalogo)[0].motivo,/código diferente/);
assert.equal(filasDesdeIA({productos:[{nombre:'Coca Cola 1.5L',codigo_barras:'999'}]},catalogo)[0].producto_id,null);
assert.equal(filasDesdeIA({productos:[{nombre:'Coca Cola 2L'}]},catalogo)[0].producto_id,null);
assert.deepEqual(buscarProductosFactura('cóla 3l',catalogo).map(p => p.id),[2]);
assert.deepEqual(buscarProductosFactura('gaseosa grande',catalogo).map(p => p.id),[2]);
assert.deepEqual(buscarProductosFactura('0770123456789',catalogo).map(p => p.id),[1]);
assert.deepEqual(buscarProductosFactura('   ',catalogo),[]);
assert.deepEqual(buscarProductosFactura('no existe',catalogo),[]);
const dudosa = {...aprobado, nombre:'Coca Colla 1.5L'};
assert.ok(erroresFila(dudosa,catalogo).some(e => e.includes('Resolver las coincidencias')));
const revisada = {...dudosa, coincidencias_descartadas:sugerirProductosExistentes(dudosa.nombre,'',catalogo).map(c => c.producto.id)};
assert.deepEqual(erroresFila(revisada,catalogo),[]);
assert.ok(erroresFila({...revisada,codigo_barras:producto.codigo_barras},catalogo).some(e => e.includes('ya existente')));
const actualizado = [...catalogo,{...producto,id:3,codigo_barras:'777'}];
assert.ok(erroresFila(revisada,actualizado).some(e => e.includes('Resolver las coincidencias')));
const asociada = asociarFilaFactura(revisada,producto);
assert.equal(asociada.clave,revisada.clave);
assert.equal(asociada.cantidad,8);
assert.equal(asociada.precio_compra,3500);
assert.equal(asociada.precio_venta,5000);
assert.equal(asociada.codigo_barras,producto.codigo_barras);
assert.equal(asociada.revisado,false);
assert.equal(asociada.coincidencias_descartadas,undefined);
assert.equal(esFilaFactura(revisada),true);
assert.equal(esFilaFactura({...revisada,coincidencias_descartadas:['1']}),false);
assert.equal(esFilaFactura({...revisada,coincidencias_descartadas:[-1]}),false);
console.log('OK: búsqueda por palabras, etiqueta y código; sugerencias sin fusionar variantes; revisión explícita y catálogo actualizado.');

// Comprobar preparación y MIME de la foto con APIs de navegador simuladas, sin enviar datos.
const originales = Object.fromEntries(['FileReader','createImageBitmap','document'].map(k => [k,globalThis[k]]));
let payload, bitmapCerrado = false;
const canvas = { width:0,height:0,getContext:() => ({fillRect(){},drawImage(){}}),toBlob:callback => callback(new Blob(['jpeg optimizado'],{type:'image/jpeg'})) };
globalThis.FileReader = class {
  readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload(); }).catch(() => this.onerror()); }
};
globalThis.createImageBitmap = async () => ({ width:6200,height:3100,close(){ bitmapCerrado = true; } });
globalThis.document = { createElement:() => canvas };
globalThis.__facturaInvoke = async (comando,args) => {
  payload = args;
  if (comando === 'ejecutar_rapidocr') return '{"ok":true,"texto_filas":["PRODUCTO | 12"],"texto_completo":"PRODUCTO | 12","total_items":2}';
  if (comando === 'analizar_factura_ocr_ia') return '{"productos":[]}';
  throw new Error(`Comando inesperado: ${comando}`);
};
try {
  const fuenteServicio = await readFile(new URL('../src/services/facturaIA.ts',import.meta.url),'utf8');
  const servicioJs = ts.transpileModule(fuenteServicio,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText
    .replace(/import .* from ['"]@tauri-apps\/api\/core['"];?/, 'const invoke = (...args) => globalThis.__facturaInvoke(...args);')
    .replace(/from ['"]\.\.\/utils\/importacionFactura['"]/, `from '${modulo}'`)
    .replace(/from ['"]\.\.\/utils\/factura['"]/, `from '${moduloFactura}'`);
  const servicio = await import(`data:text/javascript;base64,${Buffer.from(servicioJs).toString('base64')}`);
  const foto = new File(['png original'],'factura.png',{type:'image/png'});
  const lectura = await servicio.ejecutarOcrFactura(foto,true);
  assert.equal(lectura.texto_completo,'PRODUCTO | 12');
  assert.equal(Buffer.from(payload.imagenBase64,'base64').toString(),'jpeg optimizado');
  assert.equal(canvas.width,2560); assert.equal(canvas.height,1280); assert.equal(bitmapCerrado,true);
  await servicio.ejecutarOcrFactura(foto,false);
  assert.equal(Buffer.from(payload.imagenBase64,'base64').toString(),'png original');
  await servicio.analizarFacturaOcrIA(lectura.texto_completo,'google','CLAVE FICTICIA','modelo',[producto]);
  assert.equal(payload.textoOcr,'PRODUCTO | 12');
  assert.equal(payload.proveedor,'google');
  globalThis.__facturaInvoke = async (comando,args) => {
    assert.equal(comando,'listar_modelos_ia');
    assert.equal(args.proveedor,'openrouter');
    assert.equal(args.apiKey,'CLAVE FICTICIA');
    return [{id:'openrouter/free',nombre:'Free Models Router',gratuito:true}];
  };
  assert.equal((await servicio.listarModelosIA(' OpenRouter ',' CLAVE FICTICIA '))[0].id,'openrouter/free');
  await assert.rejects(servicio.probarConexionIA('groq','CLAVE FICTICIA',''), /Seleccione un modelo/);
  await assert.rejects(servicio.analizarFacturaOcrIA('TEXTO','groq','CLAVE FICTICIA','',[producto]), /Seleccione un modelo/);
  globalThis.__facturaInvoke = async (comando,args) => {
    assert.equal(comando,'analizar_factura_ocr_ia'); payload = args; return '{"productos":[]}';
  };
  assert.deepEqual(await servicio.analizarFacturaOcrIA('TEXTO','openrouter','CLAVE FICTICIA','openrouter/free',[producto]),[]);
  assert.equal(payload.modelo,'openrouter/free');
  globalThis.__facturaInvoke = async () => { throw 'Falta un recurso de RapidOCR'; };
  await assert.rejects(servicio.ejecutarOcrFactura(foto,false), /Falta un recurso/);
  globalThis.__facturaInvoke = async () => '{"ok":false,"error":"Imagen ilegible"}';
  await assert.rejects(servicio.ejecutarOcrFactura(foto,false), /Imagen ilegible/);
  console.log('OK: foto optimizada, bytes originales, respuesta OCR, análisis de texto y errores; ninguna petición real.');
} finally {
  for (const [k,v] of Object.entries(originales)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  delete globalThis.__facturaInvoke;
}

// Ejecutar las funciones reales de productos, movimientos y progreso sobre SQLite temporal.
const temporal = await mkdtemp(join(tmpdir(), 'magaji-facturas-'));
const sqlPython = `
import json,sqlite3,sys
p=json.load(sys.stdin)
c=sqlite3.connect(p['path']);c.row_factory=sqlite3.Row
r=c.execute(p['sql'],p.get('args',[]))
result=[dict(v) for v in r.fetchall()] if p['select'] else dict(lastInsertId=r.lastrowid,rowsAffected=r.rowcount)
c.commit();c.close();print(json.dumps(result))
`;
const query = (sql, args = [], select = false) => {
  const result = spawnSync('python', ['-c', sqlPython], { input: JSON.stringify({ path: join(temporal,'prueba.db'),sql,args,select }),encoding:'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
};
let interrumpir = false;
globalThis.__facturaTestDb = {
  select: async (sql,args) => query(sql,args,true),
  execute: async (sql,args) => {
    if (interrumpir && sql.startsWith('UPDATE importaciones_factura SET estado')) throw new Error('Corte simulado');
    return query(sql,args);
  },
};
try {
  query('CREATE TABLE productos (id INTEGER PRIMARY KEY AUTOINCREMENT,codigo_barras TEXT UNIQUE NOT NULL,nombre TEXT,nombre_etiqueta TEXT,categoria TEXT,precio_compra REAL,precio_venta REAL,stock INTEGER,stock_minimo INTEGER)');
  query('CREATE TABLE movimientos_inventario (id INTEGER PRIMARY KEY AUTOINCREMENT,producto_id INTEGER,tipo TEXT,cantidad INTEGER,motivo TEXT)');
  const dbSource = await readFile(new URL('../src/database/db.ts',import.meta.url),'utf8');
  const dbJs = ts.transpileModule(dbSource,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText
    .replace(/import Database from ['"]@tauri-apps\/plugin-sql['"];?/, 'const Database = { load: async () => globalThis.__facturaTestDb };')
    .replace(/from ['"]\.\.\/utils\/importacionFactura['"]/, `from '${modulo}'`);
  const db = await import(`data:text/javascript;base64,${Buffer.from(dbJs).toString('base64')}`);
  await db.crearProducto(producto);
  const fila = { ...existente, clave:'entrada-1',revisado:true,cantidad:5 };
  assert.equal(await db.importarFilaFactura(fila),1);
  assert.equal(await db.importarFilaFactura(fila),1); // Reintentar no vuelve a sumar.
  assert.equal((await db.obtenerProductos())[0].stock,25);
  assert.equal((await db.obtenerProductos())[0].precio_venta,5000);
  await assert.rejects(() => db.importarFilaFactura({...dudosa,clave:'duplicada'}),/Resolver las coincidencias/);
  assert.equal(query('SELECT COUNT(*) AS total FROM productos',[],true)[0].total,1);
  assert.equal(query('SELECT COUNT(*) AS total FROM importaciones_factura WHERE clave = ?', ['duplicada'],true)[0].total,0);
  const nuevoId = await db.importarFilaFactura({ ...aprobado,clave:'nuevo-1',nombre:'  prueba de factura  ',nombre_etiqueta:'etiqueta nueva' });
  const creado = (await db.obtenerProductos()).find(p => p.id === nuevoId);
  assert.equal(creado.nombre,'PRUEBA DE FACTURA');
  assert.equal(creado.nombre_etiqueta,'ETIQUETA NUEVA');
  assert.equal(creado.stock,8);
  assert.equal(creado.codigo_barras,'20000011'); // Generador EAN-8 existente, checksum incluido.
  assert.equal(query('SELECT COUNT(*) AS total FROM movimientos_inventario',[],true)[0].total,3);
  interrumpir = true;
  await assert.rejects(() => db.importarFilaFactura({ ...fila,clave:'interrumpida' }), /interrumpi/);
  interrumpir = false;
  const stockAntes = (await db.obtenerProductos()).find(p => p.id === 1).stock;
  await assert.rejects(() => db.importarFilaFactura({ ...fila,clave:'interrumpida' }), /interrumpida/);
  assert.equal((await db.obtenerProductos()).find(p => p.id === 1).stock,stockAntes);
  assert.equal((await db.obtenerProgresoFactura(['entrada-1','interrumpida'])).length,2);
  console.log('OK: SQLite temporal, altas con código automático, entrada de stock sin cambiar precios, reintentos sin duplicar y recuperación bloqueada tras interrupción.');
} finally {
  delete globalThis.__facturaTestDb;
  assert.ok(temporal.startsWith(join(tmpdir(), 'magaji-facturas-')));
  await rm(temporal,{recursive:true,force:true});
}
