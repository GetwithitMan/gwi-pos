'use client'

import { FloorPlanSection } from './use-floor-plan'

interface SectionBackgroundProps {
  section: FloorPlanSection
}

export function SectionBackground({ section }: SectionBackgroundProps) {
  // Parse color to get RGB values for semi-transparent fill
  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  const fillColor = hexToRgba(section.color || '#3B82F6', 0.08)
  const borderColor = hexToRgba(section.color || '#3B82F6', 0.3)

  return (
    <g className="section-background">
      {/* Section fill */}
      <rect
        x={section.posX}
        y={section.posY}
        width={section.width}
        height={section.height}
        fill={fillColor}
        stroke={borderColor}
        strokeWidth={2}
        strokeDasharray="8 4"
        rx={8}
        ry={8}
        className="pointer-events-none"
      />
      {/* Section label */}
      <text
        x={section.posX + 12}
        y={section.posY + 24}
        fontSize={14}
        fontWeight={600}
        fill={section.color || '#3B82F6'}
        opacity={0.7}
        className="pointer-events-none select-none"
      >
        {section.name}
      </text>
    </g>
  )
}
