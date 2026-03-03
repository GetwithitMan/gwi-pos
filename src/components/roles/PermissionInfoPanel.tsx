'use client'
import { motion, AnimatePresence } from 'framer-motion'
import { PermissionMeta } from '@/lib/permission-registry'

interface PermissionInfoPanelProps {
  meta: PermissionMeta
  isOpen: boolean
}

export function PermissionInfoPanel({ meta, isOpen }: PermissionInfoPanelProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          style={{ overflow: 'hidden' }}
        >
          <div className="mx-3 mb-2 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm">
            {/* Description */}
            <p className="text-gray-700 mb-2">{meta.description}</p>

            {/* Details bullets */}
            {meta.details.length > 0 && (
              <ul className="space-y-1 mb-2">
                {meta.details.map((d, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-gray-600 text-xs">
                    <span className="text-blue-400 mt-0.5">&bull;</span>
                    {d}
                  </li>
                ))}
              </ul>
            )}

            {/* Recommended for */}
            {meta.recommendedFor && meta.recommendedFor.length > 0 && (
              <p className="text-xs text-gray-500">
                <span className="font-medium">Recommended for:</span> {meta.recommendedFor.join(', ')}
              </p>
            )}

            {/* Risk badge */}
            <div className="mt-2 flex items-center gap-1.5">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                meta.risk === 'LOW'      ? 'bg-gray-100 text-gray-600' :
                meta.risk === 'MED'      ? 'bg-yellow-100 text-yellow-700' :
                meta.risk === 'HIGH'     ? 'bg-orange-100 text-orange-700' :
                /* CRITICAL */             'bg-red-100 text-red-700'
              }`}>
                {meta.risk === 'LOW' ? 'Low Risk' : meta.risk === 'MED' ? 'Medium Risk' : meta.risk === 'HIGH' ? 'High Risk' : 'Critical'}
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
