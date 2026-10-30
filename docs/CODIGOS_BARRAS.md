# Sistema de Códigos de Barras EAN-13 con RCN

## Descripción General

El sistema maneja dos tipos de códigos de barras:

1. **Códigos de Fábrica**: Códigos reales escaneados del empaque del producto (cualquier número de dígitos)
2. **Códigos RCN Internos**: Códigos EAN-13 auto-generados para productos sin barcode de fábrica

## Flujo de Registro de Producto

### Escenario 1: Usuario escanea un código de barras

```
Usuario escanea código de fábrica
         ↓
Input: "7501234567890"
         ↓
Validación: ¿Solo números? ✓ Sí
         ↓
¿Ya existe en BD? → Si: Error "Código duplicado"
                  → No: Guardar directamente
         ↓
Producto creado con código: "7501234567890"
```

### Escenario 2: Usuario no ingresa código de barras

```
Usuario deja campo vacío o null
         ↓
Sistema genera RCN automático
         ↓
1. Obtener siguiente consecutivo: N = MAX(códigos RCN) + 1
   Ejemplo: Si existe hasta 50, siguiente = 51
         ↓
2. Formatear base 12 dígitos: "20" + "0000000051"
   Resultado: "200000000051"
         ↓
3. Calcular checksum EAN-13 (módulo 10)
   Algoritmo:
   - Multiplicar cada dígito por peso (1 o 3, alternado)
   - Sumar resultados
   - Aplicar módulo 10
   - Restar de 10
   Resultado: "6"
         ↓
4. Concatenar: "200000000051" + "6" = "2000000000516"
         ↓
Producto creado con código: "2000000000516" (EAN-13 válido)
```

## Formato de Código RCN

- **Total**: 13 dígitos (EAN-13 estándar)
- **Estructura**: `20` + `10 dígitos consecutivo` + `1 dígito verificador`

### Ejemplos:

| Consecutivo | Base          | Checksum | Código Final      |
|-------------|---------------|----------|-------------------|
| 1           | 200000000001  | 8        | 2000000000018     |
| 15          | 200000000015  | 2        | 2000000000152     |
| 1000        | 200000001000  | 7        | 2000000010007     |
| 10000       | 200000010000  | 4        | 2000000100004     |

## Garantía de Unicidad

- Todos los códigos RCN comienzan con `20`, diferenciándolos de códigos reales
- El campo `codigo_barras` en la BD es UNIQUE
- Antes de insertar o actualizar, se valida que no exista duplicado
- El consecutivo auto-incrementa, garantizando sin "huecos"

## Función de Checksum EAN-8

El algoritmo implementado en `src/database/db.ts`:

```typescript
export function calcularChecksumEAN8(base: string): string {
  let suma = 0;
  for (let i = 0; i < 7; i++) {
    const digito = parseInt(base[i], 10);
    const peso = (i % 2 === 0) ? 3 : 1;  // Alterna 3, 1, 3, 1, ...
    suma += digito * peso;
  }
  const checksum = (10 - (suma % 10)) % 10;
  return checksum.toString();
}
```

### Validación Manual (ejemplo: 2000015)

| Pos | Dígito | Peso | Contribución |
|-----|--------|------|--------------|
| 0   | 2      | 3    | 6            |
| 1   | 0      | 1    | 0            |
| 2   | 0      | 3    | 0            |
| 3   | 0      | 1    | 0            |
| 4   | 0      | 3    | 0            |
| 5   | 1      | 1    | 1            |
| 6   | 5      | 3    | 15           |
| **Suma**: 22 → Módulo 10: 2 → Checksum: (10 - 2) % 10 = **8** |

## APIs Exportadas

### `generarCodigoRCN(): Promise<string>`

Genera un nuevo código EAN-8 RCN automáticamente.

```typescript
const codigoNuevo = await generarCodigoRCN();
// Ejemplo retorno: "20000158"
```

### `calcularChecksumEAN8(base: string): string`

Calcula el dígito verificador para una base de 7 dígitos.

```typescript
const checksum = calcularChecksumEAN8("2000015");
// Retorna: "8"
```

### `obtenerSiguienteConsecutivoRCN(): Promise<number>`

Obtiene el próximo consecutivo disponible (interno, generalmente no necesitas usar).

```typescript
const siguiente = await obtenerSiguienteConsecutivoRCN();
// Ejemplo retorno: 101
```

### `esCodigoBarrasValido(codigo: string): boolean`

Valida que un código contenga solo números.

```typescript
esCodigoBarrasValido("7501234567890");  // true
esCodigoBarrasValido("INVALID-123");    // false
```

### `codigoBarrasYaExiste(codigo: string, productoIdExcluir?: number): Promise<boolean>`

Verifica si un código ya está registrado en BD.

```typescript
const existe = await codigoBarrasYaExiste("7501234567890");
// Si es true, no se puede crear ese producto

// Al editar, excluir el mismo producto:
const existe = await codigoBarrasYaExiste("7501234567890", productoIdExcluir: 42);
// Ahora retorna true solo si OTRO producto tiene ese código
```

## Testing

Para verificar que el algoritmo funciona correctamente, hay utilidades en `src/utils/ean13-tests.ts`:

```typescript
import { testEAN8Checksum, debugEAN8 } from '../utils/ean13-tests';

// Ejecutar tests
testEAN8Checksum();

// Debug detallado de un código
debugEAN8("2000015");
```

## Notas Importantes

- **El campo `codigo_barras` NO puede ser NULL** — si está vacío, se genera automáticamente
- **Los códigos generados comienzan con "20"** — prefijo reservado internacionalmente en GS1 para uso propietario
- **El consecutivo es independiente del ID del producto** — un producto eliminado no "libera" su consecutivo
- **La BD no mantiene una tabla de secuencia** — el consecutivo se calcula buscando el máximo existente
- **La operación de generación es atómica** — si dos productos se crean simultáneamente, SQLite previene duplicados
