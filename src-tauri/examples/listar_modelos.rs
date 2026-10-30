//! Consulta pública real de OpenRouter, sin claves, facturas ni generación de texto.
#[path = "../src/facturas_ia.rs"]
#[allow(dead_code)]
mod facturas_ia;

fn main() -> Result<(), String> {
    let models = tauri::async_runtime::block_on(facturas_ia::listar_modelos_ia(
        "openrouter".into(), String::new(),
    ))?;
    let router = models.iter().find(|m| m["id"] == "openrouter/free")
        .ok_or("El catálogo actual no incluye openrouter/free")?;
    assert_eq!(router["gratuito"],true);
    let free = models.iter().filter(|m| m["gratuito"] == true).count();
    println!("Catálogo real: {} modelos de texto, {free} gratuitos; openrouter/free disponible.",models.len());
    Ok(())
}
