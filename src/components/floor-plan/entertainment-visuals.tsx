'use client'

/**
 * Entertainment Visual SVG Components
 *
 * Lightweight inline SVGs for floor plan entertainment elements.
 * All components accept width/height and optional fill colors for customization.
 * Designed to be crisp at any size and render instantly (no external files).
 */

interface VisualProps {
  width?: number
  height?: number
  fillColor?: string
  strokeColor?: string
  className?: string
  status?: 'available' | 'in_use' | 'reserved' | 'maintenance'
}

// Status-based colors
const STATUS_FILLS: Record<string, string> = {
  available: '#22c55e20',
  in_use: '#6366f140',
  reserved: '#eab30840',
  maintenance: '#ef444440',
}

const STATUS_STROKES: Record<string, string> = {
  available: '#22c55e',
  in_use: '#6366f1',
  reserved: '#eab308',
  maintenance: '#ef4444',
}

/**
 * Pool Table - Green felt with pockets and wood rail
 */
export function PoolTableVisual({
  width = 160,
  height = 90,
  fillColor,
  strokeColor,
  status = 'available',
  className,
}: VisualProps) {
  const fill = fillColor || STATUS_FILLS[status]
  const stroke = strokeColor || STATUS_STROKES[status]

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 160 90"
      className={className}
      style={{ overflow: 'visible' }}
    >
      {/* Wood rail */}
      <rect
        x="2"
        y="2"
        width="156"
        height="86"
        rx="8"
        fill="#8B4513"
        stroke="#5D3A1A"
        strokeWidth="2"
      />
      {/* Green felt */}
      <rect
        x="10"
        y="10"
        width="140"
        height="70"
        rx="2"
        fill={fillColor || '#166534'}
        stroke={stroke}
        strokeWidth="1.5"
      />
      {/* Center line */}
      <line x1="80" y1="10" x2="80" y2="80" stroke="#15803d" strokeWidth="1" strokeDasharray="4 4" />
      {/* Pockets */}
      {[
        [12, 12], [80, 10], [148, 12], // Top
        [12, 78], [80, 80], [148, 78], // Bottom
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="6" fill="#1a1a1a" />
      ))}
      {/* Status glow overlay */}
      <rect
        x="10"
        y="10"
        width="140"
        height="70"
        rx="2"
        fill={fill}
        style={{ pointerEvents: 'none' }}
      />
    </svg>
  )
}

/**
 * Dartboard - Circular target with wedges
 */
export function DartboardVisual({
  width = 100,
  height = 100,
  fillColor,
  strokeColor,
  status = 'available',
  className,
}: VisualProps) {
  const stroke = strokeColor || STATUS_STROKES[status]
  const fill = fillColor || STATUS_FILLS[status]

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 100 100"
      className={className}
      style={{ overflow: 'visible' }}
    >
      {/* Outer ring */}
      <circle cx="50" cy="50" r="46" fill="#1a1a1a" stroke={stroke} strokeWidth="2" />
      {/* Scoring rings */}
      <circle cx="50" cy="50" r="40" fill="none" stroke="#dc2626" strokeWidth="8" />
      <circle cx="50" cy="50" r="32" fill="none" stroke="#16a34a" strokeWidth="8" />
      <circle cx="50" cy="50" r="24" fill="none" stroke="#dc2626" strokeWidth="8" />
      <circle cx="50" cy="50" r="16" fill="none" stroke="#16a34a" strokeWidth="8" />
      {/* Double/Triple rings */}
      <circle cx="50" cy="50" r="44" fill="none" stroke="#000" strokeWidth="1" />
      <circle cx="50" cy="50" r="28" fill="none" stroke="#000" strokeWidth="1" />
      {/* Bullseye */}
      <circle cx="50" cy="50" r="6" fill="#16a34a" stroke="#000" strokeWidth="1" />
      <circle cx="50" cy="50" r="2" fill="#dc2626" stroke="#000" strokeWidth="0.5" />
      {/* Dividing lines */}
      {Array.from({ length: 20 }).map((_, i) => {
        const angle = (i * 18 - 9) * (Math.PI / 180)
        return (
          <line
            key={i}
            x1={50 + Math.cos(angle) * 8}
            y1={50 + Math.sin(angle) * 8}
            x2={50 + Math.cos(angle) * 46}
            y2={50 + Math.sin(angle) * 46}
            stroke="#000"
            strokeWidth="0.5"
          />
        )
      })}
      {/* Status overlay */}
      <circle cx="50" cy="50" r="46" fill={fill} style={{ pointerEvents: 'none' }} />
    </svg>
  )
}

