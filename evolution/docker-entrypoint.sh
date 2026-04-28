#!/bin/bash

sed -i "s|DATABASE_CONNECTION_URI=.*|DATABASE_CONNECTION_URI=${DATABASE_CONNECTION_URI}|" /evolution/.env

cd /evolution

export DATABASE_URL="${DATABASE_CONNECTION_URI}"

rm -rf ./prisma/migrations
cp -r ./prisma/postgresql-migrations ./prisma/migrations

echo "Resetting and migrating database..."
npx prisma migrate reset --force --schema ./prisma/postgresql-schema.prisma

echo "Generating Prisma client..."
npx prisma generate --schema ./prisma/postgresql-schema.prisma

echo "Starting application..."
exec npm run start:prod
