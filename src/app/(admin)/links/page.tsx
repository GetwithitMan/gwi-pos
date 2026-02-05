'use client'

import Link from 'next/link'

export default function LinksPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-3">GWI POS - Site Map</h1>
        <div className="grid grid-cols-3 gap-3">

          {/* FLOOR PLAN / TABLES */}
          <Section title="🏢 FLOOR PLAN">
            <LinkItem href="/floorplan/editor" label="Floor Plan Editor" />
            <LinkItem href="/orders" label="Orders (POS)" />
          </Section>

          {/* AUTH & LOGIN */}
          <Section title="🔐 AUTH">
            <LinkItem href="/login" label="Login" />
          </Section>

          {/* MENU & FOOD */}
          <Section title="🍕 MENU">
            <LinkItem href="/menu" label="Menu Items" />
            <LinkItem href="/modifiers" label="Modifiers" />
            <LinkItem href="/combos" label="Combos" />
            <LinkItem href="/pizza" label="Pizza" />
            <LinkItem href="/ingredients" label="Ingredients" />
            <LinkItem href="/liquor-builder" label="Liquor Builder" />
            <LinkItem href="/prep-stations" label="Prep Stations" />
          </Section>

          {/* INVENTORY */}
          <Section title="📦 INVENTORY">
            <LinkItem href="/inventory" label="Inventory" />
            <LinkItem href="/inventory/quick-adjust" label="Quick Adjust" />
            <LinkItem href="/inventory/items" label="Items" />
            <LinkItem href="/inventory/beverages" label="Beverages" />
            <LinkItem href="/inventory/counts" label="Counts" />
            <LinkItem href="/inventory/daily-prep-counts" label="Daily Prep" />
            <LinkItem href="/inventory/waste" label="Waste" />
            <LinkItem href="/inventory/transactions" label="Transactions" />
            <LinkItem href="/inventory/vendors" label="Vendors" />
            <LinkItem href="/inventory/settings" label="Settings" />
            <LinkItem href="/86" label="Quick 86" />
          </Section>

          {/* PEOPLE */}
          <Section title="👥 PEOPLE">
            <LinkItem href="/employees" label="Employees" />
            <LinkItem href="/roles" label="Roles" />
            <LinkItem href="/scheduling" label="Scheduling" />
            <LinkItem href="/payroll" label="Payroll" />
            <LinkItem href="/customers" label="Customers" />
            <LinkItem href="/house-accounts" label="House Accounts" />
          </Section>

          {/* ENTERTAINMENT & EVENTS */}
          <Section title="🎉 EVENTS">
            <LinkItem href="/entertainment" label="Entertainment" />
            <LinkItem href="/timed-rentals" label="Timed Rentals" />
            <LinkItem href="/events" label="Events" />
            <LinkItem href="/events/new" label="New Event" />
            <LinkItem href="/virtual-groups" label="Virtual Groups" />
          </Section>

          {/* REPORTS */}
          <Section title="📊 REPORTS">
            <LinkItem href="/reports" label="Hub" />
            <LinkItem href="/reports/daily" label="Daily (EOD)" />
            <LinkItem href="/reports/shift" label="Shift" />
            <LinkItem href="/reports/sales" label="Sales" />
            <LinkItem href="/reports/product-mix" label="Product Mix" />
            <LinkItem href="/reports/tips" label="Tips" />
            <LinkItem href="/reports/employees" label="Employees" />
            <LinkItem href="/reports/payroll" label="Payroll" />
            <LinkItem href="/reports/commission" label="Commission" />
            <LinkItem href="/reports/order-history" label="Order History" />
            <LinkItem href="/reports/liquor" label="Liquor" />
            <LinkItem href="/reports/voids" label="Voids" />
            <LinkItem href="/reports/coupons" label="Coupons" />
            <LinkItem href="/reports/reservations" label="Reservations" />
          </Section>

          {/* SETTINGS */}
          <Section title="⚙️ SETTINGS">
            <LinkItem href="/settings" label="Main Settings" />
            <LinkItem href="/settings/order-types" label="Order Types" />
            <LinkItem href="/settings/tip-outs" label="Tip Outs" />
            <LinkItem href="/settings/daily-counts" label="Daily Counts" />
            <LinkItem href="/settings/hardware" label="Hardware" />
            <LinkItem href="/settings/hardware/printers" label="Printers" />
            <LinkItem href="/settings/hardware/kds-screens" label="KDS Screens" />
            <LinkItem href="/settings/hardware/routing" label="Print Routing" />
            <LinkItem href="/settings/hardware/terminals" label="Terminals" />
            <LinkItem href="/settings/hardware/payment-readers" label="Card Readers" />
          </Section>

          {/* ORDERS & PAYMENTS */}
          <Section title="🎫 PAYMENTS">
            <LinkItem href="/tabs" label="Bar Tabs" />
            <LinkItem href="/reservations" label="Reservations" />
            <LinkItem href="/discounts" label="Discounts" />
            <LinkItem href="/coupons" label="Coupons" />
            <LinkItem href="/gift-cards" label="Gift Cards" />
            <LinkItem href="/tax-rules" label="Tax Rules" />
          </Section>

          {/* KDS */}
          <Section title="🖥️ KDS">
            <LinkItem href="/kds" label="Kitchen Display" />
            <LinkItem href="/kds/pair" label="Pair Device" />
          </Section>

        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wide">{title}</h2>
      <div className="bg-white rounded shadow p-2 space-y-0.5">
        {children}
      </div>
    </section>
  )
}

function LinkItem({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="block px-2 py-1 rounded text-xs hover:bg-blue-50 transition-colors text-gray-700 hover:text-blue-600"
    >
      {label}
    </Link>
  )
}
