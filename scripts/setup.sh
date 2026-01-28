#!/bin/bash

# GWI POS - Quick Setup Script
# Run this after cloning the repo to get started

set -e

echo "================================"
echo "  GWI POS - Setup"
echo "================================"
echo ""

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    echo "Please install Node.js 18+ from https://nodejs.org"
    exit 1
fi

# Check node version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "Error: Node.js 18+ is required (you have $(node -v))"
    exit 1
fi

echo "1. Installing dependencies..."
npm install

echo ""
echo "2. Setting up environment..."
if [ ! -f .env.local ]; then
    cp .env.example .env.local
    echo "   Created .env.local from .env.example"
else
    echo "   .env.local already exists, skipping"
fi

echo ""
echo "3. Generating Prisma client..."
npx prisma generate

echo ""
echo "4. Creating database and tables..."
npx prisma db push

echo ""
echo "5. Seeding initial data..."
npm run db:seed

echo ""
echo "================================"
echo "  Setup Complete!"
echo "================================"
echo ""
echo "Run 'npm run dev' to start the development server"
echo "Then open http://localhost:3000"
echo ""
