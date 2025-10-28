#!/bin/bash

echo "Installing EICD Platform..."
echo

echo "Installing root dependencies..."
npm install

echo ""
echo "Installing server dependencies..."
cd server
npm install
cd ..

echo ""
echo "Installing client dependencies..."
cd client
npm install
cd ..

echo ""
echo "Installation complete!"
echo ""
echo "To start the application, run:"
echo "  npm run dev"


