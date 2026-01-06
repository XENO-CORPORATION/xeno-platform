/**
 * Undo/Redo Hook
 * Manages history stack for project state changes
 */

import { useState, useCallback, useRef } from 'react';

export interface UndoRedoOptions {
  maxHistory: number; // Maximum number of undo steps to keep
  onUndo?: (state: any) => void;
  onRedo?: (state: any) => void;
  onChange?: (canUndo: boolean, canRedo: boolean) => void;
}

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

/**
 * Hook for undo/redo functionality with configurable history limit
 */
export function useUndoRedo<T>(
  initialState: T,
  options: UndoRedoOptions
) {
  const {
    maxHistory,
    onUndo,
    onRedo,
    onChange
  } = options;

  const [history, setHistory] = useState<HistoryState<T>>({
    past: [],
    present: initialState,
    future: []
  });

  const isInternalUpdateRef = useRef(false);

  /**
   * Add a new state to history
   */
  const pushState = useCallback((newState: T) => {
    if (isInternalUpdateRef.current) {
      return;
    }

    setHistory((prev) => {
      // Check if state actually changed
      if (JSON.stringify(prev.present) === JSON.stringify(newState)) {
        return prev;
      }

      const newPast = [...prev.past, prev.present];

      // Enforce max history limit
      if (newPast.length > maxHistory) {
        newPast.shift(); // Remove oldest entry
      }

      const newHistory = {
        past: newPast,
        present: newState,
        future: [] // Clear future on new action
      };

      // Notify of capability change
      onChange?.(newHistory.past.length > 0, false);

      return newHistory;
    });
  }, [maxHistory, onChange]);

  /**
   * Undo to previous state
   */
  const undo = useCallback(() => {
    setHistory((prev) => {
      if (prev.past.length === 0) {
        console.log('⏮️  Nothing to undo');
        return prev;
      }

      const newPast = [...prev.past];
      const newPresent = newPast.pop()!;
      const newFuture = [prev.present, ...prev.future];

      const newHistory = {
        past: newPast,
        present: newPresent,
        future: newFuture
      };

      console.log(`⏮️  Undo (${newHistory.past.length} steps remaining)`);

      isInternalUpdateRef.current = true;
      onUndo?.(newPresent);
      isInternalUpdateRef.current = false;

      // Notify of capability change
      onChange?.(newHistory.past.length > 0, newHistory.future.length > 0);

      return newHistory;
    });
  }, [onUndo, onChange]);

  /**
   * Redo to next state
   */
  const redo = useCallback(() => {
    setHistory((prev) => {
      if (prev.future.length === 0) {
        console.log('⏭️  Nothing to redo');
        return prev;
      }

      const newFuture = [...prev.future];
      const newPresent = newFuture.shift()!;
      const newPast = [...prev.past, prev.present];

      // Enforce max history limit
      if (newPast.length > maxHistory) {
        newPast.shift();
      }

      const newHistory = {
        past: newPast,
        present: newPresent,
        future: newFuture
      };

      console.log(`⏭️  Redo (${newHistory.future.length} steps remaining)`);

      isInternalUpdateRef.current = true;
      onRedo?.(newPresent);
      isInternalUpdateRef.current = false;

      // Notify of capability change
      onChange?.(newHistory.past.length > 0, newHistory.future.length > 0);

      return newHistory;
    });
  }, [maxHistory, onRedo, onChange]);

  /**
   * Clear all history
   */
  const clearHistory = useCallback(() => {
    setHistory((prev) => ({
      past: [],
      present: prev.present,
      future: []
    }));

    onChange?.(false, false);
    console.log('🧹 History cleared');
  }, [onChange]);

  /**
   * Reset to a specific state (clears all history)
   */
  const reset = useCallback((newState: T) => {
    setHistory({
      past: [],
      present: newState,
      future: []
    });

    onChange?.(false, false);
    console.log('🔄 State reset');
  }, [onChange]);

  return {
    state: history.present,
    pushState,
    undo,
    redo,
    clearHistory,
    reset,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    historySize: history.past.length
  };
}

/**
 * Keyboard shortcut helper for undo/redo
 */
export function useUndoRedoShortcuts(
  undo: () => void,
  redo: () => void,
  enabled: boolean = true
) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    // Ctrl+Z / Cmd+Z for Undo
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
    }

    // Ctrl+Shift+Z / Cmd+Shift+Z for Redo
    // OR Ctrl+Y / Cmd+Y for Redo
    if (
      ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'z') ||
      ((event.ctrlKey || event.metaKey) && event.key === 'y')
    ) {
      event.preventDefault();
      redo();
    }
  }, [undo, redo, enabled]);

  // Attach keyboard listeners
  if (typeof window !== 'undefined' && enabled) {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }
}
