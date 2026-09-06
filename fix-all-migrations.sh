#!/bin/bash

echo "🔧 Fixing ALL migration scripts to use local database..."

# Fix each migration file
for file in db/migrate_*.js db/create-*.js db/show_schema.js; do
  if [ -f "$file" ]; then
    echo "Fixing $file..."
    
    # Create a backup
    cp "$file" "$file.bak"
    
    # Replace the hardcoded pool with env-based pool
    sed -i '/const pool = new pg.Pool({/,/});/c\
import dotenv from "dotenv";\
dotenv.config();\
\
const pool = new pg.Pool({\
  connectionString: process.env.DATABASE_URL,\
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,\
});' "$file"
    
    # Make sure dotenv is imported
    if ! grep -q "import dotenv" "$file"; then
      sed -i '1i import dotenv from "dotenv";\ndotenv.config();' "$file"
    fi
  fi
done

echo "✅ All migration files fixed!"
