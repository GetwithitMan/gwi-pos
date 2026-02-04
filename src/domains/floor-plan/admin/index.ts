/**
 * GWI POS - Floor Plan Domain
 * Admin Editor
 *
 * Public exports for the floor plan admin editor.
 */

// In-memory version (for testing)
export { FloorPlanEditor } from './FloorPlanEditor';
export { EditorCanvas } from './EditorCanvas';
export { FixtureToolbar } from './FixtureToolbar';
export { FixtureProperties } from './FixtureProperties';

// Database-backed version (production)
export { FloorPlanEditorDB } from './FloorPlanEditorDB';
export { EditorCanvasDB } from './EditorCanvasDB';
export { FixturePropertiesDB } from './FixturePropertiesDB';

// Re-export types
export type {
  EditorToolMode,
  FixtureType,
  DrawingState,
  SelectionState,
  EditorState,
  FixtureTypeMetadata,
} from './types';

export { FIXTURE_TYPES, FIXTURE_TYPE_MAP, getFixtureTypeMetadata } from './types';