/**
 * Arcade Cabinet - Retro game cabinet with screen
 */
export function ArcadeVisual({
  width = 70,
  height = 100,
  fillColor,
  strokeColor,
  status = 'available',
  className,
}: VisualProps) {
  const stroke = strokeColor || STATUS_STROKES[status]
  const fill = fillColor || STATUS_FILLS[status]

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 70 100"
      className={className}
      style={{ overflow: 'visible' }}
    >
      {/* Cabinet body */}
      <path
        d="M10 95 L10 20 Q10 10 20 10 L50 10 Q60 10 60 20 L60 95 Q60 98 55 98 L15 98 Q10 98 10 95 Z"
        fill="#1e293b"
        stroke={stroke}
        strokeWidth="2"
      />
      {/* Screen bezel */}
      <rect x="15" y="18" width="40" height="35" rx="2" fill="#0f172a" stroke="#334155" strokeWidth="1" />
      {/* Screen */}
      <rect x="18" y="21" width="34" height="29" rx="1" fill="#1e1b4b">
        {/* Screen glow effect */}
        <animate attributeName="fill" values="#1e1b4b;#312e81;#1e1b4b" dur="3s" repeatCount="indefinite" />
      </rect>
      {/* Marquee */}
      <rect x="12" y="5" width="46" height="10" rx="1" fill="#7c3aed" />
      {/* Control panel */}
      <rect x="15" y="58" width="40" height="18" rx="2" fill="#334155" />
      {/* Joystick */}
      <circle cx="28" cy="67" r="4" fill="#1a1a1a" />
      <rect x="26" y="60" width="4" height="10" rx="1" fill="#dc2626" />
      {/* Buttons */}
      <circle cx="42" cy="63" r="3" fill="#22c55e" />
      <circle cx="50" cy="65" r="3" fill="#3b82f6" />
      <circle cx="46" cy="72" r="3" fill="#eab308" />
      {/* Coin slot */}
      <rect x="28" y="80" width="14" height="3" rx="1" fill="#0a0a0a" />
      {/* Status overlay */}
      <rect x="10" y="10" width="50" height="88" rx="4" fill={fill} style={{ pointerEvents: 'none' }} />
    </svg>
  )
}

/**
 * Foosball Table - Table with rods and players
 */
