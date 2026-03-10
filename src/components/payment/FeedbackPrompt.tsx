'use client'

import React, { useState } from 'react'

interface FeedbackPromptProps {
  orderId: string
  locationId: string
  employeeId?: string
  ratingScale: 5 | 10
  requireComment: boolean
  onClose: () => void
}

/**
 * Quick post-payment feedback prompt.
 * Shows star rating (1-5) with optional comment.
 * Designed for <5 second interaction.
 */
export function FeedbackPrompt({
  orderId,
  locationId,
  employeeId,
  ratingScale,
  requireComment,
  onClose,
}: FeedbackPromptProps) {
  const [rating, setRating] = useState(0)
  const [hoveredRating, setHoveredRating] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const maxStars = ratingScale === 10 ? 10 : 5

  const handleSubmit = async () => {
    if (rating === 0) return
    if (requireComment && !comment.trim()) return

    setSubmitting(true)
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          locationId,
          employeeId,
          rating,
          comment: comment.trim() || null,
          source: 'in_store',
          tags: [],
        }),
      })
      setSubmitted(true)
      // Auto-close after showing success
      setTimeout(onClose, 1200)
    } catch {
      // Silently close — feedback is non-critical
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div style={overlayStyle}>
        <div style={promptStyle}>
          <div style={{ textAlign: 'center', padding: '24px 16px' }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>&#10003;</div>
            <p style={{ color: '#f1f5f9', fontSize: 18, fontWeight: 600 }}>Thank you!</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={overlayStyle}>
      <div style={promptStyle}>
        {/* Header */}
        <div style={{ padding: '16px 16px 8px', textAlign: 'center' }}>
          <p style={{ color: '#f1f5f9', fontSize: 18, fontWeight: 600, margin: 0 }}>
            How was your experience?
          </p>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: '4px 0 0' }}>
            Tap a star to rate
          </p>
        </div>

        {/* Stars */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: maxStars > 5 ? 4 : 8, padding: '12px 16px' }}>
          {Array.from({ length: maxStars }, (_, i) => i + 1).map(star => (
            <button
              key={star}
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoveredRating(star)}
              onMouseLeave={() => setHoveredRating(0)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 2,
                fontSize: maxStars > 5 ? 28 : 36,
                color: star <= (hoveredRating || rating) ? '#fbbf24' : '#475569',
                transition: 'color 0.15s, transform 0.15s',
                transform: star <= (hoveredRating || rating) ? 'scale(1.1)' : 'scale(1)',
              }}
              aria-label={`Rate ${star} out of ${maxStars}`}
            >
              &#9733;
            </button>
          ))}
        </div>

        {/* Optional comment */}
        {rating > 0 && (
          <div style={{ padding: '0 16px 12px' }}>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={requireComment ? 'Please share your feedback...' : 'Any comments? (optional)'}
              rows={2}
              style={{
                width: '100%',
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(100, 116, 139, 0.3)',
                borderRadius: 8,
                color: '#ffffff',
                padding: '8px 12px',
                fontSize: 14,
                resize: 'none',
                outline: 'none',
              }}
            />
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, padding: '8px 16px 16px' }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: 10,
              border: '1px solid rgba(100, 116, 139, 0.3)',
              background: 'transparent',
              color: '#94a3b8',
              fontSize: 15,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Skip
          </button>
          <button
            onClick={handleSubmit}
            disabled={rating === 0 || submitting || (requireComment && !comment.trim())}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: 10,
              border: 'none',
              background: rating > 0 ? '#4f46e5' : '#334155',
              color: rating > 0 ? '#ffffff' : '#64748b',
              fontSize: 15,
              fontWeight: 600,
              cursor: rating > 0 ? 'pointer' : 'default',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Sending...' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.6)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 60,
}

const promptStyle: React.CSSProperties = {
  background: 'rgba(15, 23, 42, 0.95)',
  backdropFilter: 'blur(20px)',
  borderRadius: 16,
  border: '1px solid rgba(255, 255, 255, 0.08)',
  boxShadow: '0 25px 50px rgba(0, 0, 0, 0.5)',
  width: '100%',
  maxWidth: 380,
}
