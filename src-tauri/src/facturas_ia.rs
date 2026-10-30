use serde_json::{json, Value};
use std::time::Duration;

fn validar_clave(api_key: &str) -> Result<&str, String> {
    let clave = api_key.trim();
    if clave.is_empty() || clave.len() > 4096 || !clave.bytes().all(|b| b.is_ascii_graphic()) {
        return Err("La clave de API no es válida o contiene caracteres no permitidos.".into());
    }
    Ok(clave)
}

fn validar_modelo<'a>(proveedor: &str, modelo: &'a str) -> Result<&'a str, String> {
    let modelo = modelo.trim();
    let modelo = if proveedor == "google" { modelo.strip_prefix("models/").unwrap_or(modelo) } else { modelo };
    if modelo.is_empty() {
        return Err("Seleccione un modelo. Pulse «Actualizar modelos» para consultar los disponibles.".into());
    }
    let caracteres_validos = if proveedor == "google" {
        modelo.bytes().all(|b| b.is_ascii_alphanumeric() || b"/._:-".contains(&b))
    } else {
        // OpenRouter publica aliases con ~. En chat el ID viaja como dato JSON, no como URL.
        modelo.chars().all(|c| !c.is_control() && !c.is_whitespace())
    };
    if modelo.len() > 256 || !caracteres_validos {
        return Err("El ID del modelo contiene caracteres no válidos.".into());
    }
    Ok(modelo)
}

fn error_proveedor(proveedor: &str, status: reqwest::StatusCode, body: &str) -> String {
    let parsed: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let message = parsed["error"]["message"].as_str().unwrap_or("El proveedor no pudo completar la solicitud.");
    let consejo = if status == reqwest::StatusCode::NOT_FOUND || parsed["error"]["code"] == "model_not_found" {
        " El modelo no está disponible para esta clave. Pulse «Actualizar modelos», seleccione otro y pruebe la conexión."
    } else if status == reqwest::StatusCode::UNAUTHORIZED {
        " Revise la clave de API del proveedor seleccionado."
    } else if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        " Se alcanzó un límite de uso. Espere o revise la cuota de su cuenta."
    } else { "" };
    format!("{proveedor} (HTTP {}): {message}{consejo}",status.as_u16())
}

fn modelos_del_catalogo(proveedor: &str, body: &Value) -> Result<Vec<Value>, String> {
    let key = if proveedor == "google" { "models" } else { "data" };
    let entries = body[key].as_array().ok_or("El proveedor devolvió un catálogo de modelos inválido.")?;
    let mut models = Vec::new();
    for entry in entries {
        let id = if proveedor == "google" { entry["name"].as_str() } else { entry["id"].as_str() };
        let Some(id) = id.filter(|id| !id.trim().is_empty()) else { continue };
        if entry["active"] == false { continue; }
        let Ok(id) = validar_modelo(proveedor,id) else { continue };
        let id = id.to_string();
        let (nombre, gratuito) = match proveedor {
            "google" => {
                if !entry["supportedGenerationMethods"].as_array().is_some_and(|a| a.iter().any(|m| m == "generateContent")) { continue; }
                (entry["displayName"].as_str().unwrap_or(&id),None)
            },
            "openrouter" => {
                let text = |field: &str| entry["architecture"][field].as_array().is_some_and(|a| a.iter().any(|m| m == "text"));
                if !text("input_modalities") || !text("output_modalities") { continue; }
                let price = |field: &str| entry["pricing"][field].as_str().and_then(|s| s.parse::<f64>().ok())
                    .filter(|p| p.is_finite() && *p >= 0.0);
                let request_price = if entry["pricing"]["request"].is_null() { Some(0.0) } else { price("request") };
                let free = match (price("prompt"),price("completion"),request_price) {
                    (Some(p),Some(c),Some(r)) => Some(p == 0.0 && c == 0.0 && r == 0.0),
                    _ => None,
                };
                (entry["name"].as_str().unwrap_or(&id),free)
            },
            "groq" => {
                // Groq no publica modalidades en /models; excluir familias de audio y moderación.
                let lower = id.to_lowercase();
                if ["whisper","tts","orpheus","guard"].iter().any(|part| lower.contains(part)) { continue; }
                (id.as_str(),None)
            },
            _ => return Err("Proveedor de IA no reconocido.".into()),
        };
        models.push(json!({"id":id,"nombre":nombre,"gratuito":gratuito}));
    }
    Ok(models)
}

