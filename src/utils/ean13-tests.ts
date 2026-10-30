/**
 * Utilidades de prueba para validar la generación de códigos EAN-8 RCN.
 * NO incluir en producción. Solo para verificar en desarrollo.
 */

import { calcularChecksumEAN8 } from '../database/db';

/**
 * Test del algoritmo EAN-8 con ejemplos conocidos.
 */
export function testEAN8Checksum() {
  const casos = [
    { base: '2000015', esperado: '8', desc: 'Consecutivo 15' },
    { base: '2000001', esperado: '1', desc: 'Consecutivo 1' },
    { base: '2000010', esperado: '3', desc: 'Consecutivo 10' },
    { base: '2001000', esperado: '3', desc: 'Consecutivo 1000' },
  ];

  console.log('=== TEST EAN-8 Checksum ===');
  let pasados = 0;
  for (const caso of casos) {
    const checksum = calcularChecksumEAN8(caso.base);
    const esValido = checksum === caso.esperado;
    console.log(
      `${esValido ? '✓' : '✗'} ${caso.desc}: base="${caso.base}" → checksum="${checksum}" (esperado: "${caso.esperado}")`
    );
    if (esValido) pasados++;
  }
  console.log(`Resultado: ${pasados}/${casos.length} tests pasados\n`);
  return pasados === casos.length;
}

/**
 * Verifica manualmente el algoritmo EAN-8 paso a paso.
 */
export function debugEAN8(base: string) {
  if (!/^\d{7}$/.test(base)) {
    console.error(`Base inválida: "${base}" (debe ser 7 dígitos)`);
    return;
  }

  console.log(`\n=== DEBUG EAN-8: "${base}" ===`);
  let suma = 0;
  for (let i = 0; i < 7; i++) {
    const digito = parseInt(base[i], 10);
    const peso = i % 2 === 0 ? 3 : 1;
    const contribucion = digito * peso;
    console.log(`Posición ${i}: ${digito} × ${peso} = ${contribucion}`);
    suma += contribucion;
  }
  console.log(`Suma total: ${suma}`);
  const modulo = suma % 10;
  console.log(`Módulo 10: ${suma} % 10 = ${modulo}`);
  const checksum = (10 - modulo) % 10;
  console.log(`Checksum: (10 - ${modulo}) % 10 = ${checksum}`);
  console.log(`Código final: "${base}${checksum}"\n`);
}
