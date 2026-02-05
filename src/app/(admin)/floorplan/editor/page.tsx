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

import React, { useEffect, useState } from 'react';
import { FloorPlanEditor } from '@/domains/floor-plan/admin';

// Default location ID for testing
const TEST_LOCATION_ID = 'loc-default';

export default function FloorPlanEditorPage() {
  const [locationId, setLocationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Get a location ID from the database
  useEffect(() => {
    async function getLocationId() {
      try {
        // Try to get the first location
        const res = await fetch('/api/locations');
        if (res.ok) {
          const data = await res.json();
          if (data.locations && data.locations.length > 0) {
            setLocationId(data.locations[0].id);
          } else {
            // No locations exist, use a test ID
            setLocationId(TEST_LOCATION_ID);
          }
        } else {
          // API might not exist yet, use test ID
          setLocationId(TEST_LOCATION_ID);
        }
      } catch {
        // Use test ID on error
        setLocationId(TEST_LOCATION_ID);
      } finally {
        setIsLoading(false);
      }
    }
    getLocationId();
  }, []);

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
