'use client';
import { useEffect, useCallback } from 'react';

interface KeyboardNavOptions {
  totalRows: number;
  focusedRow: number;
  setFocusedRow: (i: number) => void;
  selectedRows: Set<number>;
  setSelectedRows: (s: Set<number>) => void;
  expandedRow: number | null;
  setExpandedRow: (i: number | null) => void;
  onCycleStatus?: (rowId: number) => void;
  enabled?: boolean;
}

export function useKeyboardNav({
  totalRows,
  focusedRow,
  setFocusedRow,
  selectedRows,
  setSelectedRows,
  expandedRow,
  setExpandedRow,
  onCycleStatus,
  enabled = true,
}: KeyboardNavOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled || totalRows === 0) return;
      // Don't capture if user is typing in an input/select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      switch (e.key) {
        case 'j':
          e.preventDefault();
          setFocusedRow(Math.min(focusedRow + 1, totalRows - 1));
          break;
        case 'k':
          e.preventDefault();
          setFocusedRow(Math.max(focusedRow - 1, 0));
          break;
        case 'x':
          e.preventDefault();
          const next = new Set(selectedRows);
          if (next.has(focusedRow)) next.delete(focusedRow);
          else next.add(focusedRow);
          setSelectedRows(next);
          break;
        case 's':
          e.preventDefault();
          if (onCycleStatus) onCycleStatus(focusedRow);
          break;
        case 'Enter':
          e.preventDefault();
          setExpandedRow(expandedRow === focusedRow ? null : focusedRow);
          break;
        case 'Escape':
          e.preventDefault();
          setSelectedRows(new Set());
          setExpandedRow(null);
          break;
      }
    },
    [enabled, totalRows, focusedRow, setFocusedRow, selectedRows, setSelectedRows, expandedRow, setExpandedRow, onCycleStatus],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
