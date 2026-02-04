'use client';

/**
 * GWI POS - Floor Plan API Test Page (Backend)
 *
 * Runs and displays backend API tests for the Floor Plan domain.
 * Access at: http://localhost:3000/test-floorplan/api
 */

import React, { useEffect, useState } from 'react';

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  data?: unknown;
}

interface TestResponse {
  success: boolean;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  tests: TestResult[];
  timestamp: string;
  error?: string;
}

export default function TestFloorPlanAPIPage() {
  const [results, setResults] = useState<TestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runTests = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/test-floorplan');
      const data = await response.json();
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run tests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runTests();
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0 }}>Floor Plan API Tests (Backend)</h1>
          <p style={{ color: '#666', margin: '8px 0 0 0' }}>
            Tests the FloorCanvasAPI service methods
          </p>
        </div>
        <button
          onClick={runTests}
          disabled={loading}
          style={{
            padding: '12px 24px',
            backgroundColor: loading ? '#ccc' : '#3498db',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 16,
          }}
        >
          {loading ? 'Running...' : 'Run Tests'}
        </button>
      </div>

      {/* Navigation */}
      <div style={{ marginBottom: 24 }}>
        <a href="/test-floorplan" style={{ color: '#3498db', textDecoration: 'none' }}>
          ← Back to Frontend Test
        </a>
      </div>

      {error && (
        <div
          style={{
            padding: 16,
            backgroundColor: '#ffebee',
            color: '#c62828',
            borderRadius: 8,
            marginBottom: 24,
          }}
        >
          Error: {error}
        </div>
      )}

      {results && (
        <>
          {/* Summary */}
          <div
            style={{
              display: 'flex',
              gap: 16,
              marginBottom: 24,
            }}
          >
            <div
              style={{
                flex: 1,
                padding: 20,
                backgroundColor: results.success ? '#e8f5e9' : '#ffebee',
                borderRadius: 8,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 48, fontWeight: 'bold', color: results.success ? '#2e7d32' : '#c62828' }}>
                {results.summary.passed}/{results.summary.total}
              </div>
              <div style={{ color: '#666' }}>Tests Passed</div>
            </div>
            <div
              style={{
                flex: 1,
                padding: 20,
                backgroundColor: '#e3f2fd',
                borderRadius: 8,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 48, fontWeight: 'bold', color: '#1565c0' }}>
                {results.summary.passed}
              </div>
              <div style={{ color: '#666' }}>Passed</div>
            </div>
            <div
              style={{
                flex: 1,
                padding: 20,
                backgroundColor: results.summary.failed > 0 ? '#ffebee' : '#f5f5f5',
                borderRadius: 8,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 48, fontWeight: 'bold', color: results.summary.failed > 0 ? '#c62828' : '#666' }}>
                {results.summary.failed}
              </div>
              <div style={{ color: '#666' }}>Failed</div>
            </div>
          </div>

          {/* Test Results */}
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ marginBottom: 16 }}>Test Results</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {results.tests.map((test, index) => (
                <div
                  key={index}
                  style={{
                    padding: 16,
                    backgroundColor: test.passed ? '#f1f8e9' : '#ffebee',
                    borderLeft: `4px solid ${test.passed ? '#4caf50' : '#f44336'}`,
                    borderRadius: '0 8px 8px 0',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ marginRight: 12, fontSize: 18 }}>
                        {test.passed ? '✅' : '❌'}
                      </span>
                      <strong>{test.name}</strong>
                    </div>
                    <span
                      style={{
                        padding: '4px 12px',
                        backgroundColor: test.passed ? '#4caf50' : '#f44336',
                        color: 'white',
                        borderRadius: 16,
                        fontSize: 12,
                        fontWeight: 'bold',
                      }}
                    >
                      {test.passed ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                  <div style={{ marginTop: 8, color: '#666', fontSize: 14 }}>
                    {test.message}
                  </div>
                  {test.data !== undefined && test.data !== null && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: 'pointer', color: '#3498db', fontSize: 14 }}>
                        View Data
                      </summary>
                      <pre
                        style={{
                          marginTop: 8,
                          padding: 12,
                          backgroundColor: 'rgba(0,0,0,0.05)',
                          borderRadius: 4,
                          fontSize: 12,
                          overflow: 'auto',
                        }}
                      >
                        {JSON.stringify(test.data, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Timestamp */}
          <div style={{ color: '#999', fontSize: 12, textAlign: 'right' }}>
            Last run: {new Date(results.timestamp).toLocaleString()}
          </div>
        </>
      )}

      {/* API Endpoints Info */}
      <div
        style={{
          marginTop: 32,
          padding: 20,
          backgroundColor: '#f5f5f5',
          borderRadius: 8,
        }}
      >
        <h3 style={{ margin: '0 0 16px 0' }}>API Endpoints</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Method</th>
              <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Endpoint</th>
              <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                <code style={{ backgroundColor: '#e3f2fd', padding: '2px 6px', borderRadius: 4 }}>GET</code>
              </td>
              <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                <code>/api/test-floorplan</code>
              </td>
              <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>Run all tests</td>
            </tr>
            <tr>
              <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                <code style={{ backgroundColor: '#fff3e0', padding: '2px 6px', borderRadius: 4 }}>POST</code>
              </td>
              <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                <code>/api/test-floorplan</code>
              </td>
              <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                Run specific actions (checkCollision, getFixtures, snapToGrid)
              </td>
            </tr>
          </tbody>
        </table>

        <h4 style={{ margin: '20px 0 12px 0' }}>Example POST Request</h4>
        <pre
          style={{
            padding: 12,
            backgroundColor: '#263238',
            color: '#aed581',
            borderRadius: 4,
            fontSize: 13,
            overflow: 'auto',
          }}
        >
{`fetch('/api/test-floorplan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'checkCollision',
    data: {
      roomId: 'room-main',
      position: { x: 20, y: 15 },
      width: 3,
      height: 3
    }
  })
})`}
        </pre>
      </div>
    </div>
  );
}