export function FoosballVisual({
  width = 140,
  height = 80,
  fillColor,
  strokeColor,
  status = 'available',
  className,
}: VisualProps) {
  const stroke = strokeColor || STATUS_STROKES[status]
  const fill = fillColor || STATUS_FILLS[status]

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 140 80"
      className={className}
      style={{ overflow: 'visible' }}
    >
      {/* Table frame */}
      <rect x="5" y="5" width="130" height="70" rx="4" fill="#1e293b" stroke={stroke} strokeWidth="2" />
      {/* Playing field */}
      <rect x="12" y="12" width="116" height="56" rx="2" fill="#16a34a" />
      {/* Center circle */}
      <circle cx="70" cy="40" r="10" fill="none" stroke="#15803d" strokeWidth="1.5" />
      {/* Center line */}
      <line x1="70" y1="12" x2="70" y2="68" stroke="#15803d" strokeWidth="1.5" />
      {/* Goals */}
      <rect x="12" y="28" width="6" height="24" fill="#0f172a" rx="1" />
      <rect x="122" y="28" width="6" height="24" fill="#0f172a" rx="1" />
      {/* Rods with handles */}
      {[25, 45, 65, 85, 105].map((x, i) => (
        <g key={i}>
          {/* Rod */}
          <line x1={x} y1="0" x2={x} y2="80" stroke="#9ca3af" strokeWidth="3" />
          {/* Handles */}
          <rect x={x - 4} y="-2" width="8" height="6" rx="1" fill="#4b5563" />
          <rect x={x - 4} y="76" width="8" height="6" rx="1" fill="#4b5563" />
          {/* Players (alternating colors) */}
          {(i % 2 === 0 ? [25, 55] : [20, 40, 60]).map((py, j) => (
            <rect
              key={j}
              x={x - 3}
              y={py}
              width="6"
              height="10"
              rx="1"
              fill={i % 2 === 0 ? '#dc2626' : '#2563eb'}
            />
          ))}
        </g>
      ))}
      {/* Status overlay */}
      <rect x="12" y="12" width="116" height="56" rx="2" fill={fill} style={{ pointerEvents: 'none' }} />
    </svg>
  )
}

/**
 * Shuffleboard Table - Long narrow table with scoring zones
 */
export function ShuffleboardVisual({
  width = 200,
  height = 50,
  fillColor,
  strokeColor,
  status = 'available',
  className,
}: VisualProps) {
  const stroke = strokeColor || STATUS_STROKES[status]
  const fill = fillColor || STATUS_FILLS[status]

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 200 50"
      className={className}
      style={{ overflow: 'visible' }}
    >
      {/* Table frame */}
      <rect x="2" y="2" width="196" height="46" rx="4" fill="#8B4513" stroke="#5D3A1A" strokeWidth="2" />
      {/* Playing surface */}
      <rect x="8" y="8" width="184" height="34" rx="2" fill="#d4a574" />
      {/* Scoring zones */}
      <line x1="160" y1="8" x2="160" y2="42" stroke="#8B4513" strokeWidth="1" />
      <line x1="175" y1="8" x2="175" y2="42" stroke="#8B4513" strokeWidth="1" />
      <line x1="185" y1="8" x2="185" y2="42" stroke="#8B4513" strokeWidth="1" />
      {/* Score labels */}
      <text x="167" y="28" fontSize="8" fill="#5D3A1A" textAnchor="middle">1</text>
      <text x="180" y="28" fontSize="8" fill="#5D3A1A" textAnchor="middle">2</text>
      <text x="189" y="28" fontSize="8" fill="#5D3A1A" textAnchor="middle">3</text>
      {/* Foul line */}
      <line x1="40" y1="8" x2="40" y2="42" stroke="#dc2626" strokeWidth="1.5" strokeDasharray="4 2" />
      {/* Status overlay */}
      <rect x="8" y="8" width="184" height="34" rx="2" fill={fill} style={{ pointerEvents: 'none' }} />
    </svg>
  )
}

/**
 * Ping Pong Table - Table with net
 */
export function PingPongVisual({
  width = 140,
  height = 80,
  fillColor,
  strokeColor,
  status = 'available',
  className,
}: VisualProps) {
  const stroke = strokeColor || STATUS_STROKES[status]
  const fill = fillColor || STATUS_FILLS[status]

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 140 80"
      className={className}
      style={{ overflow: 'visible' }}
    >
      {/* Table surface */}
      <rect x="5" y="5" width="130" height="70" rx="2" fill="#1d4ed8" stroke={stroke} strokeWidth="2" />
      {/* White border lines */}
      <rect x="10" y="10" width="120" height="60" fill="none" stroke="white" strokeWidth="2" />
      {/* Center line */}
      <line x1="10" y1="40" x2="130" y2="40" stroke="white" strokeWidth="2" />
      {/* Net */}
      <rect x="68" y="5" width="4" height="70" fill="#374151" />
      <line x1="70" y1="5" x2="70" y2="75" stroke="white" strokeWidth="1" strokeDasharray="2 2" />
      {/* Net posts */}
      <circle cx="70" cy="5" r="3" fill="#6b7280" />
      <circle cx="70" cy="75" r="3" fill="#6b7280" />
      {/* Status overlay */}
      <rect x="5" y="5" width="130" height="70" rx="2" fill={fill} style={{ pointerEvents: 'none' }} />
    </svg>
  )
}

