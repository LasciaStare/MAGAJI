# MAGAJI
# POS System

Professional point-of-sale inventory management system built with Tauri, React, and TypeScript.

## Project Status

In active development.

### OCR incluido en Windows (1.2.6)

La lectura de facturas usa RapidOCR en Rust con modelos PP-OCRv6 Small incluidos en el instalador. No requiere Python en la PC del usuario. El motor trabaja localmente; el análisis posterior con IA requiere conexión y una clave configurada.

`npm run tauri build` prepara los recursos verificados y genera el instalador Windows x64. WebView2 se reutiliza si ya está instalado y solo se descarga cuando falta. Véase [distribución de OCR](docs/OCR-DISTRIBUCION.md) para requisitos, licencias y pruebas.

### Modelos de IA disponibles (1.2.7)

Los ajustes de IA de Configuración e Importar factura consultan el catálogo actual de Groq, OpenRouter o Google mediante **Actualizar modelos**. Incluyen búsqueda y filtro de gratuitos en OpenRouter, con soporte para `openrouter/free`. Véase [selección de modelos](docs/MODELOS-IA.md).

## Stack

- Tauri v2 (desktop application for Windows, macOS, Linux)
- React 19 with TypeScript (strict mode)
- Tailwind CSS v4
- SQLite database
- React Router v7 for navigation
- Vite as build tool

## Quick Start

### Prerequisites

- Node.js 22+ and npm
- Rust toolchain (for Tauri)
- Git

### Installation

```bash
git clone https://github.com/LasciaStare/MAGAJI
cd MAGAJI
npm install
```

### Development

```bash
# Full development mode (Tauri + frontend)
npm run tauri dev

# Frontend only in browser
npm run dev

# Type-check and build
npm run build

# Preview production build
npm run preview

# Compile Rust backend only
cd src-tauri && cargo build
```

## Architecture

### High-Level Design

The application follows a clear separation of concerns:

1. Frontend (React/TypeScript) - User interface, routing, state management
2. Middleware (TypeScript services) - Business logic, data validation, calculations
3. Database Layer (SQLite) - Persistent data storage
4. Tauri Backend (Rust) - Window management and plugin initialization

All business logic resides in TypeScript. The Rust backend only initializes Tauri plugins and manages the application window.

### Database Schema

Core tables:

- **productos** - Product catalog with barcode, pricing, and stock
- **clientes** - Customer directory and contact information
- **ventas** - Sales transactions (invoice headers)
- **venta_detalles** - Sale line items with product references
- **movimientos_inventario** - Inventory audit trail
- **fundaciones** - Organizations for member-type customers

Foreign key constraints enforce data integrity.

### Key Features

1. Sales Management - Process sales with customer tracking and payment methods
2. Inventory Control - Stock tracking with minimum thresholds and movement history
3. Product Catalog - EAN-13 barcode support with automatic code generation for products without factory barcodes
4. Customer Database - Customer information with classification and membership tracking
5. Reports - Sales and inventory reports with data export
6. Label Printing - Generate and print product labels with barcodes

### Impresión masiva de etiquetas (1.1.2)

En **Etiquetas**, busque por nombre, nombre de etiqueta o código y filtre por categoría.
Marque productos individualmente o use **Seleccionar todos** para los resultados visibles;
las selecciones se conservan al cambiar el filtro. Use **Shift + clic** en la fila o casilla
para marcar o desmarcar un rango de productos visibles.

Elija **Según stock** para imprimir una etiqueta por unidad disponible, o **Personalizada por
producto** para escribir cuántas etiquetas quiere de cada seleccionado (inicialmente 1).
En modo personalizado puede imprimir incluso productos sin stock o más etiquetas que el stock.

La tabla muestra nombre, nombre de etiqueta, código, categoría, compra, venta, stock y cantidad
de etiquetas. **Revisar e imprimir** consulta el inventario actual y muestra los seleccionados
antes de confirmar, con stock y cantidad de etiquetas separados. Si cambia el stock o algún
dato del producto después de revisar, se actualiza la revisión antes de permitir la impresión.
Se conserva el formato TSPL de tres columnas y el nombre impreso de máximo 16 caracteres.
El límite por trabajo es de 50.000 etiquetas.

