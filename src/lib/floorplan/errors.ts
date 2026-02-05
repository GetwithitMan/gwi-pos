import { NextResponse } from 'next/server';

export function apiError(action: string, error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const stack = error instanceof Error ? error.stack : undefined;

  console.error(`[FloorPlan API] Failed to ${action}:`, message);

  return NextResponse.json(
    {
      error: `Failed to ${action}`,
      ...(process.env.NODE_ENV === 'development' ? { details: message, stack } : {}),
    },
    { status }
  );
}

export function notFoundError(entity: string) {
  return NextResponse.json({ error: `${entity} not found` }, { status: 404 });
}

export function validationError(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
