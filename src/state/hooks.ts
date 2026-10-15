import { useSyncExternalStore } from 'react'
import { t as translateNow, type MessageKey, type Vars } from '@/lib/i18n'
import { getState, isPlaying, subscribe, subscribePlaying, type EditorState } from '@/state/editor'

export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(getState()),
    () => selector(getState()),
  )
}

export function usePlaying(): boolean {
  return useSyncExternalStore(subscribePlaying, isPlaying, isPlaying)
}

export function useT(): (key: MessageKey, vars?: Vars) => string {
  useEditor((state) => state.language)
  return translateNow
}