/**
 * Bowling Lane - Long lane with pins
 */
export function BowlingLaneVisual({
  width = 220,
  height = 45,
  fillColor,
  strokeColor,
  status = 'available',
  className,
}: VisualProps) {
  const stroke = strokeColor || STATUS_STROKES[status]
  const fill = fillColor || STATUS_FILLS[status]

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 220 45"
      className={className}
      style={{ overflow: 'visible' }}
    >
      {/* Lane */}
      <rect x="2" y="5" width="216" height="35" rx="2" fill="#d4a574" stroke={stroke} strokeWidth="2" />
      {/* Arrows/markers */}
      {[40, 60, 80].map((x) => (
        <polygon key={x} points={`${x},22.5 ${x - 4},28 ${x + 4},28`} fill="#8B4513" />
      ))}
      {/* Foul line */}
      <line x1="30" y1="5" x2="30" y2="40" stroke="#1a1a1a" strokeWidth="2" />
      {/* Gutters */}
      <rect x="2" y="5" width="216" height="4" fill="#374151" />
      <rect x="2" y="36" width="216" height="4" fill="#374151" />
      {/* Pin deck */}
      <rect x="195" y="5" width="23" height="35" fill="#f5f5f5" />
      {/* Pins (triangle formation) */}
      {[
        [207, 22.5], // 1
        [211, 18], [211, 27], // 2-3
        [215, 14], [215, 22.5], [215, 31], // 4-6
      ].map(([cx, cy], i) => (
        <ellipse key={i} cx={cx} cy={cy} rx="2" ry="3" fill="white" stroke="#ccc" strokeWidth="0.5" />
      ))}
      {/* Status overlay */}
      <rect x="2" y="5" width="216" height="35" rx="2" fill={fill} style={{ pointerEvents: 'none' }} />
    </svg>
  )
}

/**
 * Karaoke Stage - Small platform with mic
 */
export function KaraokeStageVisual({
  width = 100,
  height = 80,
  fillColor,
  strokeColor,
  status = 'available',
  className,
}: VisualProps) {
  const stroke = strokeColor || STATUS_STROKES[status]
  const fill = fillColor || STATUS_FILLS[status]

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 100 80"
      className={className}
      style={{ overflow: 'visible' }}
    >
      {/* Stage platform */}
      <path d="M10 70 L5 75 L95 75 L90 70 Z" fill="#4a5568" />
      <rect x="10" y="50" width="80" height="20" rx="2" fill="#1e293b" stroke={stroke} strokeWidth="2" />
      {/* Stage floor pattern */}
      <rect x="12" y="52" width="76" height="16" rx="1" fill="#374151" />
      {/* Spotlight effect */}
      <ellipse cx="50" cy="58" rx="25" ry="8" fill="#fef08a" opacity="0.3" />
      {/* Mic stand */}
      <line x1="50" y1="25" x2="50" y2="52" stroke="#6b7280" strokeWidth="2" />
      <rect x="45" y="50" width="10" height="4" rx="1" fill="#4b5563" />
      {/* Microphone */}
      <ellipse cx="50" cy="22" rx="6" ry="8" fill="#1f2937" stroke="#4b5563" strokeWidth="1" />
      <rect x="48" y="28" width="4" height="6" fill="#374151" />
      {/* Monitor speakers */}
      <rect x="15" y="42" width="12" height="8" rx="1" fill="#1f2937" stroke="#374151" strokeWidth="0.5" />
      <rect x="73" y="42" width="12" height="8" rx="1" fill="#1f2937" stroke="#374151" strokeWidth="0.5" />
      {/* Music notes decoration */}
      <text x="25" y="35" fontSize="10" fill="#a855f7" opacity="0.7">♪</text>
      <text x="72" y="32" fontSize="8" fill="#a855f7" opacity="0.7">♫</text>
      {/* Status overlay */}
      <rect x="10" y="50" width="80" height="20" rx="2" fill={fill} style={{ pointerEvents: 'none' }} />
    </svg>
  )
}

