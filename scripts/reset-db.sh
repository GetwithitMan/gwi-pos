#!/bin/bash

# GWI POS - Database Reset Script
# Use this to completely reset the database to a fresh state
# Requires DATABASE_URL to be set (PostgreSQL)

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
echo "1. Pushing schema to database..."
npx prisma db push --force-reset

echo "2. Seeding initial data..."
npm run db:seed

echo ""
echo "================================"
echo "  Database Reset Complete!"
echo "================================"
echo ""
