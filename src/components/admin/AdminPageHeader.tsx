'use client'

import { Fragment } from 'react'
import Link from 'next/link'

interface Breadcrumb {
  label: string
  href: string
}

interface AdminPageHeaderProps {
  title: string
  subtitle?: React.ReactNode
  breadcrumbs?: Breadcrumb[]
  backHref?: string
  actions?: React.ReactNode
}

export function AdminPageHeader({
  title,
  subtitle,
  breadcrumbs,
  backHref,
  actions,
}: AdminPageHeaderProps) {
  return (
    <div className="mb-6">
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          {breadcrumbs.map((crumb, i) => (
            <Fragment key={crumb.href}>
              {i > 0 && <span className="text-gray-400">/</span>}
              <Link
                href={crumb.href}
                className="hover:text-gray-700 transition-colors"
              >
                {crumb.label}
              </Link>
            </Fragment>
          ))}
          <span className="text-gray-400">/</span>
          <span className="text-gray-700 font-medium">{title}</span>
        </nav>
      )}

      {/* Title row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {backHref && (
            <Link
              href={backHref}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Go back"
            >
              <svg
                className="w-5 h-5 text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </Link>
          )}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
            {subtitle && (
              <p className="text-sm text-gray-600 mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>

        {actions && (
          <div className="flex items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  )
}
