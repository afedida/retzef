import { useSyncExternalStore } from 'react'
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