/**
 * DJ Booth - Booth with turntables
 */
export function DJBoothVisual({
  width = 120,
  height = 70,
  fillColor,
  strokeColor,
  status = 'available',
  className,
}: VisualProps) {
  const stroke = strokeColor || STATUS_STROKES[status]
  const fill = fillColor || STATUS_FILLS[status]

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 120 70"
      className={className}
      style={{ overflow: 'visible' }}
    >
      {/* Booth base */}
      <rect x="5" y="35" width="110" height="30" rx="4" fill="#1e293b" stroke={stroke} strokeWidth="2" />
      {/* Equipment surface */}
      <rect x="10" y="25" width="100" height="15" rx="2" fill="#0f172a" stroke="#334155" strokeWidth="1" />
      {/* Left turntable */}
      <circle cx="30" cy="32" r="10" fill="#1f2937" stroke="#4b5563" strokeWidth="1" />
      <circle cx="30" cy="32" r="7" fill="#27272a" />
      <circle cx="30" cy="32" r="1.5" fill="#dc2626" />
      {/* Right turntable */}
      <circle cx="90" cy="32" r="10" fill="#1f2937" stroke="#4b5563" strokeWidth="1" />
      <circle cx="90" cy="32" r="7" fill="#27272a" />
      <circle cx="90" cy="32" r="1.5" fill="#dc2626" />
      {/* Mixer in center */}
      <rect x="48" y="27" width="24" height="10" rx="1" fill="#374151" />
      {/* Mixer faders */}
      {[52, 56, 60, 64, 68].map((x) => (
        <rect key={x} x={x} y="29" width="2" height="6" rx="0.5" fill="#22c55e" />
      ))}
      {/* Crossfader */}
      <rect x="52" y="38" width="16" height="3" rx="1" fill="#4b5563" />
      <rect x="58" y="37" width="4" height="5" rx="1" fill="#ef4444" />
      {/* LED strip */}
      <rect x="10" y="55" width="100" height="3" rx="1" fill="#7c3aed">
        <animate attributeName="fill" values="#7c3aed;#3b82f6;#22c55e;#eab308;#7c3aed" dur="2s" repeatCount="indefinite" />
      </rect>
      {/* Status overlay */}
      <rect x="5" y="25" width="110" height="40" rx="4" fill={fill} style={{ pointerEvents: 'none' }} />
    </svg>
  )
}

/**
 * Photo Booth - Curtained booth with camera
 */
