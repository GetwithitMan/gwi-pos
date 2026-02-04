'use client';

/**
 * GWI POS - Floor Plan Editor Test Page
 *
 * Test page for the Floor Plan Admin Editor.
 * Access at: http://localhost:3000/test-floorplan/editor
 *
 * This uses the ORIGINAL polished FloorPlanEditor with all the UI features
 * (rotation controls, wall snapping, fine-tune buttons, etc.)
 */

import React, { useEffect, useState } from 'react';
import { FloorPlanEditor } from '@/domains/floor-plan/admin';
import { FloorCanvasAPI } from '@/domains/floor-plan/canvas';
import { sampleFloorPlans, sampleFixtures } from '../sampleData';

// =============================================================================
// TEST PAGE COMPONENT
// =============================================================================

// Default location ID for testing
const TEST_LOCATION_ID = 'loc-default';

export default function TestFloorPlanEditorPage() {
  const [locationId, setLocationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize sample data when component mounts
  useEffect(() => {
    // Only initialize if not already done
    if (FloorCanvasAPI.getAllRooms().length === 0) {
      console.log('[Editor] Initializing sample floor plan data...');
      FloorCanvasAPI.initializeFloorPlans(sampleFloorPlans, sampleFixtures);
    } else {
      console.log('[Editor] Sample data already initialized, skipping.');
    }
  }, []);

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
    // Navigate back to Front of House to see changes
    window.location.href = '/test-floorplan';
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
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 48,
              height: 48,
              border: '4px solid #f3f3f3',
              borderTop: '4px solid #3498db',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px',
            }}
          />
          <p style={{ color: '#666', fontSize: 14 }}>
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
        }}
      >
        <div style={{ textAlign: 'center', color: '#f44336' }}>
          <h2>No Location Found</h2>
          <p>Please create a location first.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/*
        Using the ORIGINAL FloorPlanEditor with DATABASE PERSISTENCE.
        Changes are saved to FloorPlanElement table and broadcast via sockets
        to other pages like /test-floorplan (FOH view).
      */}
      <FloorPlanEditor
        locationId={locationId}
        useDatabase={true}
        onExit={handleExit}
      />
    </div>
  );
}
