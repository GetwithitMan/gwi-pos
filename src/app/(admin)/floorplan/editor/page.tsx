'use client';

/**
 * GWI POS - Floor Plan Editor
 *
 * Admin page for editing the floor plan layout.
 * Access at: http://localhost:3000/floorplan/editor
 *
 * This uses the FloorPlanEditor with all the UI features
 * (rotation controls, wall snapping, fine-tune buttons, etc.)
 */

import React from 'react';
import { FloorPlanEditor } from '@/domains/floor-plan/admin';
import { useAuthStore } from '@/stores/auth-store';

export default function FloorPlanEditorPage() {
  const employee = useAuthStore(s => s.employee);
  const locationId = employee?.location?.id ?? null;
  const isLoading = !employee;

  const handleExit = () => {
    // Navigate back to orders (production FOH view)
    window.location.href = '/orders';
  };

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          fontFamily: 'system-ui, sans-serif',
          background: '#0f172a',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 48,
              height: 48,
              border: '4px solid #334155',
              borderTop: '4px solid #3b82f6',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px',
            }}
          />
          <p style={{ color: '#94a3b8', fontSize: 14 }}>
            Loading Floor Plan Editor...
          </p>
        </div>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (!locationId) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          fontFamily: 'system-ui, sans-serif',
          background: '#0f172a',
        }}
      >
        <div style={{ textAlign: 'center', color: '#f87171' }}>
          <h2>No Location Found</h2>
          <p>Please create a location first.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <FloorPlanEditor
        locationId={locationId}
        useDatabase={true}
        onExit={handleExit}
      />
    </div>
  );
}