export function PhotoBoothVisual({
  width = 80,
  height = 100,
  fillColor,
  strokeColor,
  status = 'available',
  className,
}: VisualProps) {
  const stroke = strokeColor || STATUS_STROKES[status]
  const fill = fillColor || STATUS_FILLS[status]

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 80 100"
      className={className}
      style={{ overflow: 'visible' }}
    >
      {/* Booth frame */}
      <rect x="5" y="5" width="70" height="90" rx="4" fill="#1e293b" stroke={stroke} strokeWidth="2" />
      {/* Curtain top bar */}
      <rect x="10" y="8" width="60" height="4" rx="1" fill="#7c2d12" />
      {/* Curtains */}
      <path d="M10 12 Q15 50 10 95 L10 12" fill="#dc2626" />
      <path d="M70 12 Q65 50 70 95 L70 12" fill="#dc2626" />
      {/* Curtain folds */}
      <path d="M10 12 Q20 40 15 95" fill="none" stroke="#b91c1c" strokeWidth="1" />
      <path d="M70 12 Q60 40 65 95" fill="none" stroke="#b91c1c" strokeWidth="1" />
      {/* Interior */}
      <rect x="18" y="12" width="44" height="80" fill="#0f172a" />
      {/* Camera/screen */}
      <rect x="28" y="20" width="24" height="18" rx="2" fill="#1f2937" stroke="#4b5563" strokeWidth="1" />
      <circle cx="40" cy="29" r="5" fill="#374151" stroke="#4b5563" strokeWidth="1" />
      <circle cx="40" cy="29" r="2" fill="#0f172a" />
      {/* Flash */}
      <rect x="35" y="42" width="10" height="4" rx="1" fill="#fef08a" opacity="0.8" />
      {/* Bench */}
      <rect x="22" y="75" width="36" height="8" rx="2" fill="#4b5563" />
      {/* "PHOTOS" sign */}
      <rect x="25" y="1" width="30" height="8" rx="2" fill="#f59e0b" />
      <text x="40" y="7" fontSize="5" fill="white" textAnchor="middle" fontWeight="bold">PHOTOS</text>
      {/* Status overlay */}
      <rect x="18" y="12" width="44" height="80" fill={fill} style={{ pointerEvents: 'none' }} />
    </svg>
  )
}

/**
 * Generic Game Table - Flexible table for card games, board games, etc.
 */
export function GameTableVisual({
  width = 100,
  height = 100,
  fillColor,
  strokeColor,
  status = 'available',
  className,
}: VisualProps) {
  const stroke = strokeColor || STATUS_STROKES[status]
  const fill = fillColor || STATUS_FILLS[status]

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 100 100"
      className={className}
      style={{ overflow: 'visible' }}
    >
      {/* Table */}
      <circle cx="50" cy="50" r="45" fill="#1e293b" stroke={stroke} strokeWidth="2" />
      {/* Felt surface */}
      <circle cx="50" cy="50" r="38" fill="#166534" />
      {/* Card/chip spots */}
      {[0, 60, 120, 180, 240, 300].map((angle, i) => {
        const rad = (angle * Math.PI) / 180
        const x = 50 + Math.cos(rad) * 28
        const y = 50 + Math.sin(rad) * 28
        return (
          <rect
            key={i}
            x={x - 8}
            y={y - 5}
            width="16"
            height="10"
            rx="2"
            fill="#15803d"
            stroke="#14532d"
            strokeWidth="0.5"
            transform={`rotate(${angle}, ${x}, ${y})`}
          />
        )
      })}
      {/* Center logo area */}
      <circle cx="50" cy="50" r="10" fill="#14532d" />
      {/* Status overlay */}
      <circle cx="50" cy="50" r="45" fill={fill} style={{ pointerEvents: 'none' }} />
    </svg>
  )
}

/**
 * VR Station - Virtual reality gaming station
 */