### Importar facturas con Gemini (1.2.0)

En **Inventario → Importar factura con IA**, introduzca su clave de Google AI Studio,
suba una foto JPG, PNG o WebP (máximo 10 MB), o tome una fotografía con la cámara.
Seleccione Gemini Flash y pulse **Analizar factura con Gemini**.

Revise la tabla editable: nombres, etiqueta, cantidades, costos, precios de venta, categoría
y código de barras. Los datos ilegibles quedan pendientes de corrección. Los nuevos nombres
se guardan en mayúsculas; la etiqueta admite máximo 16 caracteres y la categoría debe existir.
Si un artículo coincide por código o por nombre exacto único, se propone asociarlo al producto
existente. Puede cambiar la asociación; los productos existentes solo reciben stock y conservan
sus precios. Los nuevos reutilizan el generador EAN-8 y la creación habitual de productos.

La asociación usa búsqueda por palabras, etiqueta o código, con resultados que muestran stock
y categoría. Los nombres parecidos aparecen como sugerencias: hay que elegir el producto o
confirmar expresamente que se trata de otro antes de crearlo. El parecido nunca asocia por sí
solo dos presentaciones. Al elegir un producto se muestra el stock actual y cuánto quedaría.
Las coincidencias se vuelven a comprobar con el catálogo actualizado antes de guardar.

Marque las filas revisadas y confirme para guardar. El borrador se conserva localmente y cada
fila tiene progreso persistente para impedir que un reintento duplique el ingreso. Si una escritura
queda interrumpida, esa fila se bloquea: revise stock e historial antes de eliminarla del borrador
y completar manualmente lo pendiente. Luego puede abrir Etiquetas con los productos importados.
Las dos opciones de cantidades y la selección con Shift se mantienen.