/// Consulta únicamente el catálogo: no genera texto ni envía la factura.
#[tauri::command]
pub async fn listar_modelos_ia(proveedor: String, api_key: String) -> Result<Vec<Value>, String> {
    let proveedor = proveedor.trim().to_lowercase();
    let url = match proveedor.as_str() {
        "google" => "https://generativelanguage.googleapis.com/v1beta/models",
        "groq" => "https://api.groq.com/openai/v1/models",
        "openrouter" if api_key.trim().is_empty() => "https://openrouter.ai/api/v1/models",
        "openrouter" => "https://openrouter.ai/api/v1/models/user",
        _ => return Err("Proveedor de IA no reconocido.".into()),
    };
    let clave = if proveedor == "openrouter" && api_key.trim().is_empty() { None } else { Some(validar_clave(&api_key)?) };
    let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).build()
        .map_err(|_| "No se pudo iniciar la consulta de modelos.")?;
    let mut modelos = Vec::new();
    let mut page = String::new();
    let mut pages = std::collections::HashSet::new();
    loop {
        let mut request = client.get(url);
        if proveedor == "google" {
            request = request.header("x-goog-api-key",clave.unwrap()).query(&[("pageSize","1000")]);
            if !page.is_empty() { request = request.query(&[("pageToken",page.as_str())]); }
        } else if let Some(clave) = clave {
            request = request.bearer_auth(clave);
        }
        let response = request.send().await.map_err(|_| "No se pudo conectar al catálogo. Revise la conexión e intente actualizar los modelos.")?;
        let status = response.status();
        let text = response.text().await.map_err(|_| "No se pudo leer el catálogo del proveedor.")?;
        if !status.is_success() { return Err(error_proveedor(&proveedor,status,&text)); }
        let body: Value = serde_json::from_str(&text).map_err(|_| "El proveedor devolvió una respuesta de modelos inválida.")?;
        modelos.extend(modelos_del_catalogo(&proveedor,&body)?);
        if proveedor != "google" { break; }
        page = body["nextPageToken"].as_str().unwrap_or("").to_string();
        if page.is_empty() { break; }
        if !pages.insert(page.clone()) { return Err("El catálogo devolvió una página repetida. Intente actualizarlo nuevamente.".into()); }
    }
    modelos.sort_by(|a,b| {
        let rank = |m: &Value| if m["id"] == "openrouter/free" { 0 } else if m["gratuito"] == true { 1 } else { 2 };
        rank(a).cmp(&rank(b)).then_with(|| a["id"].as_str().cmp(&b["id"].as_str()))
    });
    let mut ids = std::collections::HashSet::new();
    modelos.retain(|m| ids.insert(m["id"].as_str().unwrap().to_string()));
    Ok(modelos)
}