export function VRStationVisual({
  width = 90,
  height = 90,
  fillColor,
  strokeColor,
  status = 'available',
  className,
}: VisualProps) {
  const stroke = strokeColor || STATUS_STROKES[status]
  const fill = fillColor || STATUS_FILLS[status]

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 90 90"
      className={className}
      style={{ overflow: 'visible' }}
    >
      {/* Play area boundary */}
      <rect x="5" y="5" width="80" height="80" rx="4" fill="none" stroke={stroke} strokeWidth="2" strokeDasharray="8 4" />
      {/* Play mat */}
      <rect x="15" y="15" width="60" height="60" rx="2" fill="#1e293b" />
      {/* Grid lines */}
      {[30, 45, 60].map((pos) => (
        <g key={pos}>
          <line x1={pos} y1="15" x2={pos} y2="75" stroke="#334155" strokeWidth="0.5" />
          <line x1="15" y1={pos} x2="75" y2={pos} stroke="#334155" strokeWidth="0.5" />
        </g>
      ))}
      {/* VR headset icon in center */}
      <ellipse cx="45" cy="45" rx="15" ry="10" fill="#4b5563" stroke="#6b7280" strokeWidth="1" />
      <rect x="32" y="40" width="10" height="8" rx="2" fill="#1f2937" />
      <rect x="48" y="40" width="10" height="8" rx="2" fill="#1f2937" />
      <rect x="42" y="48" width="6" height="4" rx="1" fill="#374151" />
      {/* Sensors in corners */}
      {[[12, 12], [78, 12], [12, 78], [78, 78]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="4" fill="#7c3aed">
          <animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite" begin={`${i * 0.3}s`} />
        </circle>
      ))}
      {/* Status overlay */}
      <rect x="15" y="15" width="60" height="60" rx="2" fill={fill} style={{ pointerEvents: 'none' }} />
    </svg>
  )
}

// ============================================
// VISUAL TYPE REGISTRY
// ============================================

export const ENTERTAINMENT_VISUALS = {
  pool_table: PoolTableVisual,
  dartboard: DartboardVisual,
  arcade: ArcadeVisual,
  foosball: FoosballVisual,
  shuffleboard: ShuffleboardVisual,
  ping_pong: PingPongVisual,
  bowling_lane: BowlingLaneVisual,
  karaoke_stage: KaraokeStageVisual,
  dj_booth: DJBoothVisual,
  photo_booth: PhotoBoothVisual,
  game_table: GameTableVisual,
  vr_station: VRStationVisual,
} as const

export type EntertainmentVisualType = keyof typeof ENTERTAINMENT_VISUALS

export const ENTERTAINMENT_VISUAL_OPTIONS: { value: EntertainmentVisualType; label: string; defaultWidth: number; defaultHeight: number }[] = [
  { value: 'pool_table', label: 'Pool Table', defaultWidth: 160, defaultHeight: 90 },
  { value: 'dartboard', label: 'Dartboard', defaultWidth: 80, defaultHeight: 80 },
  { value: 'arcade', label: 'Arcade Cabinet', defaultWidth: 60, defaultHeight: 90 },
  { value: 'foosball', label: 'Foosball Table', defaultWidth: 140, defaultHeight: 80 },
  { value: 'shuffleboard', label: 'Shuffleboard', defaultWidth: 200, defaultHeight: 50 },
  { value: 'ping_pong', label: 'Ping Pong Table', defaultWidth: 140, defaultHeight: 80 },
  { value: 'bowling_lane', label: 'Bowling Lane', defaultWidth: 220, defaultHeight: 45 },
  { value: 'karaoke_stage', label: 'Karaoke Stage', defaultWidth: 100, defaultHeight: 80 },
  { value: 'dj_booth', label: 'DJ Booth', defaultWidth: 120, defaultHeight: 70 },
  { value: 'photo_booth', label: 'Photo Booth', defaultWidth: 80, defaultHeight: 100 },
  { value: 'game_table', label: 'Game Table', defaultWidth: 100, defaultHeight: 100 },
  { value: 'vr_station', label: 'VR Station', defaultWidth: 90, defaultHeight: 90 },
]

/**
 * Render the appropriate visual for a given type
 */
export function EntertainmentVisual({
  visualType,
  ...props
}: VisualProps & { visualType: EntertainmentVisualType }) {
  const Component = ENTERTAINMENT_VISUALS[visualType]
  if (!Component) {
    // Fallback to game table for unknown types
    return <GameTableVisual {...props} />
  }
  return <Component {...props} />
}
