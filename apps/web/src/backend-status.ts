/**
 * Sinal global de "backend indisponível": qualquer chamada à API que falhe na rede ou receba o 503
 * do Worker (service_unavailable) avisa aqui, e a modal de serviço indisponível aparece por cima da
 * página atual, sem tirar o usuário de onde está.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onBackendDown(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyBackendDown(): void {
  for (const fn of listeners) fn();
}