fn prompt_instrucciones(categorias: &[String]) -> String {
    let categorias_str = if categorias.is_empty() {
        "1. TECNOLOGÍA\n2. HOGAR\n3. ELECTRODOMÉSTICOS\n4. JUGUETES Y DEPORTES\n5. ACCESORIOS\n6. ROPA\n7. FERRETERÍA\n8. CALZADO\n9. ASEO Y CUIDADO PERSONAL".to_string()
    } else {
        categorias.iter().enumerate().map(|(i, c)| format!("{}. {}", i + 1, c)).collect::<Vec<_>>().join("\n")
    };

    format!(
        "Eres un asistente experto en punto de venta (POS) e inventario.\n\
        Tu misión es analizar el texto extraído por OCR de una factura o remisión de proveedor y extraer la lista estructurada de productos comprados.\n\n\
        REGLAS ESTRICTAS DE EXTRACCIÓN:\n\
        1. 'nombre': Nombre completo del producto en MAYÚSCULAS tal como aparece en la factura (ejemplo: 'CANDADO BICICLETA CON CLAVE*300').\n\
        2. 'nombre_etiqueta': Nombre legible y abreviado para imprimir en etiqueta de código de barras. MÁXIMO 16 CARACTERES. Si el nombre es largo, crea una abreviatura interpretable (ejemplo: 'CANDADO BICI 300').\n\
        3. 'categoria': Clasifica el producto asignando OBLIGATORIAMENTE una de las siguientes categorías exactas:\n\
        {categorias_str}\n\
        (Este campo no viene en la factura, debes clasificarlo en la categoría donde mejor encaje).\n\
        4. 'precio_compra': Costo unitario de compra (número positivo, sin puntos de miles ni comas; ej: 4500). Si solo aparece el total de la línea, divídelo entre la cantidad.\n\
        5. 'precio_venta': Precio de venta al público sugerido (número positivo mayor que precio_compra). Si en la factura hay anotaciones manuscritas o precios de venta, úsalos. Si no aparece, calcula un precio razonable con margen comercial (ej: 40% a 50% sobre el costo, redondeado a múltiplos de 500 o 1000).\n\
        6. 'stock': Cantidad entera de unidades compradas (número entero >= 1; ej: 12).\n\
        7. 'stock_minimo': Siempre 1 por defecto.\n\
        8. 'codigo_barras': Código de barras/EAN numérico si está presente en el texto, o null si no hay.\n\
        9. 'observaciones': Si tuviste alguna duda con un precio o nombre, indícalo brevemente aquí; si no, deja cadena vacía.\n\n\
        IMPORTANTE: Responde ÚNICAMENTE un objeto JSON válido con la siguiente estructura exacta, sin texto adicional ni bloques markdown extra:\n\
        {{\n\
          \"productos\": [\n\
            {{\n\
              \"nombre\": \"...\",\n\
              \"nombre_etiqueta\": \"...\",\n\
              \"categoria\": \"...\",\n\
              \"precio_compra\": 4500,\n\
              \"precio_venta\": 7000,\n\
              \"stock\": 12,\n\
              \"stock_minimo\": 1,\n\
              \"codigo_barras\": null,\n\
              \"observaciones\": \"\"\n\
            }}\n\
          ]\n\
        }}"
    )
}

/// Prueba de conexión para Google, OpenRouter o Groq
#[tauri::command]
pub async fn probar_conexion_ia(proveedor: String, api_key: String, modelo: String) -> Result<String, String> {
    let clave = validar_clave(&api_key)?;
    let prov = proveedor.trim().to_lowercase();
    let mod_nombre = validar_modelo(&prov,&modelo)?;
    let cliente = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "No se pudo iniciar el cliente HTTP.")?;

    match prov.as_str() {
        "google" => {
            let mod_usar = mod_nombre;
            let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent", mod_usar);
            let body = json!({
                "contents": [{"parts": [{"text": "Responde únicamente la palabra OK."}]}],
                "generationConfig": { "maxOutputTokens": 32 }
            });
            let resp = cliente.post(&url)
                .header("x-goog-api-key", clave)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Error conectando con Google AI: {}", e))?;
            
            let status = resp.status();
            if !status.is_success() {
                let err_text = resp.text().await.unwrap_or_default();
                return Err(error_proveedor("Google AI",status,&err_text));
            }
            Ok(format!("Conexión exitosa con Google AI Studio usando el modelo {}.", mod_usar))
        },
        "openrouter" => {
            let mod_usar = mod_nombre;
            let url = "https://openrouter.ai/api/v1/chat/completions";
            let body = json!({
                "model": mod_usar,
                "messages": [{"role": "user", "content": "Responde únicamente OK."}],
                "max_tokens": 32
            });
            let resp = cliente.post(url)
                .header("Authorization", format!("Bearer {}", clave))
                .header("HTTP-Referer", "https://magaji-pos.local")
                .header("X-Title", "MAGAJI POS")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Error conectando con OpenRouter: {}", e))?;

            let status = resp.status();
            if !status.is_success() {
                let err_text = resp.text().await.unwrap_or_default();
                return Err(error_proveedor("OpenRouter",status,&err_text));
            }
            Ok(format!("Conexión exitosa con OpenRouter usando el modelo {}.", mod_usar))
        },
        "groq" => {
            let mod_usar = mod_nombre;
            let url = "https://api.groq.com/openai/v1/chat/completions";
            let body = json!({
                "model": mod_usar,
                "messages": [{"role": "user", "content": "Responde únicamente OK."}],
                "max_tokens": 32
            });
            let resp = cliente.post(url)
                .header("Authorization", format!("Bearer {}", clave))
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Error conectando con Groq: {}", e))?;

            let status = resp.status();
            if !status.is_success() {
                let err_text = resp.text().await.unwrap_or_default();
                return Err(error_proveedor("Groq",status,&err_text));
            }
            Ok(format!("Conexión exitosa con Groq usando el modelo {}.", mod_usar))
        },
        _ => Err("Proveedor no reconocido. Use 'google', 'openrouter' o 'groq'.".into()),
    }
}

