#!/bin/bash

# GWI POS - Database Reset Script
# Use this to completely reset the database to a fresh state

set -e

echo "================================"
echo "  GWI POS - Database Reset"
echo "================================"
echo ""

read -p "This will DELETE all data. Are you sure? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 1
fi

echo ""
echo "1. Removing existing database..."
rm -f prisma/pos.db prisma/pos.db-journal

echo "2. Creating fresh database..."
npx prisma db push

echo "3. Seeding initial data..."
npm run db:seed

echo ""
echo "================================"
echo "  Database Reset Complete!"
echo "================================"
echo ""