La clave no se guarda ni se incluye en el instalador. Solo la foto y las categorías se envían
a Google; Gemini no accede a la base. Use un proyecto sin facturación habilitada para limitarse
al nivel gratuito, sujeto a las cuotas de Google. Consulte [precios y condiciones](https://ai.google.dev/gemini-api/docs/pricing).
En el nivel gratuito Google puede utilizar el contenido para mejorar sus productos.

Pruebas: `npm run test:facturas` (incluye SQLite temporal, requiere Python),
`npm run test:etiquetas`, `cargo test --release --lib` desde `src-tauri`.

Desde 1.2.2, las solicitudes utilizan razonamiento bajo en 3.8 y mínimo en 3.5 para reducir
latencia. Las fotos grandes se ajustan a un máximo de 2560 píxeles y se comprimen en JPEG
de calidad alta; puede desactivar esta opción si necesita enviar la imagen original.
La ventana muestra el tamaño enviado y el tiempo de espera. Los rechazos muestran modelo,
código HTTP y detalle de Google, ocultando la clave. El acceso y las cuotas de cada modelo
dependen del proyecto; 2.5 está limitado por Google a usuarios anteriores.

Desde 1.2.3 se utilizan los valores REST `low` y `minimal` en minúsculas. Si Google
rechaza el razonamiento opcional o devuelve el error genérico de argumento inválido,
se reintenta una sola vez sin `thinkingConfig`, conservando imagen, instrucciones y esquema.
No se reintenta automáticamente ante cuotas, permisos ni timeouts. Los errores incluyen
los detalles adicionales del proveedor cuando existen, siempre ocultando la clave.

Desde 1.2.4 se utiliza `generationConfig.responseFormat.text.schema`, según el formato REST
actual de Google. El reintento compatible pide JSON sin esquema del proveedor ni parámetros
de razonamiento; los datos siguen pasando la validación local y la revisión antes de guardar.
**Probar conexión** envía un texto breve sin foto ni esquema de factura y utiliza una solicitud
de la cuota. Sirve para separar el acceso al modelo de problemas con los datos enviados.

Desde 1.2.5, `responseFormat.text.mimeType` envía el enum REST `APPLICATION_JSON`.
El MIME de las fotos permanece como `image/jpeg`, `image/png` o `image/webp`.
La prueba de transporte HTTP verifica el valor del enum antes de aceptar la solicitud.

Verificación: `npm run test:etiquetas`. Instalador Windows: `npm run tauri -- build --bundles nsis`.

## Barcode System

The system supports two barcode modes:

1. Factory Barcodes - Real manufacturer codes scanned or entered manually (any digit count)
2. Internal RCN Codes - Auto-generated EAN-13 codes for products without factory barcodes

When creating a product:
- If a barcode is provided: validated (numbers only) and checked for uniqueness
- If barcode field is empty: system auto-generates an EAN-13 code with format:
  - Prefix: 20 (GS1-reserved for proprietary use)
  - Consecutive: 10-digit padded sequence
  - Checksum: EAN-13 standard algorithm (1 digit)
  - Example: consecutive 15 yields "2000000000152"

This ensures no barcode conflicts and enables internal product identification without factory codes.

For complete details, see `docs/CODIGOS_BARRAS.md`.

## File Structure

```
src/
  components/          - Reusable React components
  database/           - SQLite connection and data access layer
  pages/              - Full-page components (Ventas, Productos, etc.)
  services/           - Business logic and external service integrations
  utils/              - Helper functions and utilities
  config/             - Application configuration
  App.tsx             - Main app component with routing
  App.css             - Tailwind CSS with design tokens

src-tauri/
  src/                - Rust backend code
  Cargo.toml          - Rust dependencies

docs/
  CODIGOS_BARRAS.md   - Barcode system documentation

.github/
  copilot-instructions.md - Copilot AI assistant guidelines
```

## Development Guidelines

### TypeScript

- Strict mode enabled (`strict: true`)
- No `any` types without discussion
- All data must be typed
- Unused variables/parameters will cause build errors

### Components

- Functional components with hooks only (no class components)
- Props must be typed with interfaces
- Use Spanish domain variable names (producto, venta, cliente, stock, cantidad)

### Database Access

Always use `getDbConnection()` from `src/database/db.ts`. Never call `Database.load()` directly.

```typescript
import { getDbConnection, crearProducto, type Producto } from '../database/db';

const db = await getDbConnection();
const nuevoProducto = await crearProducto(producto);
```

### Error Handling

Use `ErrorNegocio` class for business logic errors:

```typescript
import { ErrorNegocio, mensajeError } from '../database/db';

throw new ErrorNegocio('CODIGO_DUPLICADO', 'Ya existe un producto con ese código de barras.');
```

The UI automatically translates error codes to user-friendly messages.

### Styling

Tailwind CSS v4 with custom design tokens in `src/App.css`:

- `pos-dark`: #1e293b (sidebar)
- `pos-bg`: #f1f5f9 (main background)
- `pos-primary`: #10b981 (primary accent)
- `pos-primary-dark`: #059669 (hover states)

Use in classes: `bg-pos-primary`, `text-pos-dark`, etc.

## Testing

No test runner configured yet. Manual testing is required.

For barcode algorithm validation, see `src/utils/ean13-tests.ts`:

```typescript
import { testEAN8Checksum, debugEAN8 } from '../utils/ean13-tests';

testEAN8Checksum();  // Run automated tests
debugEAN8("2000015");  // Debug specific code
```

## Configuration

Application configuration is stored in localStorage via `src/utils/factura.ts`:

```typescript
import { obtenerConfigNegocio, guardarConfigNegocio } from '../utils/factura';

const config = obtenerConfigNegocio();
config.ivaPorcentaje = 19;
guardarConfigNegocio(config);
```

## Database

- File location: `inventario.db` (SQLite)
- Auto-initialized on app startup via `initDB()`
- Schema migrations handled with ALTER TABLE statements
- Backup service available in `src/services/backup.ts`

## Authentication

Login system implemented via `LoginScreen.tsx`. Users must authenticate before accessing application features.

## Contributing

1. Follow TypeScript strict mode guidelines
2. Use semantic commits
3. Update relevant documentation when changing features
4. Ensure `npm run build` passes before committing
5. Test manual workflows that affect user-facing features

## IDE Setup

Recommended tools:

- VS Code with Tauri extension
- VS Code Rust Analyzer extension
- TypeScript language server support

## License

See LICENSE file for details.

## Author

Created by Jose & Christian Menco for inventory and sales management.