/// Analiza el texto obtenido por OCR con la IA seleccionada (Google, OpenRouter o Groq)
#[tauri::command]
pub async fn analizar_factura_ocr_ia(
    proveedor: String,
    api_key: String,
    modelo: String,
    texto_ocr: String,
    categorias: Vec<String>,
) -> Result<String, String> {
    let clave = validar_clave(&api_key)?;
    let prov = proveedor.trim().to_lowercase();
    let mod_nombre = validar_modelo(&prov,&modelo)?;
    if texto_ocr.trim().is_empty() {
        return Err("El texto de la factura está vacío. Ejecute el OCR primero.".into());
    }

    let sistema = prompt_instrucciones(&categorias);
    let cliente = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|_| "No se pudo iniciar el cliente HTTP.")?;

    match prov.as_str() {
        "google" => {
            let mod_usar = mod_nombre;
            let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent", mod_usar);
            let body = json!({
                "systemInstruction": { "parts": [{ "text": sistema }] },
                "contents": [{
                    "role": "user",
                    "parts": [{ "text": format!("Aquí está el texto extraído por OCR de la factura:\n\n{}", texto_ocr) }]
                }],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "maxOutputTokens": 16384
                }
            });

            let resp = cliente.post(&url)
                .header("x-goog-api-key", clave)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Error conectando con Google AI: {}", e))?;

            let status = resp.status();
            let json_resp: Value = resp.json().await.unwrap_or(Value::Null);
            if !status.is_success() {
                return Err(error_proveedor("Google AI",status,&json_resp.to_string()));
            }

            let texto = json_resp["candidates"][0]["content"]["parts"]
                .as_array()
                .and_then(|parts| parts.iter().find_map(|p| p["text"].as_str()))
                .ok_or("Google AI no devolvió texto en la respuesta.")?;

            Ok(limpiar_json_markdown(texto))
        },
        "openrouter" => {
            let mod_usar = mod_nombre;
            let url = "https://openrouter.ai/api/v1/chat/completions";
            let body = json!({
                "model": mod_usar,
                "messages": [
                    { "role": "system", "content": sistema },
                    { "role": "user", "content": format!("Aquí está el texto extraído por OCR de la factura:\n\n{}", texto_ocr) }
                ],
                "max_tokens": 8192
            });

            let resp = cliente.post(url)
                .header("Authorization", format!("Bearer {}", clave))
                .header("HTTP-Referer", "https://magaji-pos.local")
                .header("X-Title", "MAGAJI POS")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Error conectando con OpenRouter: {}", e))?;

            let status = resp.status();
            let json_resp: Value = resp.json().await.unwrap_or(Value::Null);
            if !status.is_success() {
                return Err(error_proveedor("OpenRouter",status,&json_resp.to_string()));
            }

            let texto = json_resp["choices"][0]["message"]["content"]
                .as_str()
                .ok_or("OpenRouter no devolvió contenido en la respuesta.")?;

            Ok(limpiar_json_markdown(texto))
        },
        "groq" => {
            let mod_usar = mod_nombre;
            let url = "https://api.groq.com/openai/v1/chat/completions";
            let body = json!({
                "model": mod_usar,
                "messages": [
                    { "role": "system", "content": sistema },
                    { "role": "user", "content": format!("Aquí está el texto extraído por OCR de la factura:\n\n{}", texto_ocr) }
                ],
                "max_tokens": 8192
            });

            let resp = cliente.post(url)
                .header("Authorization", format!("Bearer {}", clave))
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Error conectando con Groq: {}", e))?;

            let status = resp.status();
            let json_resp: Value = resp.json().await.unwrap_or(Value::Null);
            if !status.is_success() {
                return Err(error_proveedor("Groq",status,&json_resp.to_string()));
            }

            let texto = json_resp["choices"][0]["message"]["content"]
                .as_str()
                .ok_or("Groq no devolvió contenido en la respuesta.")?;

            Ok(limpiar_json_markdown(texto))
        },
        _ => Err("Proveedor no válido. Seleccione 'google', 'openrouter' o 'groq'.".into()),
    }
}

