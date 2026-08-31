import { useSyncExternalStore } from 'react';
import { subscribe, isHidden } from '../utils/privacy.js';

// Suscribe un componente al modo privado. Usarlo en el Layout es lo que hace que
// el subárbol entero se vuelva a renderizar al togglear.
export function usePrivacy() {
  return useSyncExternalStore(subscribe, isHidden, isHidden);
}
