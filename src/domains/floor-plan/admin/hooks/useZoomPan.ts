'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { Point } from '../../shared/types';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_DEFAULT,
  ZOOM_STEP,
} from '@/lib/floorplan/constants';

interface UseZoomPanOptions {
  zoomControlRef?: React.MutableRefObject<{
    fitToScreen: () => void;
    resetZoom: () => void;
    setZoom: (z: number) => void;
    zoom: number;
  } | null>;
  onZoomChange?: (zoom: number) => void;
}

export function useZoomPan({ zoomControlRef, onZoomChange }: UseZoomPanOptions = {}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [panOffset, setPanOffset] = useState<Point>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPoint, setLastPanPoint] = useState<Point | null>(null);

  // Zoom handler (wheel event)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom(prev => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev + delta)));
    }
  }, []);

  // Pan handlers (middle mouse or Alt+drag)
  const handlePanStart = useCallback((e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      setIsPanning(true);
      setLastPanPoint({ x: e.clientX, y: e.clientY });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  }, []);

  const handlePanMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning || !lastPanPoint) return;

    const dx = e.clientX - lastPanPoint.x;
    const dy = e.clientY - lastPanPoint.y;

    setPanOffset(prev => ({
      x: prev.x + dx,
      y: prev.y + dy,
    }));
    setLastPanPoint({ x: e.clientX, y: e.clientY });
  }, [isPanning, lastPanPoint]);

  const handlePanEnd = useCallback((e: React.PointerEvent) => {
    if (isPanning) {
      setIsPanning(false);
      setLastPanPoint(null);
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  }, [isPanning]);

  // Fit to screen - calculate zoom to fit canvas in viewport
  const fitToScreen = useCallback(() => {
    if (!canvasRef.current) return;
    const container = canvasRef.current.parentElement;
    if (!container) return;

    const containerWidth = container.clientWidth - 48;
    const containerHeight = container.clientHeight - 48;

    const scaleX = containerWidth / CANVAS_WIDTH;
    const scaleY = containerHeight / CANVAS_HEIGHT;
    const newZoom = Math.min(scaleX, scaleY, ZOOM_MAX);

    setZoom(Math.max(ZOOM_MIN, newZoom));
    setPanOffset({ x: 0, y: 0 });
  }, []);

  // Reset zoom
  const resetZoom = useCallback(() => {
    setZoom(ZOOM_DEFAULT);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  // Expose zoom controls to parent
  useEffect(() => {
    if (zoomControlRef) {
      zoomControlRef.current = {
        fitToScreen,
        resetZoom,
        setZoom,
        zoom,
      };
    }
  }, [zoomControlRef, fitToScreen, resetZoom, zoom]);

  // Notify parent of zoom changes
  useEffect(() => {
    onZoomChange?.(zoom);
  }, [zoom, onZoomChange]);

  return {
    canvasRef,
    zoom,
    panOffset,
    isPanning,
    handleWheel,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
    fitToScreen,
    resetZoom,
  };
}
