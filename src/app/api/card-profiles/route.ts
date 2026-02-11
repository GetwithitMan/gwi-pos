import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST - Recognize or create a card profile after payment
// Called automatically when a card is used (if card recognition is enabled)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      cardholderIdHash,
      cardType,
      cardLast4,
      cardholderName,
      spendAmount,
    } = body

    if (!locationId || !cardholderIdHash || !cardType || !cardLast4) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const now = new Date()

    // Upsert: find existing profile or create new one
    const existing = await db.cardProfile.findUnique({
      where: {
        locationId_cardholderIdHash: {
          locationId,
          cardholderIdHash,
        },
      },
    })

    if (existing) {
      // Update existing profile
      const updated = await db.cardProfile.update({
        where: { id: existing.id },
        data: {
          visitCount: existing.visitCount + 1,
          lastSeenAt: now,
          totalSpend: Number(existing.totalSpend) + (spendAmount || 0),
          // Update name if we got a better one from chip
          ...(cardholderName && !existing.cardholderName ? { cardholderName } : {}),
        },
      })

      return NextResponse.json({
        data: {
          isNewCustomer: false,
          profileId: updated.id,
          visitCount: updated.visitCount,
          totalSpend: Number(updated.totalSpend),
          firstSeenAt: updated.firstSeenAt.toISOString(),
          lastSeenAt: updated.lastSeenAt.toISOString(),
          cardholderName: updated.cardholderName,
        },
      })
    }

    // Create new profile
    const profile = await db.cardProfile.create({
      data: {
        locationId,
        cardholderIdHash,
        cardType,
        cardLast4,
        cardholderName,
        visitCount: 1,
        totalSpend: spendAmount || 0,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    })

    return NextResponse.json({
      data: {
        isNewCustomer: true,
        profileId: profile.id,
        visitCount: 1,
        totalSpend: spendAmount || 0,
        firstSeenAt: profile.firstSeenAt.toISOString(),
        lastSeenAt: profile.lastSeenAt.toISOString(),
        cardholderName: profile.cardholderName,
      },
    })
  } catch (error) {
    console.error('Failed to process card profile:', error)
    return NextResponse.json({ error: 'Failed to process card profile' }, { status: 500 })
  }
}

// GET - Lookup card profile by hash or last4
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const cardholderIdHash = searchParams.get('cardholderIdHash')
    const cardLast4 = searchParams.get('cardLast4')

    if (!locationId) {
      return NextResponse.json({ error: 'Missing locationId' }, { status: 400 })
    }

    // Exact lookup by hash (preferred)
    if (cardholderIdHash) {
      const profile = await db.cardProfile.findUnique({
        where: {
          locationId_cardholderIdHash: {
            locationId,
            cardholderIdHash,
          },
        },
      })

      if (!profile) {
        return NextResponse.json({ data: null })
      }

      return NextResponse.json({
        data: {
          id: profile.id,
          cardType: profile.cardType,
          cardLast4: profile.cardLast4,
          cardholderName: profile.cardholderName,
          visitCount: profile.visitCount,
          totalSpend: Number(profile.totalSpend),
          firstSeenAt: profile.firstSeenAt.toISOString(),
          lastSeenAt: profile.lastSeenAt.toISOString(),
        },
      })
    }

    // Fuzzy lookup by last4 (may return multiple)
    if (cardLast4) {
      const profiles = await db.cardProfile.findMany({
        where: { locationId, cardLast4, deletedAt: null },
        orderBy: { lastSeenAt: 'desc' },
        take: 10,
      })

      return NextResponse.json({
        data: profiles.map(p => ({
          id: p.id,
          cardType: p.cardType,
          cardLast4: p.cardLast4,
          cardholderName: p.cardholderName,
          visitCount: p.visitCount,
          totalSpend: Number(p.totalSpend),
          firstSeenAt: p.firstSeenAt.toISOString(),
          lastSeenAt: p.lastSeenAt.toISOString(),
        })),
      })
    }

    return NextResponse.json({ error: 'Provide cardholderIdHash or cardLast4' }, { status: 400 })
  } catch (error) {
    console.error('Failed to lookup card profile:', error)
    return NextResponse.json({ error: 'Failed to lookup card profile' }, { status: 500 })
  }
}