fn limpiar_json_markdown(s: &str) -> String {
    let mut t = s.trim();
    if t.starts_with("```json") {
        t = &t[7..];
    } else if t.starts_with("```") {
        t = &t[3..];
    }
    if t.ends_with("```") {
        t = &t[..t.len() - 3];
    }
    t.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogos_actuales_y_errores_sin_modelos_de_respaldo() {
        let text = json!({"input_modalities":["text"],"output_modalities":["text"]});
        let catalogo = json!({"data":[
            {"id":"openrouter/free","name":"Free Router","architecture":text,"pricing":{"prompt":"0","completion":"0"}},
            {"id":"autor/gratis:free","architecture":text,"pricing":{"prompt":"0.0","completion":"0","request":"0"}},
            {"id":"autor/pago","architecture":text,"pricing":{"prompt":"0.001","completion":"0.002"}},
            {"id":"autor/desconocido:free","architecture":text,"pricing":{}},
            {"id":"autor/cargo-por-peticion","architecture":text,"pricing":{"prompt":"0","completion":"0","request":"0.01"}},
            {"id":"autor/imagen","architecture":{"input_modalities":["text"],"output_modalities":["image"]}},
            {"id":"autor/retirado","architecture":text,"active":false}
        ]});
        let modelos = modelos_del_catalogo("openrouter",&catalogo).unwrap();
        assert_eq!(modelos.len(),5);
        assert_eq!(modelos[0]["id"],"openrouter/free");
        assert_eq!(modelos[0]["gratuito"],true);
        assert_eq!(modelos[1]["gratuito"],true);
        assert_eq!(modelos[2]["gratuito"],false);
        assert!(modelos[3]["gratuito"].is_null());
        assert_eq!(modelos[4]["gratuito"],false);
        let groq = modelos_del_catalogo("groq",&json!({"data":[
            {"id":"modelo-chat-vigente","active":true},{"id":"modelo-retirado","active":false},
            {"id":"whisper-audio"},{"id":"canopylabs/orpheus"},{"id":"llama-guard"}
        ]})).unwrap();
        assert_eq!(groq.len(),1);
        assert_eq!(groq[0]["id"],"modelo-chat-vigente");
        assert!(groq[0]["gratuito"].is_null());
        let google = modelos_del_catalogo("google",&json!({"models":[
            {"name":"models/modelo-actual","displayName":"Actual","supportedGenerationMethods":["generateContent"]},
            {"name":"models/embedding","supportedGenerationMethods":["embedContent"]}
        ]})).unwrap();
        assert_eq!(google[0]["id"],"modelo-actual");
        assert_eq!(google.len(),1);
        assert!(modelos_del_catalogo("groq",&json!({"error":"inválido"})).is_err());
        assert!(validar_modelo("groq","").is_err());
        assert!(validar_modelo("google","modelo?key=secreto").is_err());
        assert_eq!(validar_modelo("openrouter","openrouter/free").unwrap(),"openrouter/free");
        assert_eq!(validar_modelo("openrouter","~autor/modelo-latest").unwrap(),"~autor/modelo-latest");
        assert!(validar_modelo("openrouter","modelo\ninválido").is_err());
        let error = error_proveedor("Groq",reqwest::StatusCode::NOT_FOUND,
            r#"{"error":{"message":"modelo no encontrado","code":"model_not_found"}}"#);
        assert!(error.contains("Actualizar modelos"));
        assert!(error.contains("HTTP 404"));
    }
}
