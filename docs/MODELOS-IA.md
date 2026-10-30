# Elegir modelos disponibles (MAGAJI 1.2.7)

En **Configuración → Inteligencia Artificial** o **Importar factura → Ajustes de IA**:

1. Seleccionar el proveedor y pegar su clave.
2. Pulsar **Actualizar modelos**. La aplicación consulta el catálogo del proveedor en ese momento; no envía facturas ni genera texto.
3. Buscar por nombre o ID y elegir un modelo. OpenRouter permite filtrar **Solo gratuitos**, activado inicialmente, e incluye `openrouter/free` cuando aparece en el catálogo.
4. Pulsar **Probar conexión** y guardar los ajustes. Esa prueba realiza una pequeña solicitud de generación con la clave y el modelo elegidos; puede consumir cuota.

Se conserva el modelo previamente guardado. Si ya no aparece, se muestra una advertencia; nunca se sustituye silenciosamente por otro modelo, ni se elige uno de pago al actualizar la lista. También se permite escribir un ID exacto. Las configuraciones nuevas requieren una selección explícita para Google y Groq.

OpenRouter devuelve precios; solo se marca «Gratis» cuando los precios de entrada, salida y eventual cargo por solicitud son cero. No se deduce gratuidad del nombre del modelo. En Groq y Google la lista no informa la cuota gratuita de la cuenta, por lo que no se etiqueta todo el catálogo como gratuito.

La presencia en el catálogo no garantiza cuota, permisos ni capacidad disponible en cada momento. Si falla la prueba, revisar el mensaje del proveedor. Los errores de modelo retirado o inaccesible invitan a actualizar la lista, y los límites de uso se indican por separado.

## Consultas utilizadas

- Groq: `GET https://api.groq.com/openai/v1/models`, con la clave del usuario; se omiten modelos inactivos y familias conocidas de audio/moderación, porque ese catálogo no proporciona modalidades completas.
- OpenRouter con clave: `GET https://openrouter.ai/api/v1/models/user`, respetando preferencias de cuenta, privacidad y restricciones. Sin clave, permite explorar el catálogo público mediante `/api/v1/models`. Se seleccionan modelos con entrada y salida de texto.
- Google: `GET https://generativelanguage.googleapis.com/v1beta/models`, con paginación y filtro `generateContent`.

Las claves viajan en cabeceras a las direcciones oficiales; nunca en la URL. No se consultan endpoints suministrados por el catálogo ni se ejecutan sus descripciones. Si cambia la clave o el proveedor durante una consulta, se ignora la respuesta anterior.

El análisis con OpenRouter y Groq conserva la instrucción y validación de JSON, sin exigir el parámetro opcional `response_format` a todos los modelos. Esto permite usar modelos que no admiten ese parámetro; si devuelven una respuesta inválida, se presenta el error antes de crear productos.

Fuentes: [API de modelos de Groq](https://console.groq.com/docs/api-reference#models-list), [catálogo de OpenRouter por cuenta](https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails), [router gratuito](https://openrouter.ai/docs/guides/routing/routers/free-router), [modelos de Google](https://ai.google.dev/api/models).

## Comprobaciones

`cargo test --release --manifest-path src-tauri/Cargo.toml --lib` comprueba los tres formatos de catálogo, precios desconocidos y cargos por solicitud, modelos inactivos, familias de audio, IDs de routers con `~`, selección obligatoria y mensajes de modelo inaccesible. `npm run test:facturas` verifica la comunicación de la interfaz, el ID `openrouter/free` y el bloqueo de modelos vacíos.

`cargo run --release --manifest-path src-tauri/Cargo.toml --example listar_modelos` consulta el catálogo público real de OpenRouter sin clave ni generación. Las consultas autenticadas y la prueba de generación se realizan desde la interfaz con la clave del usuario.

Se comprobó en navegador el selector compartido con respuestas simuladas: búsqueda, filtro gratuito, conservación del modelo al filtrar, cambio de proveedor, advertencia de modelo ausente y elección de un modelo vigente. La prueba no usó claves reales ni modificó los ajustes del POS.
