export type TipoAlerta = 'error' | 'advertencia' | 'info';

type HandlerAlerta = (mensaje: string, tipo?: TipoAlerta, titulo?: string) => void;

let _handler: HandlerAlerta = (msg) => window.alert(msg);

export function registrarHandlerAlerta(fn: HandlerAlerta) {
  _handler = fn;
}

export function mostrarAlerta(mensaje: string, tipo: TipoAlerta = 'error', titulo?: string) {
  _handler(mensaje, tipo, titulo);
}
